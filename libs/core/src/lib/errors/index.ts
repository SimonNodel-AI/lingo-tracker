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
  InvalidFolderPathError,
  InvalidLocaleError,
  InvalidResourceKeyError,
  LingoTrackerError,
  LocaleAlreadyExistsError,
  LocaleNotFoundError,
  ProtectedTermsFileError,
  ReadOnlyCollectionError,
  ResourceAlreadyExistsError,
  ResourceNotFoundError,
} from './lingo-tracker-error';
