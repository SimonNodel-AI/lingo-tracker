// Config and collections: load .lingo-tracker.json, open a collection, and read or write its terminology files.

export { addCollectionEntry, patchCollectionEntry, toCollectionEntry } from './collection-entry';
export { initConfig } from './init-config';
export { type LoadConfigOptions, loadConfig } from './load-config';
export {
  updateProjectTerms,
  type ProjectTermsUpdate,
  type ProjectTermsUpdateResult,
} from './update-project-terms';
export { type Collection, type OpenCollectionOptions, openCollection, type TermFiles } from './open-collection';
export {
  displayTermPath,
  type PreferredTerminologyEditResult,
  type LoadPreferredTerminologyResult,
  loadPreferredTerminology,
  PreferredTerminologyValidationError,
  resolvePreferredTerminologyFilePath,
} from './preferred-terminology-file';
export { describeTermFileProblem, readProjectTerms, type TerminologyFindings } from './project-terms';
export {
  type ResolvedProtectedTerms,
  readCollectionProtectedTerms,
  readGlobalProtectedTerms,
  resolveCollectionProtectedTermsFilePath,
  resolveGlobalProtectedTermsFilePath,
  resolveProtectedTermsForConfig,
  type StoredProtectedTerms,
} from './protected-terms-file';
export type { TermFile } from './term-file';
