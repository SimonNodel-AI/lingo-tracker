// Resource operations on an opened Collection: add, edit, delete and move entries.

export { type AddResourceParams, type AddResourceResult, addResource } from './add-resource';
export { type DeleteResourceParams, type DeleteResourceResult, deleteResource } from './delete-resource';
export { type EditResourceChanges, type EditResourceResult, editResource } from './edit-resource';
export type { ResourceTranslation } from './locale-seeding';
export { type MoveResourceParams, type MoveResourceResult, moveResource } from './move-resource';
export type { ResourceEntryMetadata } from './resource-entry-metadata';
