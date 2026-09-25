import * as fs from 'node:fs';
import type { Collection } from '../config/open-collection';
import { type CollectionReadProblem, readCollection } from '../resource/read-collection';
import { effectiveProtectedTerms, findProtectedTerms, type TranslationStatus } from '@simoncodes-ca/domain';
import type { FilteredResource } from './types';

/** A stored resource flattened for the export and validate passes, with the collection it came from. */
export interface LoadedResource {
  key: string;
  fullKey: string;
  source: string;
  translations: Record<string, string>;
  /** The entry's own tags. */
  tags?: string[];
  /** The collection's tags united with the entry's own (from the Collection Reader). */
  effectiveTags: readonly string[];
  collectionProtectedTerms?: string[];
  comment?: string;
  status: Record<string, TranslationStatus>;
  collection: string;
}

/**
 * Validates that the output directory exists or can be created, and is writable.
 */
const RESERVED_RICH_KEYS = ['value', 'comment', 'status', 'tags'] as const;

export function validateBasePropertyName(name: string): void {
  if (name.length === 0) {
    throw new Error('basePropertyName cannot be empty');
  }
  if ((RESERVED_RICH_KEYS as readonly string[]).includes(name)) {
    throw new Error(`basePropertyName "${name}" is a reserved key. Reserved: ${RESERVED_RICH_KEYS.join(', ')}`);
  }
}

export function validateOutputDirectory(directory: string): void {
  if (!fs.existsSync(directory)) {
    try {
      fs.mkdirSync(directory, { recursive: true });
    } catch (error) {
      throw new Error(`Could not create output directory '${directory}': ${(error as Error).message}`);
    }
  }

  try {
    fs.accessSync(directory, fs.constants.W_OK);
  } catch {
    throw new Error(`Output directory '${directory}' is not writable.`);
  }
}

/**
 * Reads one collection through the Collection Reader and flattens each entry for the export and
 * validate passes. Folders the reader could not read are returned as `problems`.
 */
export function loadResources(
  collection: Pick<Collection, 'name' | 'translationsFolder' | 'baseLocale' | 'tags'>,
  protectedTerms?: string[],
): { resources: LoadedResource[]; problems: CollectionReadProblem[] } {
  const { resources, problems } = readCollection(collection);

  return {
    resources: resources.map(({ fullKey, entryKey, entry, effectiveTags }) => {
      const status: Record<string, TranslationStatus> = {};
      for (const [locale, localeMeta] of Object.entries(entry.metadata)) {
        if (localeMeta?.status) status[locale] = localeMeta.status;
      }

      return {
        key: entryKey,
        fullKey,
        source: entry.source,
        translations: { ...entry.translations },
        tags: entry.tags,
        effectiveTags,
        collectionProtectedTerms: protectedTerms,
        comment: entry.comment,
        status,
        collection: collection.name,
      };
    }),
    problems,
  };
}

/**
 * Filters resources based on status and tags for a specific target locale.
 */
export function filterResources(
  resources: LoadedResource[],
  targetLocale: string,
  statusFilter: TranslationStatus[] | undefined,
  tagFilter: string[] | undefined,
  protectedTermsOptions?: {
    globalProtectedTerms?: string[];
    augmentProtectedTerms?: boolean;
    baseLocale?: string;
  },
): FilteredResource[] {
  return resources
    .filter((res) => {
      // Status filter
      const status = res.status[targetLocale];
      // If status is undefined, it's effectively 'new' if we consider untranslated as new,
      // but usually metadata should exist. If no metadata for locale, it's untracked/new.
      // For now, let's assume if status is missing, it might be 'new' or we skip.
      // The requirement says: "Resources with no translation in target locale are considered new"

      const effectiveStatus = status || 'new';

      if (statusFilter && !statusFilter.includes(effectiveStatus)) {
        return false;
      }

      // Tag filter — use effective tags (collection-level union resource-level)
      if (tagFilter && tagFilter.length > 0) {
        const hasMatch = tagFilter.some((tag) => res.effectiveTags.includes(tag));
        if (!hasMatch) {
          return false;
        }
      }

      return true;
    })
    .map((res) => {
      const augment =
        protectedTermsOptions?.augmentProtectedTerms !== false &&
        (!protectedTermsOptions?.baseLocale || targetLocale !== protectedTermsOptions.baseLocale);
      const protectedTermsFound = augment
        ? findProtectedTerms(
            res.source,
            effectiveProtectedTerms(protectedTermsOptions?.globalProtectedTerms, res.collectionProtectedTerms),
          )
        : undefined;

      return {
        key: res.fullKey,
        value: res.translations[targetLocale] || '',
        baseValue: res.source,
        comment: res.comment,
        status: res.status[targetLocale] || 'new',
        tags: res.tags,
        collection: res.collection,
        locale: targetLocale,
        protectedTermsFound,
      };
    });
}
