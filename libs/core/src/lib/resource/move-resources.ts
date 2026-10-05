import type { Collection } from '../config/open-collection';
import { CollectionNotFoundError, ReadOnlyCollectionError } from '../errors/lingo-tracker-error';
import type { MoveOptionsWithConfig } from './move-destination';
import { type MoveResourceResult, moveResource } from './move-resource';
import { MoveReport } from './move-report';
import { validateMoveInput } from './move-input';

export interface MoveResourcesOperation {
  readonly source: string;
  readonly destination: string;
  readonly override?: boolean;
  /** Plain destination collection name. */
  readonly toCollection?: string;
}

/**
 * Validates every operation before any write, then runs each move in order. An unavailable
 * destination is reported for its operation and later moves continue. If a runtime operation
 * throws, earlier completed moves remain on
 * disk and their mutations have already been delivered through `onMutation`.
 */
export async function moveResources(
  collection: Collection,
  ops: readonly MoveResourcesOperation[],
  options: MoveOptionsWithConfig,
): Promise<MoveResourceResult> {
  for (const op of ops) validateMoveInput(op);

  const report = new MoveReport();
  for (const op of ops) {
    try {
      const moved = await moveResource(collection, op, options);
      report.merge(moved);
    } catch (error) {
      if (error instanceof CollectionNotFoundError || error instanceof ReadOnlyCollectionError) {
        report.fail(error.message);
        continue;
      }
      throw error;
    }
  }
  return report.finish();
}
