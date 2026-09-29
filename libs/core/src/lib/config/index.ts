// Config and collections: load .lingo-tracker.json, open a collection, and read or write its terminology files.

export { addCollectionEntry, patchCollectionEntry, toCollectionEntry } from './collection-entry';
export { type LoadConfigOptions, loadConfig } from './load-config';
export { type Collection, type OpenCollectionOptions, openCollection, type TermFiles } from './open-collection';
export {
  displayTermPath,
  editPreferredTerminology,
  type PreferredTerminologyEdit,
  type PreferredTerminologyEditResult,
  type LoadPreferredTerminologyResult,
  loadPreferredTerminology,
  PreferredTerminologyValidationError,
  resolvePreferredTerminologyFilePath,
  writePreferredTerminology,
} from './preferred-terminology-file';
export {
  assertProtectedTerms,
  editProtectedTerms,
  readProtectedTermsTarget,
  type SetProtectedTermsOptions,
  type SetProtectedTermsResult,
  setCollectionProtectedTerms,
  setCollectionProtectedTermsFile,
  setGlobalProtectedTerms,
  setGlobalProtectedTermsFile,
} from './set-protected-terms';
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
