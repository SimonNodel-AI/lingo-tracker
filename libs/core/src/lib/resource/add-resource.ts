import { isUntranslatedCopy, normalizeTags, translocoToICU } from '@simoncodes-ca/domain';
import type { Collection } from '../config/open-collection';
import { readProjectTerms, type TerminologyFindings } from '../config/project-terms';
import { ensureDirectoryExists } from '../file-io/directory-operations';
import type { OpenTranslatorOptions } from '../translation/translator';
import { type ResolvedResourcePaths, validateAndResolvePaths } from './resource-file-paths';
import { openResourceFolder } from './resource-folder';
import { type ResourceMutation, upsertMutation } from './resource-mutation';
import {
  assertCollectionLocales,
  type ResourceTranslation,
  seedLocales,
  withTranslatorProblems,
} from './locale-seeding';

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
  /** Locales the Translator skipped (see {@link seedLocales}). Present only when auto-translation ran. */
  readonly skippedLocales?: string[];
  /** The `upsert` for the stored entry. */
  readonly mutations: ResourceMutation[];
  /**
   * Advisory: discouraged terms in the stored base value, any rule-file problem that limited the
   * check, and, when auto-translation ran, a named protected-terms file that does not exist.
   */
  readonly terminology: TerminologyFindings;
}

export interface PreparedResourceAdd {
  readonly params: AddResourceParams;
  readonly paths: ResolvedResourcePaths;
  readonly baseValue: string;
  readonly translations: ResourceTranslation[];
  readonly skippedLocales?: string[];
  readonly terminology: TerminologyFindings;
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
 * translation provider fails. The stored base value is checked against the preferred
 * terminology (Project Terms) and the findings returned; they never block the add.
 *
 * @param options - `provider` / `protectedTerms`: used instead of the collection's (see `openTranslator`).
 * @throws {InvalidResourceKeyError} The key or `targetFolder` is malformed.
 * @throws {LocaleNotFoundError} A supplied translation names a locale the collection does not have.
 * @throws {TranslationError} The translation provider failed.
 * @throws {ProtectedTermsFileError} Auto-translation runs and a protected-terms file is malformed.
 */
export async function addResource(
  collection: Collection,
  params: AddResourceParams,
  options: OpenTranslatorOptions = {},
): Promise<AddResourceResult> {
  return writePreparedResourceAdd(collection, await prepareResourceAdd(collection, params, options));
}

/** Resolves all per-entry validation and translation work before a batch writes. */
export async function prepareResourceAdd(
  collection: Collection,
  params: AddResourceParams,
  options: OpenTranslatorOptions = {},
): Promise<PreparedResourceAdd> {
  const { baseLocale, translationsFolder } = collection;
  const paths = validateAndResolvePaths({ key: params.key, translationsFolder, targetFolder: params.targetFolder });

  const supplied = (params.translations ?? []).filter(({ locale }) => locale !== baseLocale);
  assertCollectionLocales(
    collection,
    supplied.map(({ locale }) => locale),
  );

  const baseValue = translocoToICU(params.baseValue);
  // Resolve every value before touching the disk, so a provider failure writes nothing.
  const seeding = await seedLocales(collection, { baseValue, supplied: supplied.map(({ locale }) => locale) }, options);
  const translations: ResourceTranslation[] = [
    ...supplied.map(({ locale, value, status }) => {
      const normalized = translocoToICU(value);
      return { locale, value: normalized, status: isUntranslatedCopy(normalized, baseValue) ? 'new' : status };
    }),
    ...seeding.translations.map((translation) =>
      isUntranslatedCopy(translation.value, baseValue) ? { ...translation, status: 'new' as const } : translation,
    ),
  ];

  return {
    params,
    paths,
    baseValue,
    translations,
    ...(seeding.skippedLocales !== undefined && { skippedLocales: seeding.skippedLocales }),
    terminology: withTranslatorProblems(
      readProjectTerms(collection).checkBaseValue(paths.resolvedKey, baseValue),
      seeding.problems,
    ),
  };
}

/** Stores an already prepared entry through the same Resource Folder path as a single add. */
export function writePreparedResourceAdd(collection: Collection, prepared: PreparedResourceAdd): AddResourceResult {
  const { paths, params, baseValue, translations } = prepared;
  const { translationsFolder, baseLocale } = collection;
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
    ...(prepared.skippedLocales !== undefined && { skippedLocales: prepared.skippedLocales }),
    mutations: [upsertMutation(translationsFolder, paths.resolvedKey, folder.treeEntry(paths.entryKey))],
    terminology: prepared.terminology,
  };
}
