import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { type Collection, openCollection } from '../config/open-collection';
import {
  CollectionNotFoundError,
  ReadOnlyCollectionError,
  MoveConfigRequiredError,
  FolderNotFoundError,
  InvalidCollectionFolderError,
} from '../errors/lingo-tracker-error';
import { describeFolderProblem } from './collection-folders';
import { sweepKeys } from './collection-sweep';
import {
  folderAddressExists,
  inspectFolderAddress,
  resolveFolderAddress,
  validateFolderAddress,
} from './folder-address';
import { pruneEmptyFolders } from './folder-pruning';
import { movePatternPrefix, validateMoveInput } from './move-input';
import { planMove } from './move-plan';
import { MoveReport, type MoveResult } from './move-report';
import { relocateEntries } from './relocate-entries';
import { type MutationSinkOptions, resolveMutationSink } from './resource-mutation';

/** Submitted addresses; patterns retain the trailing `*` syntax (including root `*`). */
export type MoveRequest = {
  readonly source: string;
  readonly destination: string;
  readonly override?: boolean;
  readonly toCollection?: string;
} & ({ readonly kind?: 'resource' } | { readonly kind: 'folder'; readonly nestUnderDestination?: boolean });

export type MoveOptions = MutationSinkOptions & {
  readonly config?: LingoTrackerConfig;
  readonly cwd?: string;
};

export type ExecuteMoveResult = MoveResult;

type Selection = Omit<MoveRequest, 'kind'> &
  ({ readonly kind: 'key' | 'pattern' } | { readonly kind: 'folder'; readonly nestUnderDestination?: boolean });
type FolderSelection = Extract<Selection, { kind: 'folder' }>;
type PreparedMove = { readonly destinationCollection: Collection } & (
  | { readonly kind: 'resource'; readonly selection: Exclude<Selection, { kind: 'folder' }> }
  | { readonly kind: 'folder'; readonly selection: FolderSelection; readonly plan: ReturnType<typeof prepareFolder> }
);

/** Synchronous move; selection/destination preconditions throw, operational failures enter the report. */
export function executeMove(
  collection: Collection,
  request: MoveRequest,
  options: MoveOptions = {},
): ExecuteMoveResult {
  return executePreparedMove(collection, prepareMove(collection, validateSelection(request), options), options);
}

/** Preflight addresses, destinations and folder sources before writes; unavailable destinations are per-operation errors. */
export function executeMoves(
  collection: Collection,
  requests: readonly MoveRequest[],
  options: MoveOptions = {},
): ExecuteMoveResult {
  const selections = requests.map(validateSelection);
  const prepared = selections.map((selection): PreparedMove | { readonly error: string } => {
    try {
      return prepareMove(collection, selection, options);
    } catch (error) {
      if (
        error instanceof CollectionNotFoundError ||
        error instanceof ReadOnlyCollectionError ||
        error instanceof MoveConfigRequiredError
      ) {
        return { error: error.message };
      }
      throw error;
    }
  });
  const report = new MoveReport();
  for (const move of prepared) {
    if ('error' in move) report.fail(move.error);
    else report.merge(executePreparedMove(collection, move, options));
  }
  return selections.some(({ kind }) => kind === 'folder') ? report.finish(true) : report.finish();
}

function validateSelection(request: MoveRequest): Selection {
  if (request.kind === 'folder') {
    validateFolderAddress(request.source, 'source folder path', false);
    validateFolderAddress(request.destination, 'destination folder path');
    return request;
  }
  const kind = validateMoveInput(request);
  return { ...request, kind };
}

function prepareMove(collection: Collection, selection: Selection, options: MoveOptions): PreparedMove {
  const destinationCollection = resolveDestination(collection, selection.toCollection, options);
  if (selection.kind === 'folder') {
    return {
      kind: 'folder',
      selection,
      destinationCollection,
      plan: prepareFolder(collection, destinationCollection, selection),
    };
  }
  return { kind: 'resource', selection, destinationCollection };
}

function resolveDestination(source: Collection, name: string | undefined, options: MoveOptions): Collection {
  if (!name) return source;
  if (!options.config) throw new MoveConfigRequiredError();
  try {
    return openCollection(options.config, name, { cwd: options.cwd, writable: true });
  } catch (error) {
    if (error instanceof CollectionNotFoundError) throw new CollectionNotFoundError(name, 'destination');
    throw error;
  }
}

function executePreparedMove(collection: Collection, move: PreparedMove, options: MoveOptions): ExecuteMoveResult {
  const report = new MoveReport();
  const { destinationCollection, selection } = move;
  if (move.kind === 'folder') return executeFolder(collection, move.selection, move.plan, options, report);

  const { source, destination, override = false } = selection;
  let plannedSelection: { kind: 'key'; key: string } | { kind: 'pattern'; prefix: string; keys: readonly string[] };
  if (selection.kind === 'pattern') {
    const prefix = movePatternPrefix(source);
    if (!folderAddressExists(collection.translationsFolder, prefix)) {
      report.warn(`No folder found for prefix ${prefix}. Nothing moved.`);
      return report.finish();
    }
    const { keys, problems } = sweepKeys(collection, { startPath: prefix });
    for (const problem of problems) report.fail(describeFolderProblem(problem));
    plannedSelection = { kind: 'pattern', prefix, keys };
  } else {
    plannedSelection = { kind: 'key', key: source };
  }
  const plan = planMove({
    source: collection,
    destination: destinationCollection,
    selection: plannedSelection,
    destinationPath: destination,
  });
  report.merge(relocateEntries(plan, { override, onMutation: resolveMutationSink(collection, options) }));
  return report.finish();
}

function prepareFolder(collection: Collection, destinationCollection: Collection, selection: FolderSelection) {
  const { source: sourceFolderPath, destination: destinationFolderPath, nestUnderDestination = true } = selection;

  const plan = planMove({
    source: collection,
    destination: destinationCollection,
    selection: { kind: 'folder', path: sourceFolderPath, nestUnderDestination },
    destinationPath: destinationFolderPath,
  });
  if (plan.kind === 'refused') {
    // Preserve no-op refusals before source inspection; descendant refusals still throw.
    plan.warning();
    return plan;
  }

  let isDirectory: boolean;
  try {
    isDirectory = inspectFolderAddress(collection.translationsFolder, sourceFolderPath).isDirectory;
    resolveFolderAddress(destinationCollection.translationsFolder, destinationFolderPath);
  } catch (error) {
    if (error instanceof InvalidCollectionFolderError) {
      throw new InvalidCollectionFolderError(error.problem, 'move', sourceFolderPath);
    }
    throw error;
  }
  if (!isDirectory) {
    throw new FolderNotFoundError(sourceFolderPath);
  }

  return plan;
}

function executeFolder(
  collection: Collection,
  selection: FolderSelection,
  plan: ReturnType<typeof prepareFolder>,
  options: MoveOptions,
  report: MoveReport,
): ExecuteMoveResult {
  const { source: sourceFolderPath, override = false } = selection;
  if (plan.kind === 'refused') {
    report.warn(plan.warning());
    return report.finish(true);
  }

  // Extract all resource keys from the source folder tree
  const { keys: resourceKeys, problems } = sweepKeys(collection, { startPath: sourceFolderPath });
  const enumerationErrors = problems.map(
    (problem) => new InvalidCollectionFolderError(problem, 'move', sourceFolderPath).message,
  );

  // An unreadable folder would be deleted without its entries being copied; stop before any move/delete.
  if (enumerationErrors.length > 0) {
    for (const error of enumerationErrors) report.fail(error);
    return report.finish(true);
  }

  const empty = resourceKeys.length === 0;
  if (empty) report.warn('No resources found in source folder. Nothing to move.');

  // One Entry Relocation for the whole tree: each folder is read and written once.
  const relocation = empty
    ? { moved: [], collisions: [], errors: [] }
    : relocateEntries(plan.forKeys(resourceKeys), {
        override,
        onMutation: resolveMutationSink(collection, options),
      });
  report.merge(relocation);

  // Keys that stayed in the source (collision without override, or an error); the source folder must be kept.
  const movedKeys = new Set(relocation.moved.map(({ from }) => from));
  const keptKeys = resourceKeys.filter((key) => !movedKeys.has(key));

  if (keptKeys.length > 0) {
    report.warn(`Source folder kept; resources not moved: ${keptKeys.join(', ')}`);
  }

  // Only remove the source folder when every resource in it was moved
  if (keptKeys.length === 0 && report.hasErrors === false) {
    try {
      report.prune(
        sourceFolderPath,
        pruneEmptyFolders(collection, {
          startPath: sourceFolderPath,
          onMutation: resolveMutationSink(collection, options),
        }),
        empty,
      );
    } catch (error) {
      report.pruningFailed(error, empty);
    }
  }

  return report.finish(true);
}
