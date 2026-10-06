import {
  isUntranslatedCopy,
  needsTranslation,
  normalizeTags,
  type TranslationInput,
  type TranslationStatus,
  translocoToICU,
  validateKey,
  validateTargetFolder,
} from '@simoncodes-ca/domain';
import type { Collection } from '../config/open-collection';
import { readProjectTerms, type TerminologyFindings } from '../config/project-terms';
import {
  CoreOperationError,
  FolderNotFoundError,
  InvalidCollectionFolderError,
  InvalidResourceKeyError,
  ResourceAlreadyExistsError,
  ResourceNotFoundError,
} from '../errors/lingo-tracker-error';
import { ensureDirectoryExists } from '../file-io/directory-operations';
import { snapshotTranslation, writeBackEntryTranslations } from '../translation/translation-write-back';
import {
  assertAutoTranslationEnabled,
  type OpenTranslatorOptions,
  openPreparedTranslator,
} from '../translation/translator';
import {
  assertCollectionLocales,
  type ResourceTranslation,
  seedLocales,
  withTranslatorProblems,
} from './locale-seeding';
import { planMove } from './move-plan';
import { relocateEntries } from './relocate-entries';
import { type ResolvedResourcePaths, resolveResourcePaths, validateAndResolvePaths } from './resource-file-paths';
import {
  openResourceFolder,
  type ResourceFolder,
  type ResourceFolderSaveResult,
  resourceFolderPresence,
} from './resource-folder';
import {
  type MutationSink,
  type MutationSinkOptions,
  removeMutation,
  resolveMutationSink,
  saveReporting,
  upsertMutation,
} from './resource-mutation';
import type { ResourceTreeEntry } from './resource-tree-types';
import { assertTranslationStatus } from './translation-status-input';

export interface LocatedEntry {
  readonly resolvedKey: string;
  readonly entryKey: string;
  readonly folder: ResourceFolder;
}

/** Validates an address and opens its folder for inspection or an existing-entry write. */
export function locateEntry(
  collection: Collection,
  key: string,
  options: { readonly targetFolder?: string } = {},
): LocatedEntry {
  const paths = validateAndResolvePaths({
    key,
    translationsFolder: collection.translationsFolder,
    targetFolder: options.targetFolder,
  });
  return openEntryAt(collection, paths);
}

/** An add's full key has already been validated and placed by its caller. */
export function locateResolvedEntry(collection: Collection, resolvedKey: string): LocatedEntry {
  const paths = resolveResourcePaths({ key: resolvedKey, translationsFolder: collection.translationsFolder });
  return openEntryAt(collection, paths);
}

/** Opens a resolved address without repeating its validation or folder resolution. */
function openEntryAt(collection: Collection, paths: ResolvedResourcePaths): LocatedEntry {
  return {
    resolvedKey: paths.resolvedKey,
    entryKey: paths.entryKey,
    folder: openResourceFolder(paths.folderPath, collection),
  };
}

export function validateAddChanges(collection: Collection, changes: EntryAddChanges): void {
  assertCollectionLocales(
    collection,
    (changes.translations ?? []).map(({ locale }) => locale),
  );
  for (const translation of changes.translations ?? []) {
    if (translation.status !== undefined) assertTranslationStatus(translation.status);
  }
}

/**
 * Represents a single translation resource entry.
 * This is stored in resource_entries.json at each folder level.
 */
export interface ResourceEntry {
  /** Base locale value (required) */
  source: string;
  /** Optional context to aid translators */
  comment?: string;
  /** Optional comma-separated tags for filtering/exporting */
  tags?: string[];
  /** Additional translated values keyed by locale (e.g., "fr-ca", "es") */
  [locale: string]: string | string[] | undefined;
}

/**
 * All resource entries at a given folder level.
 * Key is the final segment of the resource key.
 */
export interface ResourceEntries {
  [key: string]: ResourceEntry;
}

export interface ResourceEntryRemoval {
  readonly resolvedKey: string;
  /** Collect at operation end, then call pruneEmptiedFolders once. */
  readonly emptied?: string;
}

export interface EntryAddChanges {
  /** Base locale value (the source text). */
  readonly baseValue: string;
  /** Optional context for translators. */
  readonly comment?: string;
  /** Optional tags (normalized before they are stored). */
  readonly tags?: readonly string[];
  /**
   * Translations the caller supplies. Each locale must be one of the collection's locales
   * (a value for the base locale is ignored). Target locales without one are seeded
   * (see {@link seedLocales}). An omitted status is inferred from the value.
   */
  readonly translations?: readonly TranslationInput[];
}

export type ExistingResourcePolicy = 'replace' | 'fail';

export interface EntryAddResult {
  /** The stored key (`targetFolder.key`). */
  readonly resolvedKey: string;
  /** False when an existing entry was replaced. */
  readonly created: boolean;
  /** Every translation written, supplied and seeded. */
  readonly translations: ResourceTranslation[];
  /** Locales the Translator skipped (see {@link seedLocales}). Present only when auto-translation ran. */
  readonly skippedLocales?: string[];
  /**
   * Advisory: discouraged terms in the stored base value, any rule-file problem that limited the
   * check, and, when auto-translation ran, a named protected-terms file that does not exist.
   */
  readonly terminology: TerminologyFindings;
}

/** What to change on an entry. `undefined` leaves a field alone. */
export interface EditResourceChanges {
  /** New base value. When it changes, the Staleness rule and Locale seeding run (see {@link editResource}). */
  readonly baseValue?: string;
  readonly comment?: string;
  /** Replaces the tags; an empty list removes them. */
  readonly tags?: readonly string[];
  /** Translations by locale. An omitted status is inferred when the value changes. A base-locale value is ignored. */
  readonly translations?: Readonly<Record<string, { readonly value: string; readonly status?: TranslationStatus }>>;
  /**
   * Destination folder (dot-delimited; `''` for the collection root). The entry keeps its
   * entry key (the last key segment) and moves there, with its values, metadata and edits.
   */
  readonly moveTo?: string;
}

export interface EditResourceResult {
  /** Problems pruning the source folder after a completed move. */
  readonly warnings?: string[];
  /** The entry's key after the edit: the destination key when it moved. */
  readonly resolvedKey: string;
  readonly updated: boolean;
  readonly message?: string;
  readonly entry?: ResourceTreeEntry;
  /**
   * Locales the Translator skipped (see {@link seedLocales}), or whose value changed on disk
   * during the provider call. Present only when auto-translation ran.
   */
  readonly skippedLocales?: string[];
  /**
   * Advisory: discouraged terms in the base value, any rule-file problem that limited the check,
   * and, when auto-translation ran, a named protected-terms file that does not exist. Present
   * only when the edit supplied a base value and updated the entry; editing a comment or a
   * translation does not re-raise advice about untouched wording.
   */
  readonly terminology?: TerminologyFindings;
}

export interface TranslateExistingResourceResult {
  readonly translatedCount: number;
  /** Locales the Translator skipped, or whose value changed on disk during the provider call. */
  readonly skippedLocales: string[];
  readonly entry: ResourceTreeEntry;
  /** Problems that did not stop the Translator (a named protected-terms file that does not exist). */
  readonly warnings: string[];
}

export interface EntryEditResult extends EditResourceResult {
  readonly entry: ResourceTreeEntry;
}

export type EntryWriteIntent =
  | { readonly kind: 'add'; readonly changes: EntryAddChanges; readonly onExisting: ExistingResourcePolicy }
  | { readonly kind: 'edit'; readonly changes: EditResourceChanges }
  | { readonly kind: 'translate' };

export type EntryWriteResult =
  | { readonly kind: 'add'; readonly result: EntryAddResult }
  | { readonly kind: 'edit'; readonly result: EntryEditResult }
  | { readonly kind: 'translate'; readonly result: TranslateExistingResourceResult };

export interface EntryWriteOptions extends OpenTranslatorOptions, MutationSinkOptions {}

export function writeEntry(
  collection: Collection,
  resolvedKey: string,
  intent: Extract<EntryWriteIntent, { kind: 'add' }>,
  options?: EntryWriteOptions,
): Promise<Extract<EntryWriteResult, { kind: 'add' }>>;
export function writeEntry(
  collection: Collection,
  resolvedKey: string,
  intent: Extract<EntryWriteIntent, { kind: 'edit' }>,
  options?: EntryWriteOptions,
): Promise<Extract<EntryWriteResult, { kind: 'edit' }>>;
export function writeEntry(
  collection: Collection,
  resolvedKey: string,
  intent: Extract<EntryWriteIntent, { kind: 'translate' }>,
  options?: EntryWriteOptions,
): Promise<Extract<EntryWriteResult, { kind: 'translate' }>>;
/** Applies one entry intent; the kind identifies its result without mixing sync and async writes. */
export async function writeEntry(
  collection: Collection,
  resolvedKey: string,
  intent: EntryWriteIntent,
  options: EntryWriteOptions = {},
): Promise<EntryWriteResult> {
  const onMutation = resolveMutationSink(collection, options);
  switch (intent.kind) {
    case 'add':
      return { kind: 'add', result: await addEntry(collection, resolvedKey, intent, options, onMutation) };
    case 'edit':
      return { kind: 'edit', result: await editEntry(collection, resolvedKey, intent.changes, options, onMutation) };
    case 'translate':
      return { kind: 'translate', result: await translateEntry(collection, resolvedKey, options, onMutation) };
  }
}

function saveEntry(
  collection: Collection,
  resource: LocatedEntry,
  onMutation?: MutationSink,
): ResourceFolderSaveResult {
  return saveReporting(resource.folder, collection.translationsFolder, onMutation, () => [
    resource.folder.has(resource.entryKey)
      ? upsertMutation(
          collection.translationsFolder,
          resource.resolvedKey,
          resource.folder.treeEntry(resource.entryKey),
        )
      : removeMutation(collection.translationsFolder, resource.resolvedKey),
  ]);
}

function requireEntry(
  folder: ResourceFolder,
  entryKey: string,
  key: string,
  options: { readonly requireMetadata?: boolean } = {},
): ResourceTreeEntry {
  const entry = folder.treeEntry(entryKey, options);
  if (!entry) throw new ResourceNotFoundError(key);
  return entry;
}

async function addEntry(
  collection: Collection,
  resolvedKey: string,
  intent: Extract<EntryWriteIntent, { kind: 'add' }>,
  options: EntryWriteOptions,
  onMutation: MutationSink | undefined,
): Promise<EntryAddResult> {
  const paths = resolveResourcePaths({ key: resolvedKey, translationsFolder: collection.translationsFolder });
  validateAddChanges(collection, intent.changes);
  checkWriteConflict(openEntryAt(collection, paths), intent.onExisting);
  const { baseValue: input, translations: requested = [], ...details } = intent.changes;
  const baseValue = translocoToICU(input);
  const supplied = requested.filter(({ locale }) => locale !== collection.baseLocale);
  const seeding = await seedLocales(collection, { baseValue, supplied: supplied.map(({ locale }) => locale) }, options);
  const terminology = withTranslatorProblems(
    readProjectTerms(collection).checkBaseValue(resolvedKey, baseValue),
    seeding.problems,
  );
  const committed = commitAdd(
    collection,
    resolvedKey,
    { baseValue, translations: [...supplied, ...seeding.translations], ...details },
    intent.onExisting,
    onMutation,
  );
  return {
    ...committed,
    ...(seeding.skippedLocales !== undefined && { skippedLocales: seeding.skippedLocales }),
    terminology,
  };
}

/** Rechecks fresh state, applies the add and reports its one save. Shared by single and batch adds. */
export function commitAdd(
  collection: Collection,
  resolvedKey: string,
  changes: EntryAddChanges,
  onExisting: ExistingResourcePolicy,
  onMutation?: MutationSink,
): Pick<EntryAddResult, 'resolvedKey' | 'created' | 'translations'> {
  const resource = locateResolvedEntry(collection, resolvedKey);
  const created = checkWriteConflict(resource, onExisting);
  const translations = applyEntryAdd(resource, changes);
  saveEntry(collection, resource, onMutation);
  return { resolvedKey, created, translations };
}

/** Checks a placed key without writing, including the post-translation batch conflict check. */
export function assertAddable(collection: Collection, resolvedKey: string, onExisting: ExistingResourcePolicy): void {
  checkWriteConflict(locateResolvedEntry(collection, resolvedKey), onExisting);
}

async function translateEntry(
  collection: Collection,
  key: string,
  options: EntryWriteOptions,
  onMutation: MutationSink | undefined,
): Promise<TranslateExistingResourceResult> {
  const config = assertAutoTranslationEnabled(collection);
  const resource = locateEntry(collection, key);
  const entry = requireEntry(resource.folder, resource.entryKey, resource.resolvedKey, { requireMetadata: true });
  const locales = collection.targetLocales.filter((locale) => needsTranslation(entry.metadata[locale]));
  if (locales.length === 0) return { translatedCount: 0, skippedLocales: [], entry, warnings: [] };
  const snapshots = new Map(
    locales.map((locale) => [locale, snapshotTranslation(entry.source, entry.metadata[locale])]),
  );
  const translator = openPreparedTranslator(collection, config, options);
  const translated = await translator.translate([{ key: resource.resolvedKey, source: entry.source }], locales);
  const pending = translated.values.flatMap(({ locale, value }) => {
    const snapshot = snapshots.get(locale);
    return snapshot ? [{ entryKey: resource.entryKey, locale, value, snapshot }] : [];
  });
  const result = writeBackEntryTranslations(collection, resource.folder.folderPath, pending, {
    onMutation,
    saved: (folder) => [
      upsertMutation(collection.translationsFolder, resource.resolvedKey, folder.treeEntry(resource.entryKey)),
    ],
  });
  return {
    translatedCount: result.written.length,
    skippedLocales: [...translated.skipped.map(({ locale }) => locale), ...result.skipped.map(({ locale }) => locale)],
    entry: requireEntry(result.folder, resource.entryKey, resource.resolvedKey),
    warnings: [...translator.problems],
  };
}

function checkWriteConflict(resource: LocatedEntry, onExisting: ExistingResourcePolicy): boolean {
  const created = !resource.folder.has(resource.entryKey);
  if (!created && onExisting === 'fail') throw new ResourceAlreadyExistsError(resource.resolvedKey);
  return created;
}

/** Applies normalized add values; the owning write reports the save through saveEntry. */
function applyEntryAdd(resource: LocatedEntry, changes: EntryAddChanges): ResourceTranslation[] {
  const { folder, entryKey } = resource;
  ensureDirectoryExists({ directoryPath: folder.folderPath, errorContext: 'Creating resource folder' });
  // setEntry clears the entry in place, so an existing key keeps its position in the file.
  folder.setEntry(entryKey, { source: changes.baseValue }, {});
  folder.setBase(entryKey, changes.baseValue);
  folder.setDetails(entryKey, {
    comment: changes.comment || undefined,
    tags: normalizeTags([...(changes.tags ?? [])]),
  });
  for (const { locale, value, status } of changes.translations ?? [])
    folder.setTranslation(entryKey, locale, value, status);
  const stored = folder.get(entryKey);
  return (changes.translations ?? []).map((translation) => {
    const status = stored?.meta?.[translation.locale]?.status;
    if (status === undefined) throw new CoreOperationError(`Missing status for locale "${translation.locale}"`);
    const value = stored?.entry[translation.locale];
    if (typeof value !== 'string') throw new CoreOperationError(`Missing value for locale "${translation.locale}"`);
    return { locale: translation.locale, value, status };
  });
}

async function editEntry(
  collection: Collection,
  key: string,
  changes: EditResourceChanges,
  options: EntryWriteOptions,
  onMutation: MutationSink | undefined,
): Promise<EntryEditResult> {
  const { baseLocale, translationsFolder } = collection;
  const resource = locateEntry(collection, key);
  const { folder } = resource;
  const current = resource.folder.get(resource.entryKey);
  if (!current?.meta) {
    throw new ResourceNotFoundError(resource.resolvedKey);
  }

  const requestedTranslations = Object.entries(changes.translations ?? {});
  for (const [, translation] of requestedTranslations) {
    if (translation.status !== undefined) assertTranslationStatus(translation.status);
  }
  const translations = requestedTranslations.filter(([locale]) => locale !== baseLocale);
  assertCollectionLocales(
    collection,
    translations.map(([locale]) => locale),
  );

  const destination =
    changes.moveTo === undefined ? undefined : resolveDestination(collection, resource, changes.moveTo);

  const entryKey = resource.entryKey;
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

  for (const [locale, { value, status }] of translations) {
    if (translocoToICU(value) !== entry[locale]) {
      folder.setTranslation(entryKey, locale, value, status);
      hasChanges = true;
    } else {
      const localeMeta = folder.get(entryKey)?.meta?.[locale];
      if (status !== undefined && localeMeta && localeMeta.status !== status) {
        folder.setStatus(entryKey, locale, status);
        hasChanges = true;
      }
    }
  }

  if (!hasChanges && !destination) {
    return {
      resolvedKey: resource.resolvedKey,
      updated: false,
      message: 'No changes detected',
      entry: requireEntry(folder, entryKey, resource.resolvedKey),
    };
  }

  // Two-phase write: the edit is saved before auto-translation, so it is kept if the provider fails.
  if (hasChanges) {
    saveEntry(collection, resource, onMutation);
  }

  let updatedFolder = folder;
  let skippedLocales: string[] | undefined;
  let translatorProblems: readonly string[] | undefined;
  if (baseChanged) {
    const snapshots = new Map(
      collection.targetLocales.map((locale) => [
        locale,
        snapshotTranslation(entry.source, folder.get(entryKey)?.meta?.[locale]),
      ]),
    );
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
    const pending = seeding.translations.flatMap((translation) => {
      const snapshot = snapshots.get(translation.locale);
      return snapshot ? [{ entryKey, ...translation, snapshot }] : [];
    });
    const writeBack = writeBackEntryTranslations(collection, folder.folderPath, pending, {
      onMutation,
      saved: (folder) => [upsertMutation(translationsFolder, resource.resolvedKey, folder.treeEntry(entryKey))],
    });
    updatedFolder = writeBack.folder;
    if (!updatedFolder.has(entryKey)) {
      throw new ResourceNotFoundError(resource.resolvedKey);
    }
    if (seeding.skippedLocales !== undefined) {
      const skipped = [...new Set([...seeding.skippedLocales, ...writeBack.skipped.map(({ locale }) => locale)])];
      if (skipped.length > 0) skippedLocales = skipped;
    }
    translatorProblems = seeding.problems;
  }

  const moved = destination ? moveEntry(collection, resource.resolvedKey, destination, onMutation) : undefined;
  const resolvedKey = moved?.resolvedKey ?? resource.resolvedKey;
  const updatedEntry = moved?.entry ?? updatedFolder.treeEntry(entryKey);
  if (!updatedEntry) {
    throw new ResourceNotFoundError(resolvedKey);
  }

  return {
    resolvedKey,
    updated: true,
    entry: updatedEntry,
    ...(moved?.warnings && { warnings: moved.warnings }),
    ...(skippedLocales !== undefined && { skippedLocales }),
    ...(baseValue !== undefined && {
      terminology: withTranslatorProblems(
        readProjectTerms(collection).checkBaseValue(resolvedKey, baseValue),
        translatorProblems,
      ),
    }),
  };
}

/**
 * The key `moveTo` sends the entry to; `undefined` when it is the entry's own folder.
 * @throws {InvalidResourceKeyError} `moveTo` is malformed.
 * @throws {ResourceAlreadyExistsError} The destination already has this entry key.
 */
function resolveDestination(
  collection: Collection,
  source: { readonly resolvedKey: string; readonly entryKey: string },
  moveTo: string,
): string | undefined {
  try {
    if (moveTo) validateTargetFolder(moveTo);
  } catch (error) {
    throw new InvalidResourceKeyError(source.entryKey, error instanceof Error ? error.message : String(error));
  }
  const [relocation] = planMove({
    source: collection,
    destination: collection,
    selection: { kind: 'entry', key: source.resolvedKey },
    destinationPath: moveTo,
  }).relocations;
  if (!relocation || relocation.to === source.resolvedKey) {
    return undefined;
  }

  if (locateEntry(collection, relocation.to).folder.has(source.entryKey)) {
    throw new ResourceAlreadyExistsError(relocation.to);
  }
  return relocation.to;
}

/**
 * Moves the entry, as saved, to the destination through the Entry Relocation (`relocateEntries`),
 * which reads both folders from disk again, so writes made to the destination meanwhile are kept
 * and a new collision is caught. The destination is written before the source entry is removed.
 * A failed write throws after the relocation reports a `reindex`.
 * @throws {ResourceAlreadyExistsError} The destination has the entry key now.
 */
function moveEntry(
  collection: Collection,
  sourceKey: string,
  destinationKey: string,
  onMutation?: MutationSink,
): { resolvedKey: string; entry: ResourceTreeEntry; warnings?: string[] } {
  const plan = planMove({
    source: collection,
    destination: collection,
    selection: { kind: 'key', key: sourceKey },
    destinationPath: destinationKey,
  });
  const relocation = relocateEntries(plan, { onMutation });
  if (relocation.collisions.length > 0) {
    throw new ResourceAlreadyExistsError(destinationKey);
  }
  const [moved] = relocation.moved;
  if (!moved) {
    throw new CoreOperationError(relocation.errors.join('; ') || `Resource ${sourceKey} was not moved`);
  }
  return { resolvedKey: moved.to, entry: moved.entry, ...(relocation.warnings && { warnings: relocation.warnings }) };
}

export function removeEntry(
  collection: Collection,
  key: string,
  options: MutationSinkOptions = {},
): ResourceEntryRemoval {
  const onMutation = resolveMutationSink(collection, options);
  validateKey(key);
  const paths = resolveResourcePaths({ key, translationsFolder: collection.translationsFolder });
  const folderAddress = paths.folderPathSegments.join('.') || '.';
  const presence = resourceFolderPresence(paths.folderPath);
  if (!presence.folder) throw new FolderNotFoundError(folderAddress);
  if (!presence.entries) throw new ResourceNotFoundError(paths.resolvedKey);

  const deletionStep = <T>(run: () => T, detail: string): T => {
    try {
      return run();
    } catch (error) {
      if (error instanceof InvalidCollectionFolderError) throw error;
      throw new CoreOperationError(`Failed to delete resource ${paths.resolvedKey}: ${detail}`, { cause: error });
    }
  };
  const resource = deletionStep(
    () => openEntryAt(collection, paths),
    `folder ${folderAddress} has unreadable resource files`,
  );
  const removed = deletionStep(
    () => resource.folder.remove(resource.entryKey),
    `could not update folder ${folderAddress}`,
  );
  if (!removed) throw new ResourceNotFoundError(paths.resolvedKey);
  const saved = deletionStep(
    () => saveEntry(collection, resource, onMutation),
    `could not write folder ${folderAddress}`,
  );
  return { resolvedKey: paths.resolvedKey, emptied: saved.emptied ? paths.folderPath : undefined };
}
