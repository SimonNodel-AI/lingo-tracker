// Config and collections: load .lingo-tracker.json, open a collection, and read or write its terminology files.

export {
  addCollectionEntry,
  assertCollectionFields,
  patchCollectionEntry,
  toCollectionEntry,
} from './collection-entry';
export { initConfig } from './init-config';
export { type LoadConfigOptions, loadConfig } from './load-config';
export {
  type Collection,
  type OpenCollectionOptions,
  type OpenedCollection,
  type OpenedProject,
  openCollection,
  type TermFiles,
} from './open-collection';
export {
  displayTermPath,
  type LoadPreferredTerminologyResult,
  loadPreferredTerminology,
  type PreferredTerminologyEditResult,
  resolvePreferredTerminologyFilePath,
} from './preferred-terminology-file';
export { describeTermFileProblem, readProjectTerms, type TerminologyFindings } from './project-terms';
export {
  type ResolvedProtectedTerms,
  readCollectionProtectedTerms,
  readGlobalProtectedTerms,
  resolveCollectionProtectedTermsFilePath,
  resolveGlobalProtectedTermsFilePath,
  type StoredProtectedTerms,
} from './protected-terms-file';
export type { TermFile } from './term-file';
export {
  type ProtectedTermsChange,
  type ProjectTermsUpdate,
  type ProjectTermsUpdatePlan,
  type ProjectTermsUpdateResult,
  planProjectTermsUpdate,
  updateProjectTerms,
} from './update-project-terms';

export { readProjectTermsView, type ProjectTermsView } from './project-terms-view';
export { preferredTerminologyRequestFromFlags, type PreferredTerminologyFlags } from './preferred-terminology-request';
