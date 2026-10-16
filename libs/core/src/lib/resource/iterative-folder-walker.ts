import * as fs from 'node:fs';
import * as path from 'node:path';
import { RESOURCE_ENTRIES_FILENAME, TRACKER_META_FILENAME } from '../../constants';
import { hasFsErrorCode } from '../file-io/fs-error';

export interface WalkFoldersOptions {
  /** Maximum traversal depth. 0 = root only, 1 = root + immediate children. Defaults to Infinity. */
  maxDepth?: number;
  /** Previously visited real paths. Defaults to a fresh set for each scan. */
  visitedPaths?: Set<string>;
  /**
   * Called for a directory (the root included) that exists but cannot be listed — permission
   * denied, or a file where a directory was expected. The directory is skipped either way.
   */
  onUnlistable?: (absolutePath: string, error: unknown) => void;
}

export interface FolderVisit {
  /** Absolute path to this directory. */
  absolutePath: string;
  /** Depth relative to root. Root itself is 0. */
  depth: number;
  /** Names of subdirectories that will be visited (hidden ones excluded). */
  subdirectoryNames: string[];
  /** All entries, including hidden folders and stray files, for pruning safety checks. */
  entries: readonly fs.Dirent[];
  /** Resource and metadata file names present in this folder. Directories are excluded. */
  resourceFileNames: readonly string[];
}

interface StackEntry {
  readonly absolutePath: string;
  readonly depth: number;
}

/**
 * Collection Tree Scan: lazily walks a directory tree using an explicit DFS stack, yielding a FolderVisit
 * for each directory encountered. The caller controls iteration and can break early.
 *
 * Key properties:
 * - DFS traversal in readdir order (top-down: parent before children)
 * - Hidden directories (names starting with '.') are skipped, with everything below them
 * - maxDepth limits traversal depth (0 = root only)
 * - Cycle detection via realpath on every scan
 * - Yields nothing (does not throw) when rootPath does not exist
 *
 * @param rootPath - Absolute path to the root directory to walk
 * @param options - Optional configuration for traversal behavior
 *
 * @example
 * for (const visit of walkFolders('/translations')) {
 *   console.log(visit.depth, visit.absolutePath);
 * }
 *
 * @example Early exit
 * for (const visit of walkFolders('/translations')) {
 *   if (shouldStop(visit)) break;
 * }
 */
export function* walkFolders(rootPath: string, options?: WalkFoldersOptions): Generator<FolderVisit, void> {
  const maxDepth = options?.maxDepth ?? Infinity;
  const visitedPaths = options?.visitedPaths ?? new Set<string>();

  if (!fs.existsSync(rootPath)) {
    return;
  }

  const stack: StackEntry[] = [{ absolutePath: rootPath, depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;

    let realPath: string;
    try {
      realPath = fs.realpathSync(current.absolutePath);
    } catch (error) {
      if (!hasFsErrorCode(error, 'ENOENT')) options?.onUnlistable?.(current.absolutePath, error);
      continue;
    }
    if (visitedPaths.has(realPath)) continue;
    visitedPaths.add(realPath);

    let dirEntries: fs.Dirent[];
    try {
      dirEntries = fs.readdirSync(current.absolutePath, { withFileTypes: true });
    } catch (error) {
      // Cannot be listed (permission denied, not a directory, or gone since the check) — skip
      options?.onUnlistable?.(current.absolutePath, error);
      continue;
    }

    const visitableSubdirectoryNames = dirEntries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !entry.name.startsWith('.'))
      .map((entry) => entry.name);

    yield {
      absolutePath: current.absolutePath,
      depth: current.depth,
      subdirectoryNames: visitableSubdirectoryNames,
      entries: dirEntries,
      resourceFileNames: dirEntries
        .filter(
          (entry) =>
            !entry.isDirectory() && (entry.name === RESOURCE_ENTRIES_FILENAME || entry.name === TRACKER_META_FILENAME),
        )
        .map((entry) => entry.name),
    };

    if (current.depth >= maxDepth) {
      continue;
    }

    // Push children in reverse order so the first subdirectory is processed first
    for (let i = visitableSubdirectoryNames.length - 1; i >= 0; i--) {
      const subdirName = visitableSubdirectoryNames[i];
      stack.push({
        absolutePath: path.join(current.absolutePath, subdirName),
        depth: current.depth + 1,
      });
    }
  }
}
