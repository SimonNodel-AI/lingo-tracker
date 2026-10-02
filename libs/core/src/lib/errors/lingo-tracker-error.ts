import { TRANSLATION_STATUSES } from '@simoncodes-ca/domain';
import { ErrorMessages, type FolderPathPart } from './error-messages';

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

  constructor(message: string, code: string, options?: { readonly cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (options && 'cause' in options) {
      this.cause = options.cause;
    }
  }
}

/** A source file could not be detected, read, or parsed before an import writes resources. */
export class ImportSourceError extends LingoTrackerError {
  readonly kind = 'internal' as const;
  /** `format` keeps the CLI's format-detection message free of the `Import failed:` prefix. */
  readonly stage: 'format' | 'source';
  constructor(message: string, options?: { readonly cause?: unknown; readonly stage?: 'format' | 'source' }) {
    super(message, 'IMPORT_SOURCE_ERROR', options);
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
      'INVALID_IMPORT_LOCALE',
    );
  }
}

/** A whole-collection run requiring one source language found different base locales. */
export class CollectionBaseLocaleMismatchError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly collections: readonly { name: string; baseLocale: string }[];

  constructor(collections: readonly { name: string; baseLocale: string }[]) {
    super(ErrorMessages.collectionBaseLocaleMismatch(collections), 'COLLECTION_BASE_LOCALE_MISMATCH');
    this.collections = collections;
  }
}

/** A glossary needs at least one opened collection. */
export class GlossaryNoCollectionsError extends LingoTrackerError {
  readonly kind = 'internal' as const;
  constructor() {
    super(ErrorMessages.glossaryNoCollections(), 'GLOSSARY_NO_COLLECTIONS');
  }
}

/** The requested glossary extraction mode is unavailable. */
export class GlossaryExtractorError extends LingoTrackerError {
  readonly kind = 'internal' as const;
  readonly mode: string;

  constructor(mode: string) {
    super(ErrorMessages.glossaryExtractorUnavailable(mode), 'GLOSSARY_EXTRACTOR_ERROR');
    this.mode = mode;
  }
}

// --- Config ------------------------------------------------------------------

/** `.lingo-tracker.json` does not exist in the directory that was searched. */
export class ConfigNotFoundError extends LingoTrackerError {
  readonly kind = 'internal' as const;
  readonly configPath: string;

  constructor(configPath: string) {
    super(`${ErrorMessages.configNotFound()}: ${configPath}`, 'CONFIG_NOT_FOUND');
    this.configPath = configPath;
  }
}

/** `.lingo-tracker.json` exists but is not a JSON object. `reason` is the parser's message. */
export class ConfigParseError extends LingoTrackerError {
  readonly kind = 'internal' as const;
  readonly configPath: string;
  readonly reason: string;

  constructor(configPath: string, reason: string) {
    super(ErrorMessages.jsonParseFailed(configPath, reason), 'CONFIG_PARSE_FAILED');
    this.configPath = configPath;
    this.reason = reason;
  }
}

/** A config writer's source snapshot no longer matches the file on disk. */
export class ConfigChangedError extends LingoTrackerError {
  readonly kind = 'conflict' as const;
  constructor() {
    super('The configuration file changed after it was read; run the command again', 'CONFIG_CHANGED');
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
    super(message, 'INVALID_CONFIG', options);
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
    super(message, 'INVALID_PROTECTED_TERMS_FILE');
    this.filePath = filePath;
  }
}

export type ProjectTermsEditProblem =
  | 'protected-conflict'
  | 'protected-missing'
  | 'protected-file-path'
  | 'preferred-missing'
  | 'preferred-conflict'
  | 'preferred-remove-shape'
  | 'preferred-replacement-shape'
  | 'preferred-upsert-shape'
  | 'protected-replacement-conflict';

/** A Project Terms edit has missing or conflicting options. */
export class InvalidProjectTermsEditError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly problem: ProjectTermsEditProblem;

  constructor(message: string, problem: ProjectTermsEditProblem) {
    super(message, 'INVALID_PROJECT_TERMS_EDIT');
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
      'COLLECTION_NOT_FOUND',
    );
    this.collectionName = collectionName;
  }
}

/** A collection with this name is already registered (add, or rename onto it). */
export class CollectionAlreadyExistsError extends LingoTrackerError {
  readonly kind = 'conflict' as const;
  readonly collectionName: string;

  constructor(collectionName: string) {
    super(ErrorMessages.collectionAlreadyExists(collectionName), 'COLLECTION_ALREADY_EXISTS');
    this.collectionName = collectionName;
  }
}

/** Removing this collection would leave one or more bundles empty. */
export class CollectionRequiredByBundleError extends LingoTrackerError {
  readonly kind = 'conflict' as const;
  readonly collectionName: string;
  readonly bundleNames: readonly string[];

  constructor(collectionName: string, bundleNames: readonly string[]) {
    super(ErrorMessages.collectionRequiredByBundles(collectionName, bundleNames), 'COLLECTION_REQUIRED_BY_BUNDLE');
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
      'COLLECTION_RENAME_BUNDLE_CONFLICT',
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
    super(ErrorMessages.collectionReadOnly(collectionName), 'COLLECTION_READ_ONLY');
    this.collectionName = collectionName;
  }
}

export type CollectionTagEditProblem = 'tag-conflict' | 'tag-missing';

/** A collection record cannot be stored as given (for example a blank `translationsFolder`). */
export class InvalidCollectionError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  /** Set for a field-shape error whose API message includes the `collection.` prefix. */
  readonly field?: string;
  readonly problem?: CollectionTagEditProblem;
  constructor(message: string, options?: { readonly field?: string; readonly problem?: CollectionTagEditProblem }) {
    super(message, 'INVALID_COLLECTION');
    this.field = options?.field;
    this.problem = options?.problem;
  }
}

/** Terms were given for a collection that has no `protectedTermsFile` pointer to write them to. */
export class ProtectedTermsFileNotSetError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly collectionName: string;

  constructor(collectionName: string) {
    super(ErrorMessages.protectedTermsFileNotSet(collectionName), 'PROTECTED_TERMS_FILE_NOT_SET');
    this.collectionName = collectionName;
  }
}

/** A terminology file cannot be written because its parent directory does not exist. */
export class ParentDirectoryMissingError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly filePath: string;
  readonly directory: string;

  constructor(what: string, filePath: string, directory: string) {
    super(ErrorMessages.parentDirectoryMissing(what, directory), 'PARENT_DIRECTORY_MISSING');
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
      'INVALID_TRANSLATION_STATUS',
    );
  }
}

/** The locale string is malformed. The message is the domain validator's text. */
export class InvalidLocaleError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly locale: string;

  constructor(locale: string, message: string) {
    super(message, 'INVALID_LOCALE');
    this.locale = locale;
  }
}

/** The collection does not list this locale. */
export class LocaleNotFoundError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly locale: string;
  readonly collectionName: string;

  constructor(locale: string, collectionName: string) {
    super(ErrorMessages.localeNotFound(locale, collectionName), 'LOCALE_NOT_FOUND');
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
    super(ErrorMessages.localeAlreadyExists(locale, collectionName), 'LOCALE_ALREADY_EXISTS');
    this.locale = locale;
    this.collectionName = collectionName;
  }
}

/** The base locale cannot be added to or removed from a collection. */
export class BaseLocaleImmutableError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly locale: string;

  constructor(locale: string) {
    super(ErrorMessages.cannotModifyBaseLocale(locale), 'BASE_LOCALE_IMMUTABLE');
    this.locale = locale;
  }
}

// --- Resources and folders ---------------------------------------------------

/** The resource key (or its target folder) is malformed. The message is the domain validator's text. */
export class InvalidResourceKeyError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly key: string;

  constructor(key: string, message: string) {
    super(message, 'INVALID_RESOURCE_KEY');
    this.key = key;
  }
}

/** No resource exists at this (resolved) key. */
export class ResourceNotFoundError extends LingoTrackerError {
  readonly kind = 'not-found' as const;
  readonly key: string;

  constructor(key: string) {
    super(ErrorMessages.resourceNotFound(key), 'RESOURCE_NOT_FOUND');
    this.key = key;
  }
}

/** A resource already exists at this (resolved) key, and the operation does not overwrite it. */
export class ResourceAlreadyExistsError extends LingoTrackerError {
  readonly kind = 'conflict' as const;
  readonly key: string;

  constructor(key: string) {
    super(ErrorMessages.resourceAlreadyExists(key), 'RESOURCE_ALREADY_EXISTS');
    this.key = key;
  }
}

/** No folder exists at this dot-delimited path (or the path is not a directory). */
export class FolderNotFoundError extends LingoTrackerError {
  readonly kind = 'not-found' as const;
  readonly folderPath: string;

  constructor(folderPath: string) {
    super(ErrorMessages.folderNotFound(folderPath), 'FOLDER_NOT_FOUND');
    this.folderPath = folderPath;
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
      'FOLDER_MOVE_INTO_DESCENDANT',
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
    super(ErrorMessages.invalidFolderSegment(part, segment), 'INVALID_FOLDER_PATH');
    this.part = part;
    this.segment = segment;
  }
}

// --- Translation -------------------------------------------------------------

/** An auto-translate operation was asked of a collection whose translation config is missing or disabled. */
export class AutoTranslationDisabledError extends LingoTrackerError {
  readonly kind = 'unavailable' as const;
  readonly collectionName: string;

  constructor(collectionName: string) {
    super(ErrorMessages.autoTranslationDisabled(collectionName), 'AUTO_TRANSLATION_DISABLED');
    this.collectionName = collectionName;
  }
}

/** A collection's base locale is not a translation target. */
export class CannotTranslateBaseLocaleError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly locale: string;

  constructor(locale: string) {
    super(ErrorMessages.cannotTranslateBaseLocale(locale), 'CANNOT_TRANSLATE_BASE_LOCALE');
    this.locale = locale;
  }
}

/** The requested translation target is not configured for this collection. */
export class TranslationLocaleNotConfiguredError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly locale: string;
  readonly availableLocales: readonly string[];

  constructor(locale: string, availableLocales: readonly string[]) {
    super(ErrorMessages.translationLocaleNotConfigured(locale, availableLocales), 'TRANSLATION_LOCALE_NOT_CONFIGURED');
    this.locale = locale;
    this.availableLocales = [...availableLocales];
  }
}

// --- Bundles -----------------------------------------------------------------

/** A constant-name override was supplied for more than one bundle. */
export class MultipleBundleConstantNameError extends LingoTrackerError {
  readonly kind = 'internal' as const;
  constructor() {
    super('A token constant name override needs exactly one bundle.', 'MULTIPLE_BUNDLE_CONSTANT_NAME');
  }
}

/** The config has no bundle with this name. */
export class BundleNotFoundError extends LingoTrackerError {
  readonly kind = 'not-found' as const;
  readonly bundleName: string;

  constructor(bundleName: string) {
    super(ErrorMessages.bundleNotFound(bundleName), 'BUNDLE_NOT_FOUND');
    this.bundleName = bundleName;
  }
}

/** A bundle generation locale filter is malformed or names unconfigured project locales. */
export class InvalidBundleLocalesError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  constructor(message: string) {
    super(message, 'INVALID_BUNDLE_LOCALES');
  }
}

/** A bundle with this name already exists (add, or rename onto it). */
export class BundleAlreadyExistsError extends LingoTrackerError {
  readonly kind = 'conflict' as const;
  readonly bundleName: string;

  constructor(bundleName: string) {
    super(ErrorMessages.bundleAlreadyExists(bundleName), 'BUNDLE_ALREADY_EXISTS');
    this.bundleName = bundleName;
  }
}

/** A bundle key or definition failed validation. `errors` holds every problem found. */
export class InvalidBundleDefinitionError extends LingoTrackerError {
  readonly kind = 'invalid' as const;
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(ErrorMessages.invalidBundleDefinition(errors), 'INVALID_BUNDLE_DEFINITION');
    this.errors = errors;
  }
}

/** A core operation failed with a CLI-visible message that the API has historically hidden. */
export class CoreOperationError extends LingoTrackerError {
  readonly kind = 'internal' as const;
  override readonly exposeMessage = false;

  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, 'CORE_OPERATION_ERROR', options);
    // Some import summaries stringify a caught error; retain the old `Error: ...` text.
    this.name = 'Error';
  }
}
