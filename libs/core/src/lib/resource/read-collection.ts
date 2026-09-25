import { join, relative, sep } from 'node:path';
import { effectiveTags } from '@simoncodes-ca/domain';
import type { Collection } from '../config/open-collection';
import { walkFolders } from '../normalize/iterative-folder-walker';
import type { ResourceTreeEntry } from './load-resource-tree';
import { openResourceFolder } from './resource-folder';

/**
 * Collection Reader — the read side of the Resource Folder.
 *
 * Every read of a whole collection (export, validate, bundle, type generation, search, the
 * resource tree, glossary) walks the translations folder here, so one set of rules applies:
 *
 * - Folders are opened with the collection's base locale, through `openResourceFolder`.
 * - Hidden folders (name starts with `.`) are skipped: a key segment cannot start with `.`.
 * - A missing translations folder is an empty collection, not a problem. A folder that exists but
 *   cannot be listed (permission denied, or the translations "folder" is a file) is a problem.
 * - **Missing metadata**: an entry without a `tracker_meta.json` record (or a folder without the
 *   file) is read with `metadata: {}`. Every locale then has no status, which readers treat as `new`.
 * - **Malformed folder**: when a folder cannot be read (a file is not valid JSON, or an entry is
 *   not an object), none of its entries are read and the folder is reported as a
 *   {@link CollectionReadProblem}. The walk continues with the other folders. The caller decides
 *   what a problem means: validate fails, export lists it under malformed files, bundle warns.
 */

/** What the reader needs from a collection. A resolved `Collection` fits. */
export type CollectionReadTarget = Pick<Collection, 'translationsFolder' | 'baseLocale' | 'tags'>;

/** One resource entry as stored, with its address in the collection. */
export interface StoredResource {
  /** Full dot-delimited key, e.g. `apps.common.buttons.ok`. */
  readonly fullKey: string;
  /** Folder part of the key, e.g. `apps.common.buttons`; `''` at the collection root. */
  readonly folderPath: string;
  /** Last key segment, e.g. `ok` (the same as `entry.key`). */
  readonly entryKey: string;
  /**
   * The entry as the Resource Folder reads it (`ResourceFolder.treeEntry`): `source` is the base value,
   * `translations` every locale property stored besides `source` (normally the target locales; a
   * hand-written base-locale key is kept as stored), `metadata` the stored record per locale
   * (`{}` when there is none), and the entry's own `comment` and `tags` (non-array tags read as none).
   */
  readonly entry: ResourceTreeEntry;
  /** The collection's tags united with the entry's own tags (see `effectiveTags` in domain). */
  readonly effectiveTags: readonly string[];
}

/** A folder the reader could not read. Its entries are missing from the result. */
export interface CollectionReadProblem {
  /** Dot-delimited folder path relative to the translations folder; `''` for the root. */
  readonly folderPath: string;
  /** Absolute path of the folder. */
  readonly absolutePath: string;
  /** Why the folder could not be read; names the file. */
  readonly message: string;
}

/** Everything the reader found in a collection. */
export interface CollectionRead {
  /** Every readable entry, folder by folder (parents before children, directory order). */
  readonly resources: StoredResource[];
  /** Folders that could not be read. */
  readonly problems: CollectionReadProblem[];
}

/** One folder visited by {@link readCollectionFolders}. */
export interface CollectionFolderRead {
  /** Folder path segments relative to the translations folder; empty for the root. */
  readonly segments: readonly string[];
  /** `segments` joined with `.`. */
  readonly folderPath: string;
  readonly absolutePath: string;
  /** Depth below the folder the walk started at (which is 0). */
  readonly depth: number;
  /** Subfolders (hidden ones excluded), whether or not the walk descends into them. */
  readonly subfolderNames: readonly string[];
  /** The folder's entries; empty when `problem` is set. */
  readonly resources: readonly StoredResource[];
  readonly problem?: CollectionReadProblem;
}

export interface ReadCollectionFoldersOptions {
  /** Dot-delimited folder to start at. Default: the collection root. */
  readonly startPath?: string;
  /** How deep to descend below the start folder (0 = the start folder only). Default: no limit. */
  readonly maxDepth?: number;
}

/**
 * Reads every resource entry of a collection.
 * Never throws for a folder it cannot read; see the module rules above.
 */
export function readCollection(collection: CollectionReadTarget): CollectionRead {
  const resources: StoredResource[] = [];
  const problems: CollectionReadProblem[] = [];

  for (const folder of readCollectionFolders(collection)) {
    if (folder.problem) {
      problems.push(folder.problem);
    } else {
      resources.push(...folder.resources);
    }
  }

  return { resources, problems };
}

/**
 * Walks a collection folder by folder (parents before children, in directory order), reading
 * each folder by the rules above. Lazy, so a caller can stop early. `readCollection` and the
 * resource tree loader are built on it.
 */
export function* readCollectionFolders(
  collection: CollectionReadTarget,
  options: ReadCollectionFoldersOptions = {},
): Generator<CollectionFolderRead> {
  const root = collection.translationsFolder;
  const startSegments = (options.startPath ?? '').split('.').filter((segment) => segment.length > 0);
  const collectionTags = [...collection.tags];

  // The walker skips a folder it cannot list (the start folder included); each one becomes a
  // problem, so an unreadable folder is never read as an empty one.
  const unlistable: CollectionFolderRead[] = [];
  const onUnlistable = (absolutePath: string, error: unknown): void => {
    const segments = segmentsOf(root, absolutePath);
    const folderPath = segments.join('.');
    const message = error instanceof Error ? error.message : String(error);
    unlistable.push({
      segments,
      folderPath,
      absolutePath,
      depth: segments.length - startSegments.length,
      subfolderNames: [],
      resources: [],
      problem: { folderPath, absolutePath, message: `Cannot list folder ${absolutePath}: ${message}` },
    });
  };

  const walk = walkFolders(join(root, ...startSegments), { maxDepth: options.maxDepth, onUnlistable });
  for (const visit of walk) {
    yield* unlistable.splice(0);
    const segments = segmentsOf(root, visit.absolutePath);
    const folderPath = segments.join('.');
    const base = {
      segments,
      folderPath,
      absolutePath: visit.absolutePath,
      depth: visit.depth,
      subfolderNames: visit.subdirectoryNames,
    };

    let resources: StoredResource[];
    try {
      resources = readFolder(visit.absolutePath, folderPath, collection.baseLocale, collectionTags);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { ...base, resources: [], problem: { folderPath, absolutePath: visit.absolutePath, message } };
      continue;
    }

    yield { ...base, resources };
  }
  yield* unlistable.splice(0);
}

function segmentsOf(root: string, absolutePath: string): string[] {
  return relative(root, absolutePath)
    .split(sep)
    .filter((segment) => segment.length > 0);
}

function readFolder(
  absolutePath: string,
  folderPath: string,
  baseLocale: string,
  collectionTags: string[],
): StoredResource[] {
  const folder = openResourceFolder(absolutePath, { baseLocale });
  const resources: StoredResource[] = [];

  for (const entryKey of folder.keys()) {
    const stored = folder.get(entryKey);
    if (typeof stored?.entry !== 'object' || stored.entry === null) {
      throw new Error(`Resource entry "${entryKey}" in ${folder.entriesPath} is not an object`);
    }
    const entry = folder.treeEntry(entryKey);
    if (!entry) continue;

    resources.push({
      fullKey: folderPath ? `${folderPath}.${entryKey}` : entryKey,
      folderPath,
      entryKey,
      entry,
      effectiveTags: effectiveTags(collectionTags, entry.tags),
    });
  }

  return resources;
}
