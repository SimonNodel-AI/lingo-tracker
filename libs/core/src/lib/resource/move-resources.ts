import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { type Collection, openCollection } from '../config/open-collection';
import { CollectionNotFoundError, ReadOnlyCollectionError } from '../errors/lingo-tracker-error';
import { type MoveResourceResult, moveResource } from './move-resource';

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
 * disk but no result or mutations are returned. The Collection Index then catches up
 * through disk-fingerprint revalidation.
 */
export async function moveResources(
  collection: Collection,
  ops: readonly MoveResourcesOperation[],
  options: { readonly config: LingoTrackerConfig },
): Promise<MoveResourceResult> {
  const result: MoveResourceResult = { movedCount: 0, warnings: [], errors: [], mutations: [] };
  for (const op of ops) {
    let destinationCollection: Collection | undefined;
    if (op.toCollection) {
      const name = op.toCollection;
      try {
        destinationCollection = openCollection(options.config, name, { writable: true });
      } catch (error) {
        if (error instanceof CollectionNotFoundError) {
          result.errors.push(`Destination collection "${name}" not found`);
          continue;
        }
        if (error instanceof ReadOnlyCollectionError) {
          result.errors.push(error.message);
          continue;
        }
        throw error;
      }
    }

    const moved = await moveResource(collection, {
      source: op.source,
      destination: op.destination,
      override: op.override,
      destinationCollection,
    });
    result.movedCount += moved.movedCount;
    result.warnings.push(...moved.warnings);
    result.errors.push(...moved.errors);
    result.mutations.push(...moved.mutations);
  }
  return result;
}
