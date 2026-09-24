// Resource folders on disk, and the read models (tree, search, fingerprint) built from them.

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
  type ResolvedResourcePaths,
  type ResourcePathResolutionParams,
  resolveResourcePaths,
} from './resource-file-paths';
export {
  type EntryDetails,
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
  treeResources,
} from './search';
export {
  type ComputeTreeFingerprintOptions,
  computeTreeFingerprint,
  type TreeFingerprint,
  treeFingerprintsMatch,
} from './tree-fingerprint';
