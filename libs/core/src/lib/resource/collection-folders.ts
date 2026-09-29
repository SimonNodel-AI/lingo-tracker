import { join, relative, sep } from 'node:path';
import { walkFolders } from './iterative-folder-walker';

/**
 * Which folders belong to a collection — the one policy the Collection Reader (reads) and the
 * Collection Sweep (writes) share:
 *
 * - Every folder under the translations folder is a collection folder, except hidden ones (the
 *   name starts with `.`) and everything below them: a key segment cannot start with `.`.
 * - A missing translations (or start) folder is an empty collection, not a problem.
 * - A folder that exists but cannot be listed (permission denied, or a file where a folder is
 *   expected) is a {@link CollectionFolderProblem}; the walk continues with the other folders.
 */

/** A collection folder that could not be read. Its entries are missing from the walk's result. */
export interface CollectionFolderProblem {
  /** Dot-delimited folder path relative to the translations folder; `''` for the root. */
  readonly folderPath: string;
  /** Absolute path of the folder. */
  readonly absolutePath: string;
  /** Why the folder could not be read; names the file. */
  readonly message: string;
}

/** A collection folder's address. */
export interface CollectionFolderAddress {
  /** Folder path segments relative to the translations folder; empty for the root. */
  readonly segments: readonly string[];
  /** `segments` joined with `.`. */
  readonly folderPath: string;
  readonly absolutePath: string;
  /** Depth below the folder the walk started at (which is 0). */
  readonly depth: number;
}

/** One folder visited by {@link walkCollectionFolders}. */
export interface CollectionFolderVisit extends CollectionFolderAddress {
  /** Subfolders (hidden ones excluded), whether or not the walk descends into them. */
  readonly subfolderNames: readonly string[];
  /** Set when the folder cannot be listed; `subfolderNames` is then empty. */
  readonly problem?: CollectionFolderProblem;
}

export interface WalkCollectionFoldersOptions {
  /** Dot-delimited folder to start at. Default: the collection root. */
  readonly startPath?: string;
  /** How deep to descend below the start folder (0 = the start folder only). Default: no limit. */
  readonly maxDepth?: number;
}

/**
 * Walks the collection folders under `translationsFolder` (parents before children, in directory
 * order), by the rules above. Lazy, so a caller can stop early. Opens no files.
 */
export function* walkCollectionFolders(
  translationsFolder: string,
  options: WalkCollectionFoldersOptions = {},
): Generator<CollectionFolderVisit> {
  const startSegments = (options.startPath ?? '').split('.').filter((segment) => segment.length > 0);
  const addressOf = (absolutePath: string): CollectionFolderAddress => {
    const segments = segmentsOf(translationsFolder, absolutePath);
    return { segments, folderPath: segments.join('.'), absolutePath, depth: segments.length - startSegments.length };
  };

  // The walker skips a folder it cannot list (the start folder included); each one becomes a
  // problem, so an unreadable folder is never taken for an empty one.
  const unlistable: CollectionFolderVisit[] = [];
  const onUnlistable = (absolutePath: string, error: unknown): void => {
    const address = addressOf(absolutePath);
    const message = error instanceof Error ? error.message : String(error);
    unlistable.push({
      ...address,
      subfolderNames: [],
      problem: {
        folderPath: address.folderPath,
        absolutePath,
        message: `Cannot list folder ${absolutePath}: ${message}`,
      },
    });
  };

  const walk = walkFolders(join(translationsFolder, ...startSegments), { maxDepth: options.maxDepth, onUnlistable });
  for (const visit of walk) {
    yield* unlistable.splice(0);
    yield { ...addressOf(visit.absolutePath), subfolderNames: visit.subdirectoryNames };
  }
  yield* unlistable.splice(0);
}

function segmentsOf(root: string, absolutePath: string): string[] {
  return relative(root, absolutePath)
    .split(sep)
    .filter((segment) => segment.length > 0);
}
