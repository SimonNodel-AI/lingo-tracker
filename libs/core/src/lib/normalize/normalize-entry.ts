import { normalizeTags, translocoToICU } from '@simoncodes-ca/domain';
import type { ResourceEntry } from '../resource/resource-entry';
import { translationLocales } from '../resource/resource-folder';

export interface NormalizedEntryValues {
  readonly entry: ResourceEntry;
  /** Values (base or translation) whose Transloco `{{ x }}` syntax became ICU `{x}`. */
  readonly valuesConverted: number;
  /** 1 when the tag list changed (lowercase, hyphenated, deduped, invalid characters stripped). */
  readonly tagsNormalized: number;
}

/**
 * What normalize changes in an entry's values: Transloco interpolation becomes ICU in the base value
 * and every translation, and tags are normalized. Checksums, statuses and seeding are the Resource
 * Folder's job (`ResourceFolder.normalizeEntry`). Pure; the input is not mutated.
 */
export function normalizeEntryValues(source: Readonly<ResourceEntry>): NormalizedEntryValues {
  const entry: ResourceEntry = { ...source };

  let valuesConverted = 0;
  for (const prop of ['source', ...translationLocales(entry)]) {
    const value = entry[prop];
    if (typeof value !== 'string') continue;
    const converted = translocoToICU(value);
    if (converted !== value) {
      entry[prop] = converted;
      valuesConverted++;
    }
  }

  let tagsNormalized = 0;
  if (Array.isArray(entry.tags) && entry.tags.length > 0) {
    const tags = normalizeTags(entry.tags);
    if (tags.length !== entry.tags.length || tags.some((tag, index) => tag !== entry.tags?.[index])) {
      if (tags.length > 0) entry.tags = tags;
      else delete entry.tags;
      tagsNormalized = 1;
    }
  }

  return { entry, valuesConverted, tagsNormalized };
}
