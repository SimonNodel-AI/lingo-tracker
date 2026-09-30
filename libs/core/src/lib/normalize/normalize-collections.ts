import type { Collection } from '../config/open-collection';
import { ReadOnlyCollectionError } from '../errors';
import { normalize, type NormalizeOptions, type NormalizeResult } from './normalize';

const NUMERIC_FIELDS = [
  'entriesProcessed',
  'localesAdded',
  'valuesConverted',
  'tagsNormalized',
  'filesCreated',
  'filesUpdated',
  'foldersRemoved',
] as const;

export type CollectionNormalizeResult = Pick<NormalizeResult, (typeof NUMERIC_FIELDS)[number] | 'problems'> & {
  collectionName: string;
};

export interface NormalizeCollectionsOptions extends NormalizeOptions {
  /** The CLI's --all selection skips read-only collections; a named selection refuses one. */
  readonly all?: boolean;
  readonly onEvent?: (
    event:
      | { kind: 'skip'; name: string }
      | { kind: 'start'; name: string }
      | { kind: 'result'; result: CollectionNormalizeResult }
      | { kind: 'error'; name: string; error: unknown },
  ) => void;
}

export interface NormalizeCollectionsResult {
  readonly collections: CollectionNormalizeResult[];
  readonly totals: Record<(typeof NUMERIC_FIELDS)[number], number> & { collectionsProcessed: number };
  readonly errors: readonly { name: string; error: unknown }[];
}

/** Empty report for a run refused before any collection is processed. */
export function emptyNormalizeCollectionsResult(): NormalizeCollectionsResult {
  return {
    collections: [],
    totals: {
      ...(Object.fromEntries(NUMERIC_FIELDS.map((field) => [field, 0])) as Record<
        (typeof NUMERIC_FIELDS)[number],
        number
      >),
      collectionsProcessed: 0,
    },
    errors: [],
  };
}

/** Applies the CLI's named versus all read-only rule and totals a whole run. */
export async function normalizeCollections(
  collections: readonly Collection[],
  options: NormalizeCollectionsOptions = {},
): Promise<NormalizeCollectionsResult> {
  if (!options.all) {
    const readOnly = collections.find((collection) => collection.readOnly);
    if (readOnly) throw new ReadOnlyCollectionError(readOnly.name);
  }

  const results: CollectionNormalizeResult[] = [];
  const errors: { name: string; error: unknown }[] = [];
  for (const collection of collections) {
    const { name } = collection;
    if (collection.readOnly) {
      options.onEvent?.({ kind: 'skip', name });
      continue;
    }
    options.onEvent?.({ kind: 'start', name });
    let item: CollectionNormalizeResult;
    try {
      const result = await normalize(collection, { dryRun: options.dryRun ?? false });
      const { dryRun: _dryRun, ...report } = result;
      item = { collectionName: name, ...report };
    } catch (error) {
      errors.push({ name, error });
      options.onEvent?.({ kind: 'error', name, error });
      continue;
    }
    results.push(item);
    options.onEvent?.({ kind: 'result', result: item });
  }

  const totals = { ...emptyNormalizeCollectionsResult().totals, collectionsProcessed: results.length };
  for (const result of results) {
    for (const field of NUMERIC_FIELDS) totals[field] += result[field];
  }
  return { collections: results, totals, errors };
}
