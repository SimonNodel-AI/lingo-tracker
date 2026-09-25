import { calculateChecksum } from '../../resource/checksum';
import type { ResourceEntry } from '../../resource/resource-entry';
import type { ResourceEntryMetadata } from '../../resource/resource-entry-metadata';
import type { TranslationStatus } from '@simoncodes-ca/domain';
import { translocoToICU, normalizeTags, applyBaseChange, recordTranslation } from '@simoncodes-ca/domain';
import { translationLocales } from '../resource/resource-folder';

export interface NormalizeEntryParams {
  readonly entryKey: string;
  readonly resourceEntry: ResourceEntry;
  readonly metadata: ResourceEntryMetadata;
  readonly baseLocale: string;
  readonly locales: readonly string[];
}

export interface NormalizeEntryResult {
  readonly resourceEntry: ResourceEntry;
  readonly metadata: ResourceEntryMetadata;
  readonly changes: {
    readonly localesAdded: number;
    readonly checksumsUpdated: number;
    readonly statusesChanged: number;
    readonly valuesConverted: number;
    readonly tagsNormalized: number;
  };
}

interface ProcessAllLocalesParams {
  readonly locales: readonly string[];
  readonly baseLocale: string;
  readonly baseValue: string;
  readonly currentBaseChecksum: string;
  readonly baseValueChanged: boolean;
  readonly metadata: ResourceEntryMetadata;
  readonly normalizedEntry: ResourceEntry;
}

interface ProcessAllLocalesResult {
  readonly metadata: ResourceEntryMetadata;
  readonly localesAdded: number;
  readonly checksumsUpdated: number;
  readonly statusesChanged: number;
}

/**
 * Adds missing locales (as copies of the base value), recomputes checksums, and applies the
 * Staleness rule when the base value changed. Mutates `normalizedEntry` to add missing locales.
 */
function processAllLocales(params: ProcessAllLocalesParams): ProcessAllLocalesResult {
  const { locales, baseLocale, baseValue, currentBaseChecksum, baseValueChanged, metadata, normalizedEntry } = params;
  const targetLocales = locales.filter((locale) => locale !== baseLocale);

  let normalizedMetadata: ResourceEntryMetadata = { ...metadata, [baseLocale]: { checksum: currentBaseChecksum } };
  let localesAdded = 0;

  for (const locale of targetLocales) {
    const hadLocaleEntry = typeof normalizedEntry[locale] === 'string';
    if (!hadLocaleEntry) {
      normalizedEntry[locale] = baseValue;
      localesAdded++;
    }

    const status: TranslationStatus = hadLocaleEntry ? (metadata[locale]?.status ?? 'translated') : 'new';
    normalizedMetadata = recordTranslation(
      normalizedMetadata,
      locale,
      calculateChecksum(normalizedEntry[locale] as string),
      currentBaseChecksum,
      status,
    );
  }

  if (baseValueChanged) {
    normalizedMetadata = applyBaseChange(normalizedMetadata, baseLocale, currentBaseChecksum);
  }

  let checksumsUpdated = 0;
  let statusesChanged = 0;
  for (const locale of targetLocales) {
    if (metadata[locale]?.checksum !== normalizedMetadata[locale].checksum) checksumsUpdated++;
    if (metadata[locale]?.status !== normalizedMetadata[locale].status) statusesChanged++;
  }

  return { metadata: normalizedMetadata, localesAdded, checksumsUpdated, statusesChanged };
}

/**
 * Normalizes a single resource entry by recomputing checksums, adding missing
 * locale entries, and updating translation statuses.
 *
 * Normalization rules:
 * - Base locale checksum is always recomputed
 * - Missing locale entries are added with base value and status 'new'
 * - Locale checksums and baseChecksums are recomputed
 * - When the base value changed, the Staleness rule (`applyBaseChange`) sets statuses:
 *   'stale', or 'new' when the locale value equals the new base
 * - Existing statuses are preserved when base hasn't changed
 * - Comments and tags are preserved
 *
 * @param params - Normalization parameters including entry data and configuration
 * @returns Normalized entry and metadata with change summary
 */
export function normalizeEntry(params: NormalizeEntryParams): NormalizeEntryResult {
  const { resourceEntry, metadata, baseLocale, locales } = params;

  if (!baseLocale) {
    throw new Error('baseLocale parameter is required and cannot be undefined');
  }

  const normalizedEntry: ResourceEntry = { ...resourceEntry };

  if (baseLocale in normalizedEntry && baseLocale !== 'source') {
    delete normalizedEntry[baseLocale];
  }

  // Convert Transloco interpolation syntax ({{ var }}) to ICU format ({var})
  let valuesConverted = 0;

  const icuSource = translocoToICU(normalizedEntry.source);
  if (icuSource !== normalizedEntry.source) {
    normalizedEntry.source = icuSource;
    valuesConverted++;
  }

  // Normalize tags: lowercase, hyphenate, dedupe, strip invalid chars
  let tagsNormalized = 0;
  if (Array.isArray(normalizedEntry.tags) && normalizedEntry.tags.length > 0) {
    const normalized = normalizeTags(normalizedEntry.tags);
    const hasChanges =
      normalized.length !== normalizedEntry.tags.length ||
      normalized.some((t, i) => t !== (normalizedEntry.tags as string[])[i]);
    if (hasChanges) {
      normalizedEntry.tags = normalized.length > 0 ? normalized : undefined;
      tagsNormalized = 1;
    }
  }

  for (const key of translationLocales(normalizedEntry)) {
    const original = normalizedEntry[key] as string;
    const converted = translocoToICU(original);
    if (converted !== original) {
      normalizedEntry[key] = converted;
      valuesConverted++;
    }
  }

  const baseValue = normalizedEntry.source;
  const currentBaseChecksum = calculateChecksum(baseValue);
  const previousBaseChecksum = metadata[baseLocale]?.checksum;
  const baseValueChanged = !!previousBaseChecksum && previousBaseChecksum !== currentBaseChecksum;

  const baseChecksumsUpdated = previousBaseChecksum !== currentBaseChecksum ? 1 : 0;

  const localeChanges = processAllLocales({
    locales,
    baseLocale,
    baseValue,
    currentBaseChecksum,
    baseValueChanged,
    metadata,
    normalizedEntry,
  });

  return {
    resourceEntry: normalizedEntry,
    metadata: localeChanges.metadata,
    changes: {
      localesAdded: localeChanges.localesAdded,
      checksumsUpdated: baseChecksumsUpdated + localeChanges.checksumsUpdated,
      statusesChanged: localeChanges.statusesChanged,
      valuesConverted,
      tagsNormalized,
    },
  };
}
