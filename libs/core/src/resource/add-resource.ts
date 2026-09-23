import { isUntranslatedCopy, normalizeTags, translocoToICU } from '@simoncodes-ca/domain';
import type { Collection } from '../lib/config/open-collection';
import { ensureDirectoryExists } from '../lib/file-io/directory-operations';
import { validateAndResolvePaths } from '../lib/resource/resource-file-paths';
import { openResourceFolder } from '../lib/resource/resource-folder';
import { type ResourceMutation, upsertMutation } from '../lib/resource/resource-mutation';
import { assertCollectionLocales, type ResourceTranslation, seedLocales } from './locale-seeding';

export interface AddResourceParams {
  /** Dot-delimited key, e.g., "apps.common.buttons.ok". */
  readonly key: string;
  /** Base locale value (the source text). */
  readonly baseValue: string;
  /** Optional context for translators. */
  readonly comment?: string;
  /** Optional tags (normalized before they are stored). */
  readonly tags?: readonly string[];
  /** Optional dot-delimited folder the key is placed under: the stored key is `targetFolder.key`. */
  readonly targetFolder?: string;
  /**
   * Translations the caller supplies. Each locale must be one of the collection's locales
   * (a value for the base locale is ignored). Target locales without one are seeded
   * (see {@link seedLocales}).
   */
  readonly translations?: readonly ResourceTranslation[];
}

export interface AddResourceResult {
  /** The stored key (`targetFolder.key`). */
  readonly resolvedKey: string;
  /** False when an existing entry was replaced. */
  readonly created: boolean;
  /** Every translation written, supplied and seeded. */
  readonly translations: ResourceTranslation[];
  /** Locales the provider did not translate (ICU messages). Present only when auto-translation ran. */
  readonly skippedLocales?: string[];
  /** The `upsert` for the stored entry. */
  readonly mutations: ResourceMutation[];
}

/**
 * Adds a resource entry to a collection, or replaces the entry at that key (its previous
 * translations and metadata are dropped). Creates the folders it needs.
 *
 * Every target locale of the collection gets a value: the supplied translation, else an
 * auto-translation when the collection has it enabled, else a copy of the base value as
 * `new` (the Locale seeding rule, {@link seedLocales}). A translation identical to the base
 * value is stored as `new` whatever its requested status (Staleness rule).
 *
 * Values are normalized to ICU before they are stored. Nothing is written when the
 * translation provider fails.
 *
 * @throws {InvalidResourceKeyError} The key or `targetFolder` is malformed.
 * @throws {LocaleNotFoundError} A supplied translation names a locale the collection does not have.
 * @throws {TranslationError} The translation provider failed.
 */
export async function addResource(collection: Collection, params: AddResourceParams): Promise<AddResourceResult> {
  const { baseLocale, translationsFolder } = collection;
  const paths = validateAndResolvePaths({ key: params.key, translationsFolder, targetFolder: params.targetFolder });

  const supplied = (params.translations ?? []).filter(({ locale }) => locale !== baseLocale);
  assertCollectionLocales(
    collection,
    supplied.map(({ locale }) => locale),
  );

  const baseValue = translocoToICU(params.baseValue);
  // Resolve every value before touching the disk, so a provider failure writes nothing.
  const seeding = await seedLocales(collection, { baseValue, supplied: supplied.map(({ locale }) => locale) });
  const translations: ResourceTranslation[] = [
    ...supplied.map(({ locale, value, status }) => {
      const normalized = translocoToICU(value);
      return { locale, value: normalized, status: isUntranslatedCopy(normalized, baseValue) ? 'new' : status };
    }),
    ...seeding.translations.map((translation) =>
      isUntranslatedCopy(translation.value, baseValue) ? { ...translation, status: 'new' as const } : translation,
    ),
  ];

  ensureDirectoryExists({ directoryPath: paths.folderPath, errorContext: 'Creating resource folder' });
  const folder = openResourceFolder(paths.folderPath, { baseLocale });
  const created = !folder.has(paths.entryKey);

  // setEntry clears the entry in place, so an existing key keeps its position in the file.
  folder.setEntry(paths.entryKey, { source: baseValue }, {});
  folder.setBase(paths.entryKey, baseValue);
  folder.setDetails(paths.entryKey, {
    comment: params.comment || undefined,
    tags: normalizeTags([...(params.tags ?? [])]),
  });
  for (const { locale, value, status } of translations) {
    folder.setTranslation(paths.entryKey, locale, value, status);
  }
  folder.save();

  return {
    resolvedKey: paths.resolvedKey,
    created,
    translations,
    ...(seeding.skippedLocales !== undefined && { skippedLocales: seeding.skippedLocales }),
    mutations: [upsertMutation(translationsFolder, paths.resolvedKey, folder.treeEntry(paths.entryKey))],
  };
}
