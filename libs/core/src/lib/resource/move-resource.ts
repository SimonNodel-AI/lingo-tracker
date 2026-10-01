import { validateKey } from '@simoncodes-ca/domain';
import type { Collection } from '../config/open-collection';
import { sweepKeys } from './collection-sweep';
import { folderAddressExists } from './folder-address';
import { planMove } from './move-plan';
import { type Relocation, type RelocationResult, relocateEntries } from './relocate-entries';
import type { ResourceMutation } from './resource-mutation';

export interface MoveResourceParams {
  /** Full source key, or a prefix pattern ending with `*` (`common.buttons.*`). */
  readonly source: string;
  /** Full destination key; for a pattern, the prefix the matched keys move under (`''`: the collection root). */
  readonly destination: string;
  /** Replace an existing destination entry. Default: false (the key is skipped with a warning). */
  readonly override?: boolean;
  /** Destination collection for a cross-collection move. Default: the source collection. */
  readonly destinationCollection?: Collection;
}

export interface MoveResourceResult {
  movedCount: number;
  warnings: string[];
  errors: string[];
  /** A `remove` per moved key at the source, then an `upsert` per moved key at the destination. */
  mutations: ResourceMutation[];
}

/**
 * Moves resources from source to destination, within a collection or into another one, as one
 * Entry Relocation (`relocateEntries`: lossless, one save per folder, locales fitted to the
 * destination collection). Supports single key move and wildcard pattern move (ending with *).
 * Per-key failures are reported in the result, not thrown.
 */
export async function moveResource(collection: Collection, params: MoveResourceParams): Promise<MoveResourceResult> {
  const { source, destination, override = false, destinationCollection = collection } = params;
  const result: MoveResourceResult = { movedCount: 0, warnings: [], errors: [], mutations: [] };

  let relocations: Relocation[];
  if (source.endsWith('*')) {
    const expanded = expandPattern(collection, source, destination, result);
    if (!expanded) return result;
    relocations = expanded;
  } else {
    relocations = [...planMove({ kind: 'key', key: source }, destination).relocations];
  }

  const relocation = relocateEntries(collection, destinationCollection, relocations, { override });
  return mergeRelocation(result, relocation);
}

/** Adds a relocation's outcome to a move result: collisions become warnings. */
export function mergeRelocation<T extends MoveResourceResult>(result: T, relocation: RelocationResult): T {
  result.movedCount += relocation.moved.length;
  result.warnings.push(...relocation.collisions.map(({ to }) => collisionWarning(to)));
  result.errors.push(...relocation.errors);
  result.mutations.push(...relocation.mutations);
  return result;
}

function collisionWarning(destinationKey: string): string {
  return `Destination key already exists: ${destinationKey}. Use override option to force move.`;
}

/**
 * The relocations of a `prefix.*` pattern: every key the Collection Sweep finds under the prefix,
 * moved under `destinationKey`. `undefined` (with the reason in `result`) when nothing can move.
 */
function expandPattern(
  collection: Collection,
  pattern: string,
  destinationKey: string,
  result: MoveResourceResult,
): Relocation[] | undefined {
  const prefix = pattern.slice(0, -1); // remove '*'
  const cleanPrefix = prefix.endsWith('.') ? prefix.slice(0, -1) : prefix;

  if (cleanPrefix.length > 0) {
    try {
      validateKey(cleanPrefix);
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }

  if (!folderAddressExists(collection.translationsFolder, cleanPrefix)) {
    result.warnings.push(`No folder found for prefix ${cleanPrefix}. Nothing moved.`);
    return undefined;
  }

  const { keys, problems } = sweepKeys(collection, { startPath: cleanPrefix });
  result.errors.push(...problems.map((problem) => problem.message));

  return [...planMove({ kind: 'pattern', prefix: cleanPrefix, keys }, destinationKey).relocations];
}
