import type { Collection } from '../config/open-collection';
import { CollectionNotFoundError, ReadOnlyCollectionError } from '../errors/lingo-tracker-error';
import type { MoveOptionsWithConfig } from './move-destination';
import { type MoveResourceResult, moveResource } from './move-resource';
import { withMoveOutcome } from './move-outcome';

export interface MoveResourcesOperation {
  readonly source: string;
  readonly destination: string;
  readonly override?: boolean;
  /** Plain destination collection name. */
  readonly toCollection?: string;
}

/**
 * Runs each move in order; an unavailable destination is reported for its operation
 * and later moves continue. If an operation throws, earlier completed moves remain on
 * disk and their mutations have already been delivered through `onMutation`.
 */
export async function moveResources(
  collection: Collection,
  ops: readonly MoveResourcesOperation[],
  options: MoveOptionsWithConfig,
): Promise<MoveResourceResult> {
  const result: Omit<MoveResourceResult, 'outcome'> = { movedCount: 0, warnings: [], errors: [] };
  for (const op of ops) {
    try {
      const moved = await moveResource(collection, op, options);
      result.movedCount += moved.movedCount;
      result.warnings.push(...moved.warnings);
      result.errors.push(...moved.errors);
    } catch (error) {
      if (error instanceof CollectionNotFoundError || error instanceof ReadOnlyCollectionError) {
        result.errors.push(error.message);
        continue;
      }
      throw error;
    }
  }
  return withMoveOutcome(result);
}
