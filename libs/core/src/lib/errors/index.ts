// Validate the internal catalogue when the public error surface is loaded.
import './error-codes';

export type { DomainErrorCode, ErrorCode, KnownProviderErrorCode, ProviderErrorCode } from './error-codes';
// Core errors declare domain kinds and details; adapters own presentation.
export {
  BracedPlaceholderError,
  CollectionNotFoundError,
  type CollectionTagEditProblem,
  ConfigNotFoundError,
  ConfigParseError,
  type ErrorKind,
  InvalidBaseValueError,
  InvalidConfigError,
  InvalidProjectTermsEditError,
  isPreferredTerminologyEditProblem,
  isProtectedTermsEditProblem,
  LingoTrackerError,
  type PreferredTerminologyEditProblem,
  PreferredTerminologyValidationError,
  type ProtectedTermsEditProblem,
  ReadOnlyCollectionError,
  ResourceAlreadyExistsError,
  TranslationError,
} from './lingo-tracker-error';
