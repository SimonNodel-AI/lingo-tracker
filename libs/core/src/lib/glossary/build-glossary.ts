import type { Collection } from '../config/open-collection';
import { GlossaryBaseLocaleMismatchError, GlossaryNoCollectionsError } from '../errors/lingo-tracker-error';
import { readCollection } from '../resource/read-collection';
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
 * @throws {GlossaryBaseLocaleMismatchError} The collections have different base locales.
 * @throws {GlossaryExtractorError} The requested extractor mode is unavailable.
 */
export function buildGlossary(
  collections: readonly Collection[],
  text: string,
  options: BuildGlossaryOptions = {},
): BuildGlossaryResult {
  const baseLocale = collections[0]?.baseLocale;
  if (baseLocale === undefined) {
    throw new GlossaryNoCollectionsError();
  }
  if (collections.some((collection) => collection.baseLocale !== baseLocale)) {
    throw new GlossaryBaseLocaleMismatchError(
      collections.map(({ name, baseLocale: locale }) => ({ name, baseLocale: locale })),
    );
  }

  const configured = [...new Set(collections.flatMap((collection) => collection.targetLocales))];
  const locales = options.locales ? options.locales.filter((locale) => locale !== baseLocale) : configured;
  const entries: FlatEntry[] = [];
  const readProblems: GlossaryReadProblem[] = [];

  for (const collection of collections) {
    const { resources, problems } = readCollection(collection);
    readProblems.push(...problems.map((problem) => ({ collectionName: collection.name, message: problem.message })));
    for (const { fullKey, entry } of resources) {
      const translations = { ...entry.translations };
      delete translations[collection.baseLocale];
      const status: FlatEntry['status'] = {};
      for (const [locale, meta] of Object.entries(entry.metadata)) {
        if (meta?.status) status[locale] = meta.status;
      }
      entries.push({
        key: fullKey,
        collection: collection.name,
        source: entry.source,
        translations,
        status,
        locales: options.locales ? locales : collection.targetLocales,
      });
    }
  }

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
