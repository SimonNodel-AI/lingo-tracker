import type { TranslationStatus } from '@simoncodes-ca/domain';
import type { CollectionFolderProblem } from '../resource/collection-folders';
import type { Collection } from '../config/open-collection';
import { CollectionBaseLocaleMismatchError } from '../errors/lingo-tracker-error';
import { readCollection } from '../resource/read-collection';

/** One entry from a whole-collection read, with its origin and stored locale data. */
export interface CollectionSetResource {
  key: string;
  fullKey: string;
  source: string;
  translations: Record<string, string>;
  tags?: string[];
  effectiveTags: readonly string[];
  comment?: string;
  status: Record<string, TranslationStatus>;
  collection: string;
  targetLocales: readonly string[];
}

export interface CollectionSetReadProblem {
  kind: CollectionFolderProblem['kind'];
  collection: string;
  folderPath: string;
  message: string;
}

export interface CollectionSet {
  /** First collection's base locale, or undefined when empty. With allowDifferentBaseLocales, callers must use each collection's base locale. */
  baseLocale: string | undefined;
  targetLocales: string[];
  resources: CollectionSetResource[];
  readProblems: CollectionSetReadProblem[];
}

export interface CollectionSetOptions {
  locales?: readonly string[];
  /** Glossary can request stored translations outside the configured target locales. */
  includeUnconfiguredLocales?: boolean;
  /** Validate checks each collection independently and does not require agreement. */
  allowDifferentBaseLocales?: boolean;
  /** Called with the resolved locale scope before folders are read. */
  onBeforeRead?: (targetLocales: readonly string[]) => void;
  /** Leave an empty target scope unread. */
  skipReadWhenNoTargets?: boolean;
}

/** The ordered union of configured targets, optionally narrowed to requested locales. */
export function collectionSetTargetLocales(
  collections: readonly Collection[],
  requested?: readonly string[],
): string[] {
  const locales = new Set(collections.flatMap((collection) => collection.targetLocales));
  return [...locales].filter((locale) => !requested || requested.includes(locale));
}

/** A locale without metadata is untracked and counts as new for status checks. */
export function collectionResourceStatus(resource: CollectionSetResource, locale: string): TranslationStatus {
  return resource.status[locale] ?? 'new';
}

/** Reads opened collections once and applies the shared locale and metadata rules. */
export function readCollectionSet(
  collections: readonly Collection[],
  options: CollectionSetOptions = {},
): CollectionSet {
  const baseLocale = collections[0]?.baseLocale;
  const targetLocales =
    options.includeUnconfiguredLocales && options.locales
      ? options.locales.filter((locale) => locale !== baseLocale)
      : collectionSetTargetLocales(collections, options.locales);
  if (targetLocales.length > 0) options.onBeforeRead?.(targetLocales);
  if (targetLocales.length === 0 && options.skipReadWhenNoTargets) {
    return { baseLocale, targetLocales, resources: [], readProblems: [] };
  }
  if (!options.allowDifferentBaseLocales && collections.some((collection) => collection.baseLocale !== baseLocale)) {
    throw new CollectionBaseLocaleMismatchError(collections.map(({ name, baseLocale }) => ({ name, baseLocale })));
  }
  const resources: CollectionSetResource[] = [];
  const readProblems: CollectionSetReadProblem[] = [];

  for (const collection of collections) {
    const read = readCollection(collection);
    readProblems.push(
      ...read.problems.map((problem) => ({
        kind: problem.kind,
        collection: collection.name,
        folderPath: problem.folderPath,
        message: problem.message,
      })),
    );
    for (const { fullKey, entryKey, entry, effectiveTags } of read.resources) {
      const status: Record<string, TranslationStatus> = {};
      for (const [locale, metadata] of Object.entries(entry.metadata)) {
        if (metadata?.status) status[locale] = metadata.status;
      }
      resources.push({
        key: entryKey,
        fullKey,
        source: entry.source,
        translations: { ...entry.translations },
        tags: entry.tags,
        effectiveTags,
        comment: entry.comment,
        status,
        collection: collection.name,
        targetLocales: collection.targetLocales,
      });
    }
  }

  return { baseLocale, targetLocales, resources, readProblems };
}
