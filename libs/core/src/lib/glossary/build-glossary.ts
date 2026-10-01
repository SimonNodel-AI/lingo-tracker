import { readCollectionSet } from '../collection-set/collection-set';
import type { Collection } from '../config/open-collection';
import { GlossaryNoCollectionsError } from '../errors/lingo-tracker-error';
import { resolveExtractor, type CandidateExtractor, type ExtractorMode } from './glossary-extractor';
import { matchGlossary, type FlatEntry, type GlossaryTerm } from './glossary-matcher';

export interface BuildGlossaryOptions {
  /** A mode name, or a custom extraction strategy. Defaults to `ngram`. */
  extractor?: ExtractorMode | CandidateExtractor;
  /** Explicit output locales, including unconfigured stored translations; base locale is excluded. */
  locales?: readonly string[];
  /** Include `new` and `stale` translations. */
  includeAll?: boolean;
}

/** The JSON payload printed or saved by the CLI. */
export interface Glossary {
  baseLocale: string;
  locales: string[];
  source: { chars: number; candidates: number };
  matchCount: number;
  terms: GlossaryTerm[];
}

export interface GlossaryReadProblem {
  collectionName: string;
  message: string;
}

/** The payload plus reader problems for an adapter to report outside the JSON. */
export interface BuildGlossaryResult extends Glossary {
  readProblems: GlossaryReadProblem[];
}

/**
 * Builds a glossary from opened collections. A glossary has one source language, so all
 * collections must share a base locale, as the Export run requires. The Collection Reader
 * supplies entries and non-fatal folder problems. Without explicit locales, each entry
 * is limited to its own collection's target locales before matching.
 *
 * @throws {GlossaryNoCollectionsError} No collections were provided.
 * @throws {CollectionBaseLocaleMismatchError} The collections have different base locales.
 * @throws {GlossaryExtractorError} The requested extractor mode is unavailable.
 */
export function buildGlossary(
  collections: readonly Collection[],
  text: string,
  options: BuildGlossaryOptions = {},
): BuildGlossaryResult {
  if (collections.length === 0) throw new GlossaryNoCollectionsError();
  const set = readCollectionSet(collections, { locales: options.locales, includeUnconfiguredLocales: true });
  const baseLocale = set.baseLocale;
  if (baseLocale === undefined) throw new GlossaryNoCollectionsError();
  const locales = set.targetLocales;
  const entries: FlatEntry[] = set.resources.map((resource) => {
    const translations = { ...resource.translations };
    delete translations[baseLocale];
    return {
      key: resource.fullKey,
      collection: resource.collection,
      source: resource.source,
      translations,
      status: resource.status,
      locales: options.locales ? locales : resource.targetLocales,
    };
  });
  const readProblems = set.readProblems.map((problem) => ({
    collectionName: problem.collection,
    message: problem.message,
  }));

  const extractor =
    typeof options.extractor === 'function' ? options.extractor : resolveExtractor(options.extractor ?? 'ngram');
  const candidates = extractor(text);
  const terms = matchGlossary(entries, candidates, { locales, includeAll: options.includeAll });
  return {
    baseLocale,
    locales,
    source: { chars: text.length, candidates: candidates.length },
    matchCount: terms.length,
    terms,
    readProblems,
  };
}
