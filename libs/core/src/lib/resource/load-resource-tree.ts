import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ResourceEntryMetadata } from '../../resource/resource-entry-metadata';
import { readCollectionFolders } from './read-collection';

export interface ResourceTreeNode {
  /** Folder path segments (empty array for root) */
  folderPathSegments: string[];

  /** Resources in this folder */
  resources: ResourceTreeEntry[];

  /** Child folders */
  children: FolderChild[];
}

export interface ResourceTreeEntry {
  key: string;
  source: string;
  translations: Record<string, string>;
  comment?: string;
  tags?: string[];
  metadata: ResourceEntryMetadata;
}

export interface FolderChild {
  name: string;
  fullPathSegments: string[];
  loaded: boolean;
  tree?: ResourceTreeNode;
}

export interface LoadResourceTreeOptions {
  /** Root translations folder path */
  translationsFolder: string;

  /** The collection's base locale; folders are opened with it. */
  baseLocale: string;

  /** Folder to start from (dot-delimited, empty for root) */
  path?: string;

  /** Depth to recursively load */
  depth?: number;

  /** Current working directory */
  cwd?: string;
}

/**
 * Loads the resource tree of a translations folder (or of the subfolder at `path`), `depth` levels
 * deep; deeper folders are listed as not loaded. Folders are read through the Collection Reader,
 * so its rules apply: an entry without metadata has `metadata: {}`, and a folder that cannot be
 * read has no resources (the problem is logged).
 *
 * @throws Error when `path` names a folder that does not exist, or the start folder is not a folder.
 *   A missing translations folder is an empty tree.
 */
export function loadResourceTree(options: LoadResourceTreeOptions): ResourceTreeNode {
  const { baseLocale, path: folderPath = '', depth = 2, cwd = process.cwd() } = options;
  const translationsFolder = path.resolve(cwd, options.translationsFolder);
  const pathSegments = folderPath ? folderPath.split('.').filter(Boolean) : [];
  const absoluteFolderPath = path.join(translationsFolder, ...pathSegments);

  if (!fs.existsSync(absoluteFolderPath)) {
    if (pathSegments.length === 0) {
      // Root translations folder doesn't exist yet (e.g. fresh project) — treat as empty
      return { folderPathSegments: [], resources: [], children: [] };
    }
    throw new Error(`Folder not found: ${absoluteFolderPath}`);
  }
  if (!fs.statSync(absoluteFolderPath).isDirectory()) {
    throw new Error(`Not a folder: ${absoluteFolderPath}`);
  }

  const nodes = new Map<string, ResourceTreeNode>();
  let rootNode: ResourceTreeNode = { folderPathSegments: pathSegments, resources: [], children: [] };

  const folders = readCollectionFolders(
    { translationsFolder, baseLocale, tags: [] },
    { startPath: pathSegments.join('.'), maxDepth: depth },
  );

  // Parents are visited before their children, and siblings in directory order.
  for (const folder of folders) {
    if (folder.problem) {
      console.warn(`Error loading resources from ${folder.absolutePath}: ${folder.problem.message}`);
    }

    const segments = [...folder.segments];
    const node: ResourceTreeNode = {
      folderPathSegments: segments,
      resources: folder.resources.map((resource) => resource.entry),
      children:
        folder.depth >= depth
          ? folder.subfolderNames.map((name) => ({ name, fullPathSegments: [...segments, name], loaded: false }))
          : [],
    };
    nodes.set(folder.absolutePath, node);

    if (folder.depth === 0) {
      rootNode = node;
      continue;
    }

    const parent = nodes.get(path.dirname(folder.absolutePath));
    parent?.children.push({
      name: segments[segments.length - 1],
      fullPathSegments: segments,
      loaded: true,
      tree: node,
    });
  }

  return rootNode;
}
