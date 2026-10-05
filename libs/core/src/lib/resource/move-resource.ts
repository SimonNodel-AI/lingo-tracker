import { resolveMutationSink } from './resource-mutation';
import type { Collection } from '../config/open-collection';
import { describeFolderProblem } from './collection-folders';
import { sweepKeys } from './collection-sweep';
import { folderAddressExists } from './folder-address';
import { type MoveOptions, type MoveOptionsWithConfig, resolveMoveDestination } from './move-destination';
import { MoveReport, type MoveResult } from './move-report';
import { movePatternPrefix, validateMoveInput } from './move-input';
import { type MoveSelection, planMove } from './move-plan';
import { relocateEntries } from './relocate-entries';

export interface MoveResourceParams {
  /** Full source key, or a prefix pattern ending with `*` (`common.buttons.*`). */
  readonly source: string;
  /** Full destination key; for a pattern, the prefix the matched keys move under (`''`: the collection root). */
  readonly destination: string;
  /** Replace an existing destination entry. Default: false (the key is skipped with a warning). */
  readonly override?: boolean;
  /** Plain destination collection name. Default: the source collection. */
  readonly toCollection?: string;
}

export type MoveResourceResult = MoveResult;

/**
 * Moves resources from source to destination, within a collection or into another one, as one
 * Entry Relocation (`relocateEntries`: lossless, one save per folder, locales fitted to the
 * destination collection). Supports single key move and wildcard pattern move (ending with *).
 * Per-key failures are reported in the result, not thrown.
 */
export function moveResource(
  collection: Collection,
  params: MoveResourceParams,
  options: MoveOptionsWithConfig,
): Promise<MoveResourceResult>;
export function moveResource(
  collection: Collection,
  params: MoveResourceParams & { readonly toCollection?: undefined },
  options?: MoveOptions,
): Promise<MoveResourceResult>;
export async function moveResource(
  collection: Collection,
  params: MoveResourceParams,
  options: MoveOptions = {},
): Promise<MoveResourceResult> {
  validateMoveInput(params);
  const { source, destination, override = false } = params;
  const destinationCollection = resolveMoveDestination(collection, params.toCollection, options);
  const report = new MoveReport();

  let selection: Exclude<MoveSelection, { readonly kind: 'folder' }>;
  if (source.endsWith('*')) {
    const expanded = expandPattern(collection, source, report);
    if (!expanded) return report.finish();
    selection = expanded;
  } else {
    selection = { kind: 'key', key: source };
  }

  const plan = planMove({
    source: collection,
    destination: destinationCollection,
    selection,
    destinationPath: destination,
  });
  const relocation = relocateEntries(plan, {
    override,
    onMutation: resolveMutationSink(collection, options),
  });
  report.merge(relocation);
  return report.finish();
}

/**
 * Select every key the Collection Sweep finds under a `prefix.*` pattern.
 * `undefined` (with the reason in the report) when nothing can move.
 */
function expandPattern(
  collection: Collection,
  pattern: string,
  report: MoveReport,
): Extract<MoveSelection, { readonly kind: 'pattern' }> | undefined {
  const cleanPrefix = movePatternPrefix(pattern);

  if (!folderAddressExists(collection.translationsFolder, cleanPrefix)) {
    report.warn(`No folder found for prefix ${cleanPrefix}. Nothing moved.`);
    return undefined;
  }

  const { keys, problems } = sweepKeys(collection, { startPath: cleanPrefix });
  for (const problem of problems) report.fail(describeFolderProblem(problem));

  return { kind: 'pattern', prefix: cleanPrefix, keys };
}
