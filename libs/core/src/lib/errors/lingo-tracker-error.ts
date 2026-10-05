import { ERROR_CODES, type ProviderErrorCode } from './error-codes';
import type { CollectionFolderProblem } from '../resource/collection-folders';
import { type PreferredTermRule, type PreferredTermRuleError, TRANSLATION_STATUSES } from '@simoncodes-ca/domain';
import { ErrorMessages, type FolderPathPart } from './error-messages';
import { formatRuleErrors } from './format-rule-errors';

export type ErrorKind = 'not-found' | 'conflict' | 'invalid' | 'forbidden' | 'unavailable' | 'upstream' | 'internal';

/**
 * Base class for errors LingoTracker raises on purpose. Each subclass declares a
 * kind for adapter mapping; `code` identifies the specific failure.
 *
 * `code` is stable and machine-readable (for example `RESOURCE_NOT_FOUND`); the message
 * is for people and may change.
 */
export abstract class LingoTrackerError extends Error {
  abstract readonly kind: ErrorKind;
  readonly exposeMessage: boolean = true;
  readonly code: string;
  /** The underlying error, when this one wraps it. Not part of the message, so it never reaches a client. */
  readonly cause?: unknown;

  /** Additional domain validation problems, when the error has a list. */
  readonly details?: readonly unknown[];

  constructor(message: string, code: string, options?: { readonly cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (options && 'cause' in options) {
      this.cause = options.cause;
    }
  }
}

/** A named move destination cannot be opened without project config. */
export class MoveConfigRequiredError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  constructor() {
    super('Move destination resolution requires config', ERROR_CODES.MOVE_CONFIG_REQUIRED);
  }
}

/** A source file could not be detected, read, or parsed before an import writes resources. */
export class ImportSourceError extends LingoTrackerError {
  readonly kind = 'internal' as const;
  /** `format` keeps the CLI's format-detection message free of the `Import failed:` prefix. */
  readonly stage: 'format' | 'source';
  constructor(message: string, options?: { readonly cause?: unknown; readonly stage?: 'format' | 'source' }) {
    super(message, ERROR_CODES.IMPORT_SOURCE_ERROR, options);
    this.stage = options?.stage ?? 'source';
  }
}

/** An import strategy cannot write to the collection's base locale. */
export class InvalidImportLocaleError extends LingoTrackerError {
  // Before kind mapping this class used the typed fallback: 500 with its message.
  readonly kind = 'internal' as const;
  constructor(baseLocale: string, strategy: string) {
    super(
      `Cannot import into base locale "${baseLocale}" with strategy "${strategy}". ` +
        'Only "migration" strategy supports base locale imports.',
      ERROR_CODES.INVALID_IMPORT_LOCALE,
    );
  }
}

/** A whole-collection run requiring one source language found different base locales. */
export class CollectionBaseLocaleMismatchError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly collections: readonly { name: string; baseLocale: string }[];

  constructor(collections: readonly { name: string; baseLocale: string }[]) {
    super(ErrorMessages.collectionBaseLocaleMismatch(collections), ERROR_CODES.COLLECTION_BASE_LOCALE_MISMATCH);
    this.collections = collections;
  }
}

/** A glossary needs at least one opened collection. */
export class GlossaryNoCollectionsError extends LingoTrackerError {
  readonly kind = 'internal' as const;
  constructor() {
    super(ErrorMessages.glossaryNoCollections(), ERROR_CODES.GLOSSARY_NO_COLLECTIONS);
  }
}

/** The requested glossary extraction mode is unavailable. */
export class GlossaryExtractorError extends LingoTrackerError {
  readonly kind = 'internal' as const;
  readonly mode: string;

  constructor(mode: string) {
    super(ErrorMessages.glossaryExtractorUnavailable(mode), ERROR_CODES.GLOSSARY_EXTRACTOR_ERROR);
    this.mode = mode;
  }
}

// --- Config ------------------------------------------------------------------

/** `.lingo-tracker.json` does not exist in the directory that was searched. */
export class ConfigNotFoundError extends LingoTrackerError {
  readonly kind = 'internal' as const;
  readonly configPath: string;

  constructor(configPath: string) {
    super(`${ErrorMessages.configNotFound()}: ${configPath}`, ERROR_CODES.CONFIG_NOT_FOUND);
    this.configPath = configPath;
  }
}

/** `.lingo-tracker.json` exists but is not a JSON object. `reason` is the parser's message. */
export class ConfigParseError extends LingoTrackerError {
  readonly kind = 'internal' as const;
  readonly configPath: string;
  readonly reason: string;

  constructor(configPath: string, reason: string) {
    super(ErrorMessages.jsonParseFailed(configPath, reason), ERROR_CODES.CONFIG_PARSE_FAILED);
    this.configPath = configPath;
    this.reason = reason;
  }
}

/** A config writer's source snapshot no longer matches the file on disk. */
export class ConfigChangedError extends LingoTrackerError {
  readonly kind = 'conflict' as const;
  constructor() {
    super('The configuration file changed after it was read; run the command again', ERROR_CODES.CONFIG_CHANGED);
  }
}

/**
 * `.lingo-tracker.json` cannot be used: a required field is missing or has the wrong shape, a
 * file pointer in it is not a string, or the file cannot be read or written. The message is
 * fixed text that names only `.lingo-tracker.json` and, for a shape problem, the field; it never
 * holds a path or an I/O detail, so an adapter can show it as is. An I/O failure is in `cause`.
 */
export class InvalidConfigError extends LingoTrackerError {
  readonly kind = 'internal' as const;
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, ERROR_CODES.INVALID_CONFIG, options);
  }
}

/**
 * A protected-terms file exists but cannot be used: it is not valid JSON, or not a JSON array of
 * strings. A corrupt list is an error, not an empty list, so it never protects nothing silently.
 */
export class ProtectedTermsFileError extends LingoTrackerError {
  readonly kind = 'internal' as const;
  readonly filePath: string;

  constructor(filePath: string, message: string) {
    super(message, ERROR_CODES.INVALID_PROTECTED_TERMS_FILE);
    this.filePath = filePath;
  }
}

export type ProtectedTermsEditProblem =
  | 'protected-conflict'
  | 'protected-missing'
  | 'protected-file-path'
  | 'protected-replacement-conflict';

export type PreferredTerminologyEditProblem =
  | 'preferred-missing'
  | 'preferred-conflict'
  | 'preferred-remove-shape'
  | 'preferred-replacement-shape'
  | 'preferred-upsert-shape'
  | 'preferred-orphan-flags'
  | 'preferred-incomplete-flags';

const protectedTermsProblems: Record<ProtectedTermsEditProblem, true> = {
  'protected-conflict': true,
  'protected-missing': true,
  'protected-file-path': true,
  'protected-replacement-conflict': true,
};
const preferredTerminologyProblems: Record<PreferredTerminologyEditProblem, true> = {
  'preferred-missing': true,
  'preferred-conflict': true,
  'preferred-remove-shape': true,
  'preferred-replacement-shape': true,
  'preferred-upsert-shape': true,
  'preferred-orphan-flags': true,
  'preferred-incomplete-flags': true,
};

export function isProtectedTermsEditProblem(problem: unknown): problem is ProtectedTermsEditProblem {
  return typeof problem === 'string' && Object.keys(protectedTermsProblems).includes(problem);
}
export function isPreferredTerminologyEditProblem(problem: unknown): problem is PreferredTerminologyEditProblem {
  return typeof problem === 'string' && Object.keys(preferredTerminologyProblems).includes(problem);
}

/** A Project Terms edit has missing or conflicting options. */
export class InvalidProjectTermsEditError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly problem: ProtectedTermsEditProblem | PreferredTerminologyEditProblem;

  constructor(message: string, problem: ProtectedTermsEditProblem | PreferredTerminologyEditProblem) {
    super(message, ERROR_CODES.INVALID_PROJECT_TERMS_EDIT);
    this.problem = problem;
  }
}

// --- Collections -------------------------------------------------------------

/** The config has no collection with this name. */
export class CollectionNotFoundError extends LingoTrackerError {
  readonly kind = 'not-found' as const;
  readonly collectionName: string;

  constructor(collectionName: string, role: 'source' | 'destination' = 'source') {
    super(
      role === 'destination'
        ? `Destination collection "${collectionName}" not found`
        : ErrorMessages.collectionNotFound(collectionName),
      ERROR_CODES.COLLECTION_NOT_FOUND,
    );
    this.collectionName = collectionName;
  }
}

/** A collection with this name is already registered (add, or rename onto it). */
export class CollectionAlreadyExistsError extends LingoTrackerError {
  readonly kind = 'conflict' as const;
  readonly collectionName: string;

  constructor(collectionName: string) {
    super(ErrorMessages.collectionAlreadyExists(collectionName), ERROR_CODES.COLLECTION_ALREADY_EXISTS);
    this.collectionName = collectionName;
  }
}

/** Removing this collection would leave one or more bundles empty. */
export class CollectionRequiredByBundleError extends LingoTrackerError {
  readonly kind = 'conflict' as const;
  readonly collectionName: string;
  readonly bundleNames: readonly string[];

  constructor(collectionName: string, bundleNames: readonly string[]) {
    super(
      ErrorMessages.collectionRequiredByBundles(collectionName, bundleNames),
      ERROR_CODES.COLLECTION_REQUIRED_BY_BUNDLE,
    );
    this.collectionName = collectionName;
    this.bundleNames = bundleNames;
  }
}

/** A rename target already appears in explicit bundle references. */
export class CollectionRenameBundleConflictError extends LingoTrackerError {
  readonly kind = 'conflict' as const;
  readonly collectionName: string;
  readonly newCollectionName: string;
  readonly bundleNames: readonly string[];

  constructor(collectionName: string, newCollectionName: string, bundleNames: readonly string[]) {
    super(
      ErrorMessages.collectionRenameBundleConflict(collectionName, newCollectionName, bundleNames),
      ERROR_CODES.COLLECTION_RENAME_BUNDLE_CONFLICT,
    );
    this.collectionName = collectionName;
    this.newCollectionName = newCollectionName;
    this.bundleNames = bundleNames;
  }
}

/** A mutating operation was asked of a collection flagged `readOnly`. */
export class ReadOnlyCollectionError extends LingoTrackerError {
  readonly kind = 'forbidden' as const;
  readonly collectionName: string;

  constructor(collectionName: string) {
    super(ErrorMessages.collectionReadOnly(collectionName), ERROR_CODES.COLLECTION_READ_ONLY);
    this.collectionName = collectionName;
  }
}

export type CollectionTagEditProblem = 'tag-conflict' | 'tag-missing';

/** A collection record cannot be stored as given (for example a blank `translationsFolder`). */
export class InvalidCollectionError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  /** The field with a shape error, when validation identifies one. */
  readonly field?: string;
  readonly problem?: CollectionTagEditProblem;

  constructor(message: string, options?: { readonly field?: string; readonly problem?: CollectionTagEditProblem }) {
    super(message, ERROR_CODES.INVALID_COLLECTION);
    this.field = options?.field;
    this.problem = options?.problem;
  }
}

/** A supplied rename target is blank after trimming. */
export class InvalidNameError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  constructor() {
    super(ErrorMessages.nameRequired(), ERROR_CODES.INVALID_NAME);
  }
}

/** Terms were given for a collection that has no `protectedTermsFile` pointer to write them to. */
export class ProtectedTermsFileNotSetError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly collectionName: string;

  constructor(collectionName: string) {
    super(ErrorMessages.protectedTermsFileNotSet(collectionName), ERROR_CODES.PROTECTED_TERMS_FILE_NOT_SET);
    this.collectionName = collectionName;
  }
}

/** A terminology file cannot be written because its parent directory does not exist. */
export class ParentDirectoryMissingError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly filePath: string;
  readonly directory: string;

  constructor(what: string, filePath: string, directory: string) {
    super(ErrorMessages.parentDirectoryMissing(what, directory), ERROR_CODES.PARENT_DIRECTORY_MISSING);
    this.filePath = filePath;
    this.directory = directory;
  }
}

// --- Locales -----------------------------------------------------------------

/** A caller supplied a translation status outside the domain status list. */
export class InvalidTranslationStatusError extends LingoTrackerError {
  readonly kind = 'invalid' as const;

  constructor(status: unknown) {
    super(
      `Invalid translation status "${String(status)}". Valid statuses: ${TRANSLATION_STATUSES.join(', ')}`,
      ERROR_CODES.INVALID_TRANSLATION_STATUS,
    );
  }
}

/** The locale string is malformed. The message is the domain validator's text. */
export class InvalidLocaleError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly locale: string;

  constructor(locale: string, message: string) {
    super(message, ERROR_CODES.INVALID_LOCALE);
    this.locale = locale;
  }
}

/** The collection does not list this locale. */
export class LocaleNotFoundError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly locale: string;
  readonly collectionName: string;

  constructor(locale: string, collectionName: string) {
    super(ErrorMessages.localeNotFound(locale, collectionName), ERROR_CODES.LOCALE_NOT_FOUND);
    this.locale = locale;
    this.collectionName = collectionName;
  }
}

/** The collection already lists this locale. */
export class LocaleAlreadyExistsError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly locale: string;
  readonly collectionName: string;

  constructor(locale: string, collectionName: string) {
    super(ErrorMessages.localeAlreadyExists(locale, collectionName), ERROR_CODES.LOCALE_ALREADY_EXISTS);
    this.locale = locale;
    this.collectionName = collectionName;
  }
}

/** The base locale cannot be added to or removed from a collection. */
export class BaseLocaleImmutableError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly locale: string;

  constructor(locale: string) {
    super(ErrorMessages.cannotModifyBaseLocale(locale), ERROR_CODES.BASE_LOCALE_IMMUTABLE);
    this.locale = locale;
  }
}

// --- Resources and folders ---------------------------------------------------

/** The resource key (or its target folder) is malformed. The message is the domain validator's text. */
export class InvalidResourceKeyError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly key: string;

  constructor(key: string, message: string) {
    super(message, ERROR_CODES.INVALID_RESOURCE_KEY);
    this.key = key;
  }
}

/** No resource exists at this (resolved) key. */
export class ResourceNotFoundError extends LingoTrackerError {
  readonly kind = 'not-found' as const;
  readonly key: string;

  constructor(key: string) {
    super(ErrorMessages.resourceNotFound(key), ERROR_CODES.RESOURCE_NOT_FOUND);
    this.key = key;
  }
}

/** A resource already exists at this (resolved) key, and the operation does not overwrite it. */
export class ResourceAlreadyExistsError extends LingoTrackerError {
  readonly kind = 'conflict' as const;
  readonly key: string;

  constructor(key: string) {
    super(ErrorMessages.resourceAlreadyExists(key), ERROR_CODES.RESOURCE_ALREADY_EXISTS);
    this.key = key;
  }
}

/** No folder exists at this dot-delimited path (or the path is not a directory). */
export class FolderNotFoundError extends LingoTrackerError {
  readonly kind = 'not-found' as const;
  readonly folderPath: string;

  constructor(folderPath: string) {
    super(ErrorMessages.folderNotFound(folderPath), ERROR_CODES.FOLDER_NOT_FOUND);
    this.folderPath = folderPath;
  }
}

/** An address names a folder outside the collection policy, or one that cannot be accessed. */
export class InvalidCollectionFolderError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  constructor(
    readonly problem: CollectionFolderProblem,
    operation: 'access' | 'delete' | 'move' = 'access',
    targetPath = problem.folderPath,
  ) {
    const reason =
      targetPath === problem.folderPath ? problem.message : `Folder '${problem.folderPath}': ${problem.message}`;
    super(`Cannot ${operation} folder '${targetPath || '(root)'}': ${reason}`, ERROR_CODES.INVALID_COLLECTION_FOLDER);
  }
}

/** A folder move names a destination inside the folder being moved. */
export class FolderMoveIntoDescendantError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly sourceFolderPath: string;
  readonly destinationFolderPath: string;

  constructor(sourceFolderPath: string, destinationFolderPath: string) {
    super(
      ErrorMessages.folderMoveIntoDescendant(sourceFolderPath, destinationFolderPath),
      ERROR_CODES.FOLDER_MOVE_INTO_DESCENDANT,
    );
    this.sourceFolderPath = sourceFolderPath;
    this.destinationFolderPath = destinationFolderPath;
  }
}

/** A segment of a dot-delimited folder path is malformed. */
export class InvalidFolderPathError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly segment: string;
  readonly part: FolderPathPart;

  constructor(part: FolderPathPart, segment: string) {
    super(ErrorMessages.invalidFolderSegment(part, segment), ERROR_CODES.INVALID_FOLDER_PATH);
    this.part = part;
    this.segment = segment;
  }
}

// --- Translation -------------------------------------------------------------

/**
 * A provider failure. `retryable` indicates whether retrying can help.
 * The provider code taxonomy remains independent of the adapter-facing kind.
 */
export class TranslationError extends LingoTrackerError {
  declare readonly code: ProviderErrorCode;
  readonly kind = 'upstream' as const;
  readonly retryable: boolean;
  readonly providerErrorCode: string | undefined;

  /** `code` names the failure kind, e.g. `MISSING_API_KEY`, `RATE_LIMIT`, `INVALID_REQUEST`. */
  constructor(message: string, code: ProviderErrorCode, retryable: boolean, providerErrorCode?: string) {
    super(message, code);
    this.retryable = retryable;
    this.providerErrorCode = providerErrorCode;
  }
}

/** An auto-translate operation was asked of a collection whose translation config is missing or disabled. */
export class AutoTranslationDisabledError extends LingoTrackerError {
  readonly kind = 'unavailable' as const;
  readonly collectionName: string;

  constructor(collectionName: string) {
    super(ErrorMessages.autoTranslationDisabled(collectionName), ERROR_CODES.AUTO_TRANSLATION_DISABLED);
    this.collectionName = collectionName;
  }
}

/** An enabled collection has no target locales for a locale run. */
export class NoTranslationTargetLocalesError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  constructor(baseLocale: string) {
    super(
      `No target locales configured. Add locales other than the base locale "${baseLocale}".`,
      ERROR_CODES.NO_TRANSLATION_TARGET_LOCALES,
    );
  }
}

/** A collection's base locale is not a translation target. */
export class CannotTranslateBaseLocaleError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly locale: string;

  constructor(locale: string) {
    super(ErrorMessages.cannotTranslateBaseLocale(locale), ERROR_CODES.CANNOT_TRANSLATE_BASE_LOCALE);
    this.locale = locale;
  }
}

/** The requested translation target is not configured for this collection. */
export class TranslationLocaleNotConfiguredError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly locale: string;
  readonly availableLocales: readonly string[];

  constructor(locale: string, availableLocales: readonly string[]) {
    super(
      ErrorMessages.translationLocaleNotConfigured(locale, availableLocales),
      ERROR_CODES.TRANSLATION_LOCALE_NOT_CONFIGURED,
    );
    this.locale = locale;
    this.availableLocales = [...availableLocales];
  }
}

// --- Bundles -----------------------------------------------------------------

/** A constant-name override was supplied for more than one bundle. */
export class MultipleBundleConstantNameError extends LingoTrackerError {
  readonly kind = 'internal' as const;
  constructor() {
    super('A token constant name override needs exactly one bundle.', ERROR_CODES.MULTIPLE_BUNDLE_CONSTANT_NAME);
  }
}

/** The config has no bundle with this name. */
export class BundleNotFoundError extends LingoTrackerError {
  readonly kind = 'not-found' as const;
  readonly bundleName: string;

  constructor(bundleName: string) {
    super(ErrorMessages.bundleNotFound(bundleName), ERROR_CODES.BUNDLE_NOT_FOUND);
    this.bundleName = bundleName;
  }
}

/** A bundle generation locale filter is malformed or names unconfigured project locales. */
export class InvalidBundleLocalesError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  constructor(message: string) {
    super(message, ERROR_CODES.INVALID_BUNDLE_LOCALES);
  }
}

/** A bundle with this name already exists (add, or rename onto it). */
export class BundleAlreadyExistsError extends LingoTrackerError {
  readonly kind = 'conflict' as const;
  readonly bundleName: string;

  constructor(bundleName: string) {
    super(ErrorMessages.bundleAlreadyExists(bundleName), ERROR_CODES.BUNDLE_ALREADY_EXISTS);
    this.bundleName = bundleName;
  }
}

/** A bundle key or definition failed validation. `errors` holds every problem found. */
export class InvalidBundleDefinitionError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  override readonly details: readonly string[];
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(ErrorMessages.invalidBundleDefinition(errors), ERROR_CODES.INVALID_BUNDLE_DEFINITION);
    this.errors = errors;
    this.details = errors;
  }
}

/** Invalid preferred-terminology rules. Validation leaves the file untouched. */
export class PreferredTerminologyValidationError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  override readonly details: readonly PreferredTermRuleError[];
  readonly errors: PreferredTermRuleError[];
  readonly submittedRules?: readonly PreferredTermRule[];

  constructor(errors: PreferredTermRuleError[], submittedRules?: readonly PreferredTermRule[]) {
    super(
      `Invalid preferred terminology rules: ${formatRuleErrors(errors)}`,
      ERROR_CODES.INVALID_PREFERRED_TERMINOLOGY,
    );
    this.errors = errors;
    this.details = errors;
    this.submittedRules = submittedRules;
  }
}

/** A core operation failed with a CLI-visible message that the API has historically hidden. */
export class CoreOperationError extends LingoTrackerError {
  readonly kind = 'internal' as const;
  override readonly exposeMessage = false;

  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, ERROR_CODES.CORE_OPERATION_ERROR, options);
    // Some import summaries stringify a caught error; retain the old `Error: ...` text.
    this.name = 'Error';
  }
}
