// The normalize module: one operation that repairs entries, metadata and empty folders across a collection.

export { normalize, type NormalizeOptions, type NormalizeResult } from './normalize';
export {
  emptyNormalizeCollectionsResult,
  normalizeCollections,
  type CollectionNormalizeResult,
  type NormalizeCollectionsOptions,
  type NormalizeCollectionsResult,
} from './normalize-collections';
