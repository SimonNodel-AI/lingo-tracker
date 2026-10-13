// Validate the internal catalogue when the public error surface is loaded.
import './error-codes';

// Core errors declare domain kinds and details; adapters own presentation.
export {
  AutoTranslationDisabledError,
  BundleNotFoundError,
  CollectionNotFoundError,
  ConfigNotFoundError,
  ConfigParseError,
  type CollectionTagEditProblem,
  type ErrorKind,
  GlossaryExtractorError,
  ImportSourceError,
  InvalidCollectionError,
  InvalidConfigError,
  InvalidProjectTermsEditError,
  isProtectedTermsEditProblem,
  isPreferredTerminologyEditProblem,
  type ProtectedTermsEditProblem,
  type PreferredTerminologyEditProblem,
  LingoTrackerError,
  MultipleBundleConstantNameError,
  PreferredTerminologyValidationError,
  ProtectedTermsFileError,
  ProtectedTermsFileNotSetError,
  ReadOnlyCollectionError,
  ResourceAlreadyExistsError,
  TranslationError,
} from './lingo-tracker-error';
export type { DomainErrorCode, ErrorCode, KnownProviderErrorCode, ProviderErrorCode } from './error-codes';
