// Resource operations: add, edit, delete and move one entry.

export { type AddResourceOptions, type AddResourceParams, addResource } from './add-resource';
export { type DeleteResourceParams, type DeleteResourceResult, deleteResource } from './delete-resource';
export { type EditResourceOptions, type EditResourceResult, editResource } from './edit-resource';
export { type MoveResourceParams, type MoveResourceResult, moveResource } from './move-resource';
export type { ResourceEntryMetadata } from './resource-entry-metadata';
export { createDefaultTranslations } from './translation-helpers';
