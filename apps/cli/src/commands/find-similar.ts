import { type Collection, normalizeSearchRequest, readCollection, searchResources } from '@simoncodes-ca/core';
import { defineCommand, requireOptions } from '../runner/command-runner';
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
    normalizeSearchRequest({ query: options.value ?? '', mode: 'similar-value' }, 5).kind === 'blank'
      ? [{ type: 'text', name: 'value', message: 'Base locale text to search for' }]
      : [],
  run: ({ collection, answers, interactive }) => {
    const request = normalizeSearchRequest(
      { query: answers.value ?? '', mode: 'similar-value', limit: answers.maxResults },
      5,
    );
    if (request.kind === 'blank') {
      requireOptions(answers, ['value'], interactive);
      throw new Error('--value must not be blank');
    }
    reportSimilar(collection, request.query, request.limit);
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
