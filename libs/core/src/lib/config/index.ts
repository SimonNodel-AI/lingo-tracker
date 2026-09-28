// Config and collections: load .lingo-tracker.json, open a collection, and read or write its terminology files.

export { addCollectionEntry, patchCollectionEntry, toCollectionEntry } from './collection-entry';
export { type LoadConfigOptions, loadConfig } from './load-config';
export { type Collection, type OpenCollectionOptions, openCollection, type TermFiles } from './open-collection';
export {
  type LoadPreferredTerminologyResult,
  loadPreferredTerminology,
  PreferredTerminologyValidationError,
  resolvePreferredTerminologyFilePath,
  writePreferredTerminology,
} from './preferred-terminology-file';
export {
  describePreferredTermRule,
  describeTermFileProblem,
  type ProjectTerms,
  readProjectTerms,
  requireProtectedTerms,
  type TermFileProblem,
  type TerminologyFinding,
  type TerminologyFindings,
} from './project-terms';
export {
  type ResolvedProtectedTerms,
  readCollectionProtectedTerms,
  readGlobalProtectedTerms,
  resolveCollectionProtectedTermsFilePath,
  resolveGlobalProtectedTermsFilePath,
  resolveProtectedTermsForConfig,
} from './protected-terms-file';
export type { TermFile } from './term-file';
