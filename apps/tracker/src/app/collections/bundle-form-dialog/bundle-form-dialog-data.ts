import type { BundleDefinitionDto } from '@simoncodes-ca/data-transfer';

/**
 * Data passed to the Bundle Form Dialog.
 */
export interface BundleFormDialogData {
  /** 'create' for a new bundle, 'edit' for an existing one. */
  mode: 'create' | 'edit';

  /** Bundle name — the key under `bundles` in the config (edit mode only). */
  name?: string;

  /** Existing definition to edit (edit mode only). */
  bundle?: BundleDefinitionDto;
}

/** What the dialog closes with when the user saves. */
export interface BundleFormResult {
  name: string;
  bundle: BundleDefinitionDto;
}
