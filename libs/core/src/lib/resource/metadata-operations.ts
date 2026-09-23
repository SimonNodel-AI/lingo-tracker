import type { ResourceEntryMetadata } from '../../resource/resource-entry-metadata';
import type { TranslationStatus } from '@simoncodes-ca/domain';
import { calculateChecksum } from '../../resource/checksum';
import { isUntranslatedCopy, recordTranslation } from '@simoncodes-ca/domain';

export interface CreateResourceMetadataParams {
  /** The entry key for this resource */
  readonly entryKey: string;
  /** Base locale value */
  readonly baseValue: string;
  /** Base locale code */
  readonly baseLocale: string;
  /** Translations with locale, value, and status */
  readonly translations?: ReadonlyArray<{
    readonly locale: string;
    readonly value: string;
    readonly status: TranslationStatus;
  }>;
}

/**
 * Builds the metadata `addResource` writes for a new entry, without touching disk.
 * Used by the API to update its cache after an add.
 *
 * Follows the Staleness rules: a translation that is an untranslated copy of the base is `new`,
 * whatever status was provided.
 */
export function createResourceMetadata(params: CreateResourceMetadataParams): ResourceEntryMetadata {
  const { baseValue, baseLocale, translations = [] } = params;

  const baseChecksum = calculateChecksum(baseValue);
  let metadata: ResourceEntryMetadata = { [baseLocale]: { checksum: baseChecksum } };

  for (const { locale, value, status } of translations) {
    if (locale === baseLocale) continue;
    const finalStatus = isUntranslatedCopy(value, baseValue) ? 'new' : status;
    metadata = recordTranslation(metadata, locale, calculateChecksum(value), baseChecksum, finalStatus);
  }

  return metadata;
}
