import { isFolderPathUnder } from '@simoncodes-ca/domain';
import { type Collection, type OpenedCollection, openProjectCollection } from '../config/open-collection';
import {
  CollectionNotFoundError,
  FolderNotFoundError,
  InvalidCollectionFolderError,
  ReadOnlyCollectionError,
} from '../errors/lingo-tracker-error';
import { describeFolderProblem } from './collection-folders';
import { sweepCollection, sweepKeys } from './collection-sweep';
import {
  folderAddressExists,
  inspectFolderAddress,
  resolveFolderAddress,
  validateFolderAddress,
} from './folder-address';
import { pruneEmptiedFolders } from './folder-pruning';
import { movePatternPrefix, validateMoveInput } from './move-input';
import { planMove } from './move-plan';
import { MoveReport, type MoveResult } from './move-report';
import { relocateEntries } from './relocate-entries';
import type { MutationSinkOptions } from './resource-mutation';

/** Submitted addresses; patterns retain the trailing `*` syntax (including root `*`). */
export type MoveRequest = {
  readonly source: string;
  readonly destination: string;
  readonly override?: boolean;
  readonly toCollection?: string;
} & ({ readonly kind?: 'resource' } | { readonly kind: 'folder'; readonly nestUnderDestination?: boolean });

export type MoveOptions = MutationSinkOptions;

export type ExecuteMoveResult = MoveResult;

type Selection = Omit<MoveRequest, 'kind'> &
  ({ readonly kind: 'key' | 'pattern' } | { readonly kind: 'folder'; readonly nestUnderDestination?: boolean });
type FolderSelection = Extract<Selection, { kind: 'folder' }>;
interface MoveBatch {
  readonly emptiedFolders: Set<string>;
  readonly folderSources: Array<{ source: string; empty: boolean }>;
}

type PreparedMove = { readonly destinationCollection: Collection } & (
  | { readonly kind: 'resource'; readonly selection: Exclude<Selection, { kind: 'folder' }> }
  | { readonly kind: 'folder'; readonly selection: FolderSelection; readonly plan: ReturnType<typeof prepareFolder> }
);

/** Synchronous move; selection/destination preconditions throw, operational failures enter the report. */
export function executeMove(
  collection: OpenedCollection,
  request: MoveRequest,
  options: MoveOptions = {},
): ExecuteMoveResult {
  const selection = validateSelection(request);
  const prepared = prepareMove(collection, selection);
  return finishMoves(collection, [prepared], options, selection.kind === 'folder');
}

/** Preflight addresses, destinations and folder sources before writes; unavailable destinations are per-operation errors. */
export function executeMoves(
  collection: OpenedCollection,
  requests: readonly MoveRequest[],
  options: MoveOptions = {},
): ExecuteMoveResult {
  const selections = requests.map(validateSelection);
  const prepared = selections.map((selection): PreparedMove | { readonly error: string } => {
    try {
      return prepareMove(collection, selection);
    } catch (error) {
      if (error instanceof CollectionNotFoundError || error instanceof ReadOnlyCollectionError) {
        return { error: error.message };
      }
      throw error;
    }
  });
  return finishMoves(
    collection,
    prepared,
    options,
    selections.some(({ kind }) => kind === 'folder'),
  );
}

function finishMoves(
  collection: Collection,
  prepared: readonly (PreparedMove | { readonly error: string })[],
  options: MoveOptions,
  includesFolder: boolean,
): ExecuteMoveResult {
  const report = new MoveReport();
  const batch: MoveBatch = { emptiedFolders: new Set(), folderSources: [] };
  try {
    for (const move of prepared) {
      if ('error' in move) report.fail(move.error);
      else report.merge(executePreparedMove(collection, move, options, batch));
    }
  } finally {
    const pruning = pruneEmptiedFolders(collection, batch.emptiedFolders, options);
    const failedEmptySourceProblems = new Set<(typeof pruning.problems)[number]>();
    // validateSelection rejects root folder sources with validateFolderAddress(..., false)
    // before either executeMove or executeMoves can populate this batch.
    for (const { source, empty } of batch.folderSources) {
      const problems =
        empty && !pruning.removed.includes(source)
          ? pruning.problems.filter(({ folderPath }) => isFolderPathUnder(source, folderPath))
          : [];
      for (const problem of problems) failedEmptySourceProblems.add(problem);
      report.prune(
        source,
        {
          removed: pruning.removed,
          kept: pruning.kept.filter(({ folderPath }) => isFolderPathUnder(source, folderPath)),
          problems,
        },
        empty,
      );
    }
    for (const problem of pruning.problems) {
      if (!failedEmptySourceProblems.has(problem)) report.warn(describeFolderProblem(problem));
    }
  }
  return includesFolder ? report.finish(true) : report.finish();
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

function prepareMove(collection: OpenedCollection, selection: Selection): PreparedMove {
  const destinationCollection = resolveDestination(collection, selection.toCollection);
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

function resolveDestination(source: OpenedCollection, name: string | undefined): Collection {
  if (!name) return source;
  try {
    return openProjectCollection(source, name, { writable: true });
  } catch (error) {
    if (error instanceof CollectionNotFoundError) throw new CollectionNotFoundError(name, 'destination');
    throw error;
  }
}

function executePreparedMove(
  collection: Collection,
  move: PreparedMove,
  options: MoveOptions,
  batch: MoveBatch,
): ExecuteMoveResult {
  const report = new MoveReport();
  const { destinationCollection, selection } = move;
  if (move.kind === 'folder') return executeFolder(collection, move.selection, move.plan, options, report, batch);

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
  report.merge(
    relocateEntries(plan, {
      override,
      emptiedFolders: batch.emptiedFolders,
      onMutation: options.onMutation,
    }),
  );
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
  batch: MoveBatch,
): ExecuteMoveResult {
  const { source: sourceFolderPath, override = false } = selection;
  if (plan.kind === 'refused') {
    report.warn(plan.warning());
    return report.finish(true);
  }

  // Extract all resource keys from the source folder tree
  const folders = [...sweepCollection(collection, { startPath: sourceFolderPath })];
  const resourceKeys = folders.flatMap((folder) =>
    folder.folder ? folder.folder.keys().map((key) => `${folder.folderPath}.${key}`) : [],
  );
  const problems = folders.flatMap((folder) => (folder.problem ? [folder.problem] : []));
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
        emptiedFolders: batch.emptiedFolders,
        onMutation: options.onMutation,
      });
  report.merge(relocation);

  // Keys that stayed in the source (collision without override, or an error); the source folder must be kept.
  const movedKeys = new Set(relocation.moved.map(({ from }) => from));
  const keptKeys = resourceKeys.filter((key) => !movedKeys.has(key));

  if (keptKeys.length > 0) {
    report.warn(`Source folder kept; resources not moved: ${keptKeys.join(', ')}`);
  }

  if (keptKeys.length === 0 && report.hasErrors === false) {
    // Include folders that were already empty, so folder moves retain their batch repair behaviour.
    for (const folder of folders) batch.emptiedFolders.add(folder.absolutePath);
    batch.folderSources.push({ source: sourceFolderPath, empty });
  }

  return report.finish(true);
}
