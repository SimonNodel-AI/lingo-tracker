import type { LingoTrackerCollectionDto } from '@simoncodes-ca/data-transfer';

/**
 * Data passed to the Collection Form Dialog.
 */
export interface CollectionFormDialogData {
  /**
   * Dialog mode: 'create' for new collections, 'edit' for existing ones.
   */
  mode: 'create' | 'edit';

  /**
   * Collection name (only present in edit mode).
   */
  name?: string;

  /**
   * Collection configuration (only present in edit mode).
   */
  config?: LingoTrackerCollectionDto;

  /**
   * The base locale the collection actually compares against (edit mode). Falls back to the
   * global config when the collection does not set its own, so the dialog can mark and lock it
   * without writing an explicit `baseLocale` into the collection.
   */
  effectiveBaseLocale?: string;
}
