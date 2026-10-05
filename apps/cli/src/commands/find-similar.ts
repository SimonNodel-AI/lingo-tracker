import {
  type Collection,
  describeFolderProblem,
  normalizeSearchRequest,
  readCollection,
  searchResources,
} from '@simoncodes-ca/core';
import { FIND_SIMILAR_FLAGS } from './find-similar-flags';
import { flagName } from '../runner/flag-record';
import { CommandOutput } from '../runner/command-output';
import { defineCommand, requireOptions } from '../runner/command-runner';
import { ConsoleFormatter } from '../utils';

export interface FindSimilarOptions {
  collection?: string;
  value?: string;
  maxResults?: number;
}

export const findSimilarCommand = defineCommand<FindSimilarOptions>()({
  flags: FIND_SIMILAR_FLAGS,
  name: 'Find similar',
  collection: 'read',

  run: ({ collection, answers, interactive }) => {
    const request = normalizeSearchRequest(
      { query: answers.value ?? '', mode: 'similar-value', limit: answers.maxResults },
      FIND_SIMILAR_FLAGS.maxResults.runtimeDefault,
    );
    if (request.kind === 'blank') {
      requireOptions(answers, ['value'], interactive, FIND_SIMILAR_FLAGS);
      throw new Error(`${flagName(FIND_SIMILAR_FLAGS.value)} must not be blank`);
    }
    reportSimilar(collection, request.query, request.limit);
  },
});

/** Prints the collection's base values that Resource Search's similar-value rule matches, best first. */
function reportSimilar(collection: Collection, query: string, limit: number): void {
  const { resources, problems } = readCollection(collection);
  for (const problem of problems) {
    ConsoleFormatter.warning(describeFolderProblem(problem));
  }

  const matches = searchResources(resources, collection, query, { mode: 'similar-value', limit });
  if (matches.length === 0) {
    CommandOutput.log(`No similar values found for "${query}".`);
    return;
  }

  CommandOutput.log(`Similar values found for "${query}":`);
  for (const match of matches) {
    const pct = Math.round((match.similarity ?? 0) * 100);
    CommandOutput.log(`  ${match.key} → "${match.source}" (similarity: ${pct}%)`);
  }
}
