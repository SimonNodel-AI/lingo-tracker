import { type Collection, searchTranslations } from '@simoncodes-ca/core';
import { normalizedLevenshtein } from '@simoncodes-ca/domain';
import { defineCommand } from '../runner/command-runner';

/**
 * How many candidates to score. searchTranslations stops walking once it has
 * this many hits, so the budget must be large enough that ranking, not
 * discovery order, decides what survives — while still bounding the walk on a
 * very short query that matches most of the store.
 */
const CANDIDATE_LIMIT = 500;

/** Minimum similarity for a candidate to be reported as a match. */
const THRESHOLD = 0.8;

export interface FindSimilarOptions {
  collection?: string;
  value?: string;
  maxResults?: number;
}

export const findSimilarCommand = defineCommand<FindSimilarOptions>()({
  name: 'Find similar',
  collection: 'read',
  prompts: (options) =>
    options.value?.trim() ? [] : [{ type: 'text', name: 'value', message: 'Base locale text to search for' }],
  required: ['value'],
  run: ({ collection, answers }) => {
    // `required` rejects an absent or empty value; a blank one has nothing to compare either.
    const query = answers.value.trim();
    if (query.length === 0) {
      throw new Error('--value must not be blank');
    }
    reportSimilar(collection, query, answers.maxResults ?? 5);
  },
});

function reportSimilar(collection: Collection, query: string, displayLimit: number): void {
  const { translationsFolder, baseLocale } = collection;

  // Use a broad search to get candidates (pass the whole query for substring pre-filter)
  const candidates = searchTranslations({
    translationsFolder,
    query,
    maxResults: CANDIDATE_LIMIT,
    baseLocale,
  });

  // Score every candidate on its base value, whatever its matchType: a key match
  // pre-empts a value match upstream (see MatchType), so filtering on matchType
  // discarded the well-named canonical keys this command exists to surface. The
  // threshold is what separates a real match from a coincidental one.
  const scored = candidates
    .map((r) => {
      const storedValue = r.translations[baseLocale] ?? '';
      const score = normalizedLevenshtein(query.toLowerCase(), storedValue.toLowerCase());
      const keyMatch = r.matchType === 'exact-key' || r.matchType === 'partial-key';
      return { key: r.key, value: storedValue, score, keyMatch };
    })
    .filter((r) => r.score >= THRESHOLD)
    .sort((a, b) => {
      // Score decides first: a key hit never outranks a closer value.
      if (b.score !== a.score) return b.score - a.score;
      // On a tie, prefer the entry whose key is also named after the query — it
      // is the canonical, reusable key a caller is looking for.
      return Number(b.keyMatch) - Number(a.keyMatch);
    })
    .slice(0, displayLimit);

  if (candidates.length >= CANDIDATE_LIMIT) {
    console.warn(
      `Note: only the first ${CANDIDATE_LIMIT} candidates were compared. Narrow the query for a complete result.`,
    );
  }

  if (scored.length === 0) {
    console.log(`No similar values found for "${query}".`);
    return;
  }

  console.log(`Similar values found for "${query}":`);
  for (const match of scored) {
    const pct = Math.round(match.score * 100);
    console.log(`  ${match.key} → "${match.value}" (similarity: ${pct}%)`);
  }
}
