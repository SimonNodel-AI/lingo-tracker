// Typed core errors. Callers map them by class (the API's exception filter, the CLI's reporter).

export type { FolderPathPart } from './error-messages';
export {
  AutoTranslationDisabledError,
  BaseLocaleImmutableError,
  BundleAlreadyExistsError,
  BundleNotFoundError,
  CollectionAlreadyExistsError,
  CollectionNotFoundError,
  ConfigNotFoundError,
  ConfigParseError,
  FolderMoveIntoDescendantError,
  FolderNotFoundError,
  InvalidBundleDefinitionError,
  InvalidCollectionError,
  InvalidFolderPathError,
  InvalidLocaleError,
  InvalidResourceKeyError,
  LingoTrackerError,
  LocaleAlreadyExistsError,
  LocaleNotFoundError,
  ParentDirectoryMissingError,
  ProtectedTermsFileError,
  ProtectedTermsFileNotSetError,
  ReadOnlyCollectionError,
  ResourceAlreadyExistsError,
  ResourceNotFoundError,
} from './lingo-tracker-error';
