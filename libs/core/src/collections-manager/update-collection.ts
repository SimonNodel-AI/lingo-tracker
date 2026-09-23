import { normalizeTags } from '@simoncodes-ca/domain';
import type { LingoTrackerCollection } from '../config/lingo-tracker-collection';
import { createConfigFileOperations, updateConfig } from '../lib/config/config-file-operations';
import { openCollection } from '../lib/config/open-collection';
import { ErrorMessages } from '../lib/errors/error-messages';
import type { ResourceMutation } from '../lib/resource/resource-mutation';
import { addLocaleToCollection } from './add-locale-to-collection';
import { removeLocaleFromCollection } from './remove-locale-from-collection';

export interface UpdateCollectionOptions {
  cwd?: string;
}

/**
 * Updates (and optionally renames) a collection's config entry.
 *
 * NOTE: This uses **full-replace** semantics — the stored collection is rebuilt from the
 * passed `collection`, persisting only fields that differ from the global config. Any
 * optional field omitted from `collection` (including `readOnly`, `translation`,
 * `exportFolder`, `importFolder`, `locales`) is therefore dropped from the entry. Callers
 * performing a partial update must send the full desired collection config, not just the
 * changed fields.
 *
 * `mutations` holds what the locale changes (if any) wrote to the translation files. The
 * config change itself is not a resource mutation; callers that cache a collection's tree
 * must also drop it for the old and new translations folders.
 */
export async function updateCollection(
  collectionName: string,
  newCollectionName: string | undefined,
  collection: LingoTrackerCollection,
  options: UpdateCollectionOptions = {},
): Promise<{ message: string; mutations: ResourceMutation[] }> {
  if (!collection || !collection.translationsFolder || !collection.translationsFolder.trim()) {
    throw new Error('translationsFolder is required');
  }

  const { cwd } = options;
  const newLocales = collection.locales;
  const mutations: ResourceMutation[] = [];

  // Only diff when caller provides an explicit, non-empty locales array.
  // An empty/undefined list means "inherit from global" — no translation files are touched.
  if (newLocales !== undefined && newLocales.length > 0) {
    // Read config here only to diff existing vs new locales; updateConfig below will re-read the already-mutated file.
    const existing = openCollection(createConfigFileOperations({ cwd }).read(), collectionName, { cwd });
    const { locales: existingLocales, baseLocale } = existing;

    const addedLocales = newLocales.filter((l) => !existingLocales.includes(l));
    // Never try to remove the base locale — it can only be set at create time.
    const removedLocales = existingLocales.filter((l) => !newLocales.includes(l) && l !== baseLocale);

    for (const locale of removedLocales) {
      mutations.push(...(await removeLocaleFromCollection(collectionName, locale, { cwd })).mutations);
    }

    for (const locale of addedLocales) {
      mutations.push(...(await addLocaleToCollection(collectionName, locale, { cwd })).mutations);
    }
  }

  const trimmedTranslationsFolder = collection.translationsFolder.trim();
  const targetName = newCollectionName || collectionName;
  const isRename = newCollectionName && newCollectionName !== collectionName;

  updateConfig((config) => {
    if (!config.collections || !config.collections[collectionName]) {
      throw new Error(ErrorMessages.collectionNotFound(collectionName));
    }

    if (isRename && config.collections[targetName]) {
      throw new Error(ErrorMessages.collectionAlreadyExists(targetName));
    }

    const minimalCollection: LingoTrackerCollection = {
      translationsFolder: trimmedTranslationsFolder,
    };

    if (collection.exportFolder !== undefined && collection.exportFolder !== config.exportFolder) {
      minimalCollection.exportFolder = collection.exportFolder;
    }

    if (collection.importFolder !== undefined && collection.importFolder !== config.importFolder) {
      minimalCollection.importFolder = collection.importFolder;
    }

    if (collection.baseLocale !== undefined && collection.baseLocale !== config.baseLocale) {
      minimalCollection.baseLocale = collection.baseLocale;
    }

    if (collection.locales !== undefined && JSON.stringify(collection.locales) !== JSON.stringify(config.locales)) {
      minimalCollection.locales = collection.locales;
    }

    // Persist read-only only when set; passing false (or omitting) clears the flag, making the collection writable.
    if (collection.readOnly) {
      minimalCollection.readOnly = true;
    }

    const normalizedTags = normalizeTags(collection.tags ?? []);
    if (normalizedTags.length > 0) {
      minimalCollection.tags = normalizedTags;
    }

    const protectedTermsFile = collection.protectedTermsFile?.trim();
    if (protectedTermsFile) {
      minimalCollection.protectedTermsFile = protectedTermsFile;
    }

    if (isRename) {
      delete config.collections[collectionName];
    }

    return {
      ...config,
      collections: {
        ...config.collections,
        [targetName]: minimalCollection,
      },
    };
  }, cwd);

  if (isRename) {
    return {
      message: `Collection "${collectionName}" renamed to "${targetName}" and updated successfully`,
      mutations,
    };
  }
  return { message: `Collection "${collectionName}" updated successfully`, mutations };
}
