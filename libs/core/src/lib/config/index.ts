// Config and collections: load .lingo-tracker.json, open a collection, and read or write its terminology files.

export { type LoadConfigOptions, loadConfig } from './load-config';
export { type Collection, type OpenCollectionOptions, openCollection } from './open-collection';
export {
  type LoadPreferredTerminologyResult,
  loadPreferredTerminology,
  PreferredTerminologyValidationError,
  resolvePreferredTerminologyFilePath,
  writePreferredTerminology,
} from './preferred-terminology-file';
export {
  type ResolvedProtectedTerms,
  readCollectionProtectedTerms,
  readEffectiveProtectedTerms,
  readGlobalProtectedTerms,
  resolveCollectionProtectedTermsFilePath,
  resolveGlobalProtectedTermsFilePath,
  resolveProtectedTermsForConfig,
} from './protected-terms-file';
