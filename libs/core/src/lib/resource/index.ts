// Resource operations, folder files, and the read models built from them.

export { type CollectionFolderProblem, describeFolderProblem } from './collection-folders';

export {
  type AddResourceOptions,
  type AddResourceParams,
  type AddResourceResult,
  addResource,
  type ExistingResourcePolicy,
} from './add-resource';
export { type AddResourcesResult, addResources } from './add-resources';
export { type DeleteResourceParams, type DeleteResourceResult, deleteResource } from './delete-resource';
export {
  type EditResourceChanges,
  type EditResourceOptions,
  type EditResourceResult,
  editResource,
} from './edit-resource';
export { extractResourcesRecursively, extractSubtree } from './extract-subtree';
export {
  type FolderChild,
  type LoadResourceTreeOptions,
  loadResourceTree,
  type ResourceTreeEntry,
  type ResourceTreeNode,
} from './load-resource-tree';
export type { ResourceTranslation } from './locale-seeding';
export { type MoveResourceParams, type MoveResourceResult, moveResource } from './move-resource';
export { type MoveResourcesOperation, moveResources } from './move-resources';
export {
  type CollectionRead,
  type CollectionReadProblem,
  type CollectionReadTarget,
  readCollection,
  type StoredResource,
} from './read-collection';
export type { ResourceEntryMetadata } from './resource-entry-metadata';
export {
  type EntryDetails,
  type NormalizeEntryReport,
  type OpenResourceFolderOptions,
  openResourceFolder,
  type ResourceFolder,
  type ResourceFolderEntry,
  type ResourceFolderSaveResult,
} from './resource-folder';
export {
  type MutationSink,
  type MutationSinkOptions,
  type ResourceMutation,
  reindexMutation,
  saveReporting,
} from './resource-mutation';
export {
  type MatchType,
  type NormalizedSearchRequest,
  normalizeSearchRequest,
  type SearchableResource,
  type SearchMode,
  type SearchOptions,
  type SearchPage,
  type SearchRequest,
  type SearchResult,
  searchPage,
  searchResources,
  treeResources,
} from './search';
export {
  type ComputeTreeFingerprintOptions,
  computeTreeFingerprint,
  type TreeFingerprint,
  treeFingerprintsMatch,
} from './tree-fingerprint';
