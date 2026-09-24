import { type Collection, readCollection, searchResources } from '@simoncodes-ca/core';
import { defineCommand } from '../runner/command-runner';
import { ConsoleFormatter } from '../utils';

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

/** Prints the collection's base values that Resource Search's similar-value rule matches, best first. */
function reportSimilar(collection: Collection, query: string, limit: number): void {
  const { resources, problems } = readCollection(collection);
  for (const problem of problems) {
    ConsoleFormatter.warning(`Skipped unreadable folder: ${problem.message}`);
  }

  const matches = searchResources(resources, collection, query, { mode: 'similar-value', limit });
  if (matches.length === 0) {
    console.log(`No similar values found for "${query}".`);
    return;
  }

  console.log(`Similar values found for "${query}":`);
  for (const match of matches) {
    const pct = Math.round((match.similarity ?? 0) * 100);
    console.log(`  ${match.key} → "${match.source}" (similarity: ${pct}%)`);
  }
}
