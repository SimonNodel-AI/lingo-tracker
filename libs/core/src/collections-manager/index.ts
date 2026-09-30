// Collection and locale operations: each edits .lingo-tracker.json (and, for locales, the resource tree).

export { addCollection, type AddCollectionOptions } from './add-collection';
export { editCollectionTags, type CollectionTagEdit } from './edit-collection-tags';
export {
  type AddLocaleToCollectionOptions,
  type AddLocaleToCollectionResult,
  addLocaleToCollection,
} from './add-locale-to-collection';
export { type DeleteCollectionOptions, deleteCollectionByName } from './delete-collection-by-name';
export {
  type RemoveLocaleFromCollectionOptions,
  type RemoveLocaleFromCollectionResult,
  removeLocaleFromCollection,
} from './remove-locale-from-collection';
export { type UpdateCollectionOptions, updateCollection } from './update-collection';
