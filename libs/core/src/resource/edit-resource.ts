import {
  isUntranslatedCopy,
  needsTranslation,
  normalizeTags,
  type TranslationStatus,
  translocoToICU,
} from '@simoncodes-ca/domain';
import type { Collection } from '../lib/config/open-collection';
import { ResourceAlreadyExistsError, ResourceNotFoundError } from '../lib/errors/lingo-tracker-error';
import type { ResourceTreeEntry } from '../lib/resource/load-resource-tree';
import { validateAndResolvePaths } from '../lib/resource/resource-file-paths';
import { openResourceFolder, type ResourceFolder } from '../lib/resource/resource-folder';
import { removeMutation, type ResourceMutation, upsertMutation } from '../lib/resource/resource-mutation';
import type { OpenTranslatorOptions } from '../lib/translation/translator';
import { assertCollectionLocales, seedLocales } from './locale-seeding';

/** What to change on an entry. `undefined` leaves a field alone. */
export interface EditResourceChanges {
  /** New base value. When it changes, the Staleness rule and Locale seeding run (see {@link editResource}). */
  readonly baseValue?: string;
  readonly comment?: string;
  /** Replaces the tags; an empty list removes them. */
  readonly tags?: readonly string[];
  /** Translations by locale. `status` defaults to `translated`. A value for the base locale is ignored. */
  readonly translations?: Readonly<Record<string, { readonly value: string; readonly status?: TranslationStatus }>>;
  /**
   * Destination folder (dot-delimited; `''` for the collection root). The entry keeps its
   * entry key (the last key segment) and moves there, with its values, metadata and edits.
   */
  readonly moveTo?: string;
}

export interface EditResourceResult {
  /** The entry's key after the edit: the destination key when it moved. */
  readonly resolvedKey: string;
  readonly updated: boolean;
  readonly message?: string;
  readonly entry?: ResourceTreeEntry;
  /** Locales the Translator skipped (see {@link seedLocales}). Present only when auto-translation ran. */
  readonly skippedLocales?: string[];
  /** What changed on disk (empty when nothing was updated). */
  readonly mutations: ResourceMutation[];
}

/**
 * Edits an existing resource entry of a collection.
 *
 * When the base value changes, the Staleness rule updates every translation's status, then
 * Locale seeding ({@link seedLocales}) fills the locales that need work and were not supplied
 * in `changes.translations`: auto-translated when the collection has it enabled, else a copy
 * of the new base value as `new` for a locale that has no value or held an untranslated copy
 * of the old base value. A real translation is kept (and is `stale`).
 *
 * The edit is saved before auto-translation runs, so it is kept even if the provider fails.
 * With `moveTo`, the edited entry then moves to the destination folder: the destination is
 * written before the source entry is removed. `moveTo` is validated, and the destination
 * checked for a collision, before anything is written. The destination is read again just
 * before the move (auto-translation may have taken a while), and a collision found then
 * throws `ResourceAlreadyExistsError` with the edit already saved in the source folder.
 *
 * @param key - The entry's full, existing key.
 * @param options - `provider` / `protectedTerms`: used instead of the collection's (see `openTranslator`).
 * @throws {InvalidResourceKeyError} `key` or `moveTo` is malformed.
 * @throws {ResourceNotFoundError} No entry exists at `key`.
 * @throws {ResourceAlreadyExistsError} The destination folder already has an entry with this entry key
 *   (checked before the edit, and again, on fresh disk state, just before the move).
 * @throws {LocaleNotFoundError} A translation names a locale the collection does not have.
 * @throws {TranslationError} The translation provider failed (the edit itself is saved).
 * @throws {ProtectedTermsFileError} Auto-translation runs and a protected-terms file is malformed.
 */
export async function editResource(
  collection: Collection,
  key: string,
  changes: EditResourceChanges,
  options: OpenTranslatorOptions = {},
): Promise<EditResourceResult> {
  const { baseLocale, translationsFolder } = collection;
  const paths = validateAndResolvePaths({ key, translationsFolder });
  const folder = openResourceFolder(paths.folderPath, { baseLocale });
  const current = folder.get(paths.entryKey);
  if (!current?.meta) {
    throw new ResourceNotFoundError(paths.resolvedKey);
  }

  const translations = Object.entries(changes.translations ?? {}).filter(([locale]) => locale !== baseLocale);
  assertCollectionLocales(
    collection,
    translations.map(([locale]) => locale),
  );

  const destination = changes.moveTo === undefined ? undefined : resolveDestination(collection, paths, changes.moveTo);

  const entryKey = paths.entryKey;
  // Live view of the stored entry: it reflects every change made through `folder`.
  const { entry } = current;
  const previousBase = entry.source;
  let hasChanges = false;

  // setBase applies the Staleness rule to every translation.
  const baseValue = changes.baseValue === undefined ? undefined : translocoToICU(changes.baseValue);
  const baseChanged = baseValue !== undefined && baseValue !== previousBase;
  if (baseChanged) {
    folder.setBase(entryKey, baseValue);
    hasChanges = true;
  }

  if (changes.comment !== undefined && folder.setDetails(entryKey, { comment: changes.comment })) {
    hasChanges = true;
  }
  if (changes.tags !== undefined && folder.setDetails(entryKey, { tags: normalizeTags([...changes.tags]) })) {
    hasChanges = true;
  }

  for (const [locale, { value, status = 'translated' }] of translations) {
    const normalized = translocoToICU(value);
    if (normalized !== entry[locale]) {
      folder.setTranslation(entryKey, locale, normalized, status);
      hasChanges = true;
    } else {
      const localeMeta = folder.get(entryKey)?.meta?.[locale];
      if (localeMeta && localeMeta.status !== status) {
        folder.setStatus(entryKey, locale, status);
        hasChanges = true;
      }
    }
  }

  if (!hasChanges && !destination) {
    return { resolvedKey: paths.resolvedKey, updated: false, message: 'No changes detected', mutations: [] };
  }

  // Two-phase write: the edit is saved before auto-translation, so it is kept if the provider fails.
  if (hasChanges) {
    folder.save();
  }

  let skippedLocales: string[] | undefined;
  if (baseChanged) {
    const seeding = await seedLocales(
      collection,
      {
        baseValue,
        supplied: translations.map(([locale]) => locale),
        needsWork: (locale) => needsTranslation(folder.get(entryKey)?.meta?.[locale]),
        // A real translation is kept; no value, or an untranslated copy of the old base, is not.
        keepsValue: (locale) => {
          const value = entry[locale];
          return typeof value === 'string' && !isUntranslatedCopy(value, previousBase);
        },
      },
      options,
    );
    for (const translation of seeding.translations) {
      folder.setTranslation(entryKey, translation.locale, translation.value, translation.status);
    }
    if (seeding.translations.length > 0) {
      folder.save();
    }
    if (seeding.skippedLocales && seeding.skippedLocales.length > 0) {
      skippedLocales = seeding.skippedLocales;
    }
  }

  const moved = destination ? moveEntry(collection, folder, paths.resolvedKey, destination) : undefined;
  const resolvedKey = moved?.resolvedKey ?? paths.resolvedKey;
  const updatedEntry = moved?.entry ?? folder.treeEntry(entryKey);
  if (!updatedEntry) {
    throw new ResourceNotFoundError(resolvedKey);
  }

  return {
    resolvedKey,
    updated: true,
    entry: updatedEntry,
    mutations: moved?.mutations ?? [upsertMutation(translationsFolder, resolvedKey, updatedEntry)],
    ...(skippedLocales !== undefined && { skippedLocales }),
  };
}

/** Where `moveTo` sends the entry. Holds paths only: the folder is read from disk when the move happens. */
interface Destination {
  readonly resolvedKey: string;
  readonly entryKey: string;
  readonly folderPath: string;
}

/**
 * Where `moveTo` sends the entry; `undefined` when it is the entry's own folder.
 * @throws {InvalidResourceKeyError} `moveTo` is malformed.
 * @throws {ResourceAlreadyExistsError} The destination already has this entry key.
 */
function resolveDestination(
  collection: Collection,
  source: { readonly resolvedKey: string; readonly entryKey: string },
  moveTo: string,
): Destination | undefined {
  const paths = validateAndResolvePaths({
    key: source.entryKey,
    translationsFolder: collection.translationsFolder,
    targetFolder: moveTo,
  });
  if (paths.resolvedKey === source.resolvedKey) {
    return undefined;
  }

  const destination = { resolvedKey: paths.resolvedKey, entryKey: paths.entryKey, folderPath: paths.folderPath };
  openDestination(collection, destination);
  return destination;
}

/**
 * Opens the destination folder as it is on disk now.
 * @throws {ResourceAlreadyExistsError} It already has the entry key.
 */
function openDestination(collection: Collection, destination: Destination): ResourceFolder {
  const folder = openResourceFolder(destination.folderPath, { baseLocale: collection.baseLocale });
  if (folder.has(destination.entryKey)) {
    throw new ResourceAlreadyExistsError(destination.resolvedKey);
  }
  return folder;
}

/**
 * Moves the entry, as stored, to the destination (a lossless copy, like `moveResource`).
 * The destination folder is re-read here, not kept from before the edit, so writes made to it
 * meanwhile are kept and a new collision is caught. The destination is written before the
 * source entry is removed.
 * @throws {ResourceAlreadyExistsError} The destination has the entry key now.
 */
function moveEntry(
  collection: Collection,
  source: ResourceFolder,
  sourceKey: string,
  destination: Destination,
): { resolvedKey: string; entry: ResourceTreeEntry | undefined; mutations: ResourceMutation[] } {
  const entryKey = destination.entryKey;
  const stored = source.get(entryKey);
  if (!stored) {
    throw new ResourceNotFoundError(sourceKey);
  }
  const destinationFolder = openDestination(collection, destination);
  destinationFolder.setEntry(entryKey, stored.entry, stored.meta ?? {});
  destinationFolder.save();
  source.remove(entryKey);
  source.save();

  const entry = destinationFolder.treeEntry(entryKey);
  return {
    resolvedKey: destination.resolvedKey,
    entry,
    mutations: [
      upsertMutation(collection.translationsFolder, destination.resolvedKey, entry),
      removeMutation(collection.translationsFolder, sourceKey),
    ],
  };
}
