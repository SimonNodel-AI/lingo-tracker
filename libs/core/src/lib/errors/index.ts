// Validate the internal catalogue when the public error surface is loaded.
import './error-codes';

export type { DomainErrorCode, ErrorCode, KnownProviderErrorCode, ProviderErrorCode } from './error-codes';
// Core errors declare domain kinds and details; adapters own presentation.
export {
  AutoTranslationDisabledError,
  BundleNotFoundError,
  CollectionNotFoundError,
  type CollectionTagEditProblem,
  ConfigNotFoundError,
  ConfigParseError,
  type ErrorKind,
  GlossaryExtractorError,
  ImportSourceError,
  InvalidCollectionError,
  InvalidConfigError,
  InvalidProjectTermsEditError,
  isPreferredTerminologyEditProblem,
  isProtectedTermsEditProblem,
  LingoTrackerError,
  MultipleBundleConstantNameError,
  type PreferredTerminologyEditProblem,
  PreferredTerminologyValidationError,
  type ProtectedTermsEditProblem,
  ProtectedTermsFileError,
  ProtectedTermsFileNotSetError,
  ReadOnlyCollectionError,
  ResourceAlreadyExistsError,
  TranslationError,
} from './lingo-tracker-error';
