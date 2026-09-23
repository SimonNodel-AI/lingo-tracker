// Typed core errors. Callers map them by class (the API's exception filter, the CLI's reporter).

export type { FolderPathPart } from './error-messages';
export {
  BaseLocaleImmutableError,
  BundleAlreadyExistsError,
  BundleNotFoundError,
  CollectionAlreadyExistsError,
  CollectionNotFoundError,
  ConfigNotFoundError,
  ConfigParseError,
  InvalidBundleDefinitionError,
  InvalidFolderPathError,
  InvalidLocaleError,
  InvalidResourceKeyError,
  LingoTrackerError,
  LocaleAlreadyExistsError,
  LocaleNotFoundError,
  ReadOnlyCollectionError,
  ResourceNotFoundError,
} from './lingo-tracker-error';
