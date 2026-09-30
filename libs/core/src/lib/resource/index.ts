// Resource operations, folder files, and the read models built from them.

export {
  type AddResourceOptions,
  type AddResourceParams,
  type AddResourceResult,
  type ExistingResourcePolicy,
  addResource,
} from './add-resource';
export { type AddResourcesResult, addResources } from './add-resources';
export { type DeleteResourceParams, type DeleteResourceResult, deleteResource } from './delete-resource';
export { type EditResourceChanges, type EditResourceResult, editResource } from './edit-resource';
export type { ResourceTranslation } from './locale-seeding';
export { type MoveResourceParams, type MoveResourceResult, moveResource } from './move-resource';
export { type MoveResourcesOperation, moveResources } from './move-resources';
export type { ResourceEntryMetadata } from './resource-entry-metadata';

export { extractResourcesRecursively, extractSubtree } from './extract-subtree';
export {
  type FolderChild,
  type LoadResourceTreeOptions,
  loadResourceTree,
  type ResourceTreeEntry,
  type ResourceTreeNode,
} from './load-resource-tree';
export {
  type CollectionRead,
  type CollectionReadProblem,
  type CollectionReadTarget,
  readCollection,
  type StoredResource,
} from './read-collection';
export {
  type EntryDetails,
  type NormalizeEntryReport,
  type OpenResourceFolderOptions,
  openResourceFolder,
  type ResourceFolder,
  type ResourceFolderEntry,
  type ResourceFolderSaveResult,
} from './resource-folder';
export { type ResourceMutation, reindexMutation } from './resource-mutation';
export {
  type MatchType,
  type SearchableResource,
  type SearchMode,
  type SearchOptions,
  type SearchResult,
  searchResources,
  clampSearchLimit,
  treeResources,
} from './search';
export {
  type ComputeTreeFingerprintOptions,
  computeTreeFingerprint,
  type TreeFingerprint,
  treeFingerprintsMatch,
} from './tree-fingerprint';
