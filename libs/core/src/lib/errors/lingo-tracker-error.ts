import { ErrorMessages, type FolderPathPart } from './error-messages';

/**
 * Base class for errors LingoTracker raises on purpose. Adapters (CLI, API) test
 * `instanceof` on a subclass, or read `code`, to choose an exit code or HTTP status,
 * instead of matching message text.
 *
 * `code` is stable and machine-readable (for example `RESOURCE_NOT_FOUND`); the message
 * is for people and may change.
 */
export class LingoTrackerError extends Error {
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

// --- Config ------------------------------------------------------------------

/** `.lingo-tracker.json` does not exist in the directory that was searched. */
export class ConfigNotFoundError extends LingoTrackerError {
  readonly configPath: string;

  constructor(configPath: string) {
    super(`${ErrorMessages.configNotFound()}: ${configPath}`, 'CONFIG_NOT_FOUND');
    this.configPath = configPath;
  }
}

/** `.lingo-tracker.json` exists but is not a JSON object. `reason` is the parser's message. */
export class ConfigParseError extends LingoTrackerError {
  readonly configPath: string;
  readonly reason: string;

  constructor(configPath: string, reason: string) {
    super(ErrorMessages.jsonParseFailed(configPath, reason), 'CONFIG_PARSE_FAILED');
    this.configPath = configPath;
    this.reason = reason;
  }
}

/**
 * `.lingo-tracker.json` cannot be used: a required field is missing or has the wrong shape, a
 * file pointer in it is not a string, or the file cannot be read or written. The message is
 * fixed text that names only `.lingo-tracker.json` and, for a shape problem, the field; it never
 * holds a path or an I/O detail, so an adapter can show it as is. An I/O failure is in `cause`.
 */
export class InvalidConfigError extends LingoTrackerError {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, 'INVALID_CONFIG', options);
  }
}

/**
 * A protected-terms file exists but cannot be used: it is not valid JSON, or not a JSON array of
 * strings. A corrupt list is an error, not an empty list, so it never protects nothing silently.
 */
export class ProtectedTermsFileError extends LingoTrackerError {
  readonly filePath: string;

  constructor(filePath: string, message: string) {
    super(message, 'INVALID_PROTECTED_TERMS_FILE');
    this.filePath = filePath;
  }
}

// --- Collections -------------------------------------------------------------

/** The config has no collection with this name. */
export class CollectionNotFoundError extends LingoTrackerError {
  readonly collectionName: string;

  constructor(collectionName: string) {
    super(ErrorMessages.collectionNotFound(collectionName), 'COLLECTION_NOT_FOUND');
    this.collectionName = collectionName;
  }
}

/** A collection with this name is already registered (add, or rename onto it). */
export class CollectionAlreadyExistsError extends LingoTrackerError {
  readonly collectionName: string;

  constructor(collectionName: string) {
    super(ErrorMessages.collectionAlreadyExists(collectionName), 'COLLECTION_ALREADY_EXISTS');
    this.collectionName = collectionName;
  }
}

/** A mutating operation was asked of a collection flagged `readOnly`. */
export class ReadOnlyCollectionError extends LingoTrackerError {
  readonly collectionName: string;

  constructor(collectionName: string) {
    super(ErrorMessages.collectionReadOnly(collectionName), 'COLLECTION_READ_ONLY');
    this.collectionName = collectionName;
  }
}

/** A collection record cannot be stored as given (for example a blank `translationsFolder`). */
export class InvalidCollectionError extends LingoTrackerError {
  constructor(message: string) {
    super(message, 'INVALID_COLLECTION');
  }
}

/** Terms were given for a collection that has no `protectedTermsFile` pointer to write them to. */
export class ProtectedTermsFileNotSetError extends LingoTrackerError {
  readonly collectionName: string;

  constructor(collectionName: string) {
    super(ErrorMessages.protectedTermsFileNotSet(collectionName), 'PROTECTED_TERMS_FILE_NOT_SET');
    this.collectionName = collectionName;
  }
}

/** A terminology file cannot be written because its parent directory does not exist. */
export class ParentDirectoryMissingError extends LingoTrackerError {
  readonly filePath: string;
  readonly directory: string;

  constructor(what: string, filePath: string, directory: string) {
    super(ErrorMessages.parentDirectoryMissing(what, directory), 'PARENT_DIRECTORY_MISSING');
    this.filePath = filePath;
    this.directory = directory;
  }
}

// --- Locales -----------------------------------------------------------------

/** The locale string is malformed. The message is the domain validator's text. */
export class InvalidLocaleError extends LingoTrackerError {
  readonly locale: string;

  constructor(locale: string, message: string) {
    super(message, 'INVALID_LOCALE');
    this.locale = locale;
  }
}

/** The collection does not list this locale. */
export class LocaleNotFoundError extends LingoTrackerError {
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
  readonly locale: string;

  constructor(locale: string) {
    super(ErrorMessages.cannotModifyBaseLocale(locale), 'BASE_LOCALE_IMMUTABLE');
    this.locale = locale;
  }
}

// --- Resources and folders ---------------------------------------------------

/** The resource key (or its target folder) is malformed. The message is the domain validator's text. */
export class InvalidResourceKeyError extends LingoTrackerError {
  readonly key: string;

  constructor(key: string, message: string) {
    super(message, 'INVALID_RESOURCE_KEY');
    this.key = key;
  }
}

/** No resource exists at this (resolved) key. */
export class ResourceNotFoundError extends LingoTrackerError {
  readonly key: string;

  constructor(key: string) {
    super(ErrorMessages.resourceNotFound(key), 'RESOURCE_NOT_FOUND');
    this.key = key;
  }
}

/** A resource already exists at this (resolved) key, and the operation does not overwrite it. */
export class ResourceAlreadyExistsError extends LingoTrackerError {
  readonly key: string;

  constructor(key: string) {
    super(ErrorMessages.resourceAlreadyExists(key), 'RESOURCE_ALREADY_EXISTS');
    this.key = key;
  }
}

/** No folder exists at this dot-delimited path (or the path is not a directory). */
export class FolderNotFoundError extends LingoTrackerError {
  readonly folderPath: string;

  constructor(folderPath: string) {
    super(ErrorMessages.folderNotFound(folderPath), 'FOLDER_NOT_FOUND');
    this.folderPath = folderPath;
  }
}

/** A folder move names a destination inside the folder being moved. */
export class FolderMoveIntoDescendantError extends LingoTrackerError {
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
  readonly collectionName: string;

  constructor(collectionName: string) {
    super(ErrorMessages.autoTranslationDisabled(collectionName), 'AUTO_TRANSLATION_DISABLED');
    this.collectionName = collectionName;
  }
}

/** A collection's base locale is not a translation target. */
export class CannotTranslateBaseLocaleError extends LingoTrackerError {
  readonly locale: string;

  constructor(locale: string) {
    super(ErrorMessages.cannotTranslateBaseLocale(locale), 'CANNOT_TRANSLATE_BASE_LOCALE');
    this.locale = locale;
  }
}

/** The requested translation target is not configured for this collection. */
export class TranslationLocaleNotConfiguredError extends LingoTrackerError {
  readonly locale: string;
  readonly availableLocales: readonly string[];

  constructor(locale: string, availableLocales: readonly string[]) {
    super(ErrorMessages.translationLocaleNotConfigured(locale, availableLocales), 'TRANSLATION_LOCALE_NOT_CONFIGURED');
    this.locale = locale;
    this.availableLocales = [...availableLocales];
  }
}

// --- Bundles -----------------------------------------------------------------

/** The config has no bundle with this name. */
export class BundleNotFoundError extends LingoTrackerError {
  readonly bundleName: string;

  constructor(bundleName: string) {
    super(ErrorMessages.bundleNotFound(bundleName), 'BUNDLE_NOT_FOUND');
    this.bundleName = bundleName;
  }
}

/** A bundle generation locale filter is malformed or names unconfigured project locales. */
export class InvalidBundleLocalesError extends LingoTrackerError {
  constructor(message: string) {
    super(message, 'INVALID_BUNDLE_LOCALES');
  }
}

/** A bundle with this name already exists (add, or rename onto it). */
export class BundleAlreadyExistsError extends LingoTrackerError {
  readonly bundleName: string;

  constructor(bundleName: string) {
    super(ErrorMessages.bundleAlreadyExists(bundleName), 'BUNDLE_ALREADY_EXISTS');
    this.bundleName = bundleName;
  }
}

/** A bundle key or definition failed validation. `errors` holds every problem found. */
export class InvalidBundleDefinitionError extends LingoTrackerError {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(ErrorMessages.invalidBundleDefinition(errors), 'INVALID_BUNDLE_DEFINITION');
    this.errors = errors;
  }
}
