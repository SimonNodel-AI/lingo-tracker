import type { FolderNodeDto } from '@simoncodes-ca/data-transfer';

/**
 * Inserts a new folder into the tree at the specified parent path.
 * Returns a new array with the folder inserted (immutable update).
 */
export function insertFolderIntoTree(
  folders: FolderNodeDto[],
  newFolder: FolderNodeDto,
  parentPath: string | null,
): FolderNodeDto[] {
  if (!parentPath) {
    const updated = [...folders, newFolder];
    updated.sort((a, b) => a.name.localeCompare(b.name));
    return updated;
  }

  const parentSegments = parentPath.split('.');

  const updateChildren = (nodes: FolderNodeDto[], depth: number): FolderNodeDto[] =>
    nodes.map((node) => {
      if (node.name === parentSegments[depth]) {
        if (depth === parentSegments.length - 1) {
          const updatedChildren = [...(node.tree?.children ?? []), newFolder];
          updatedChildren.sort((a, b) => a.name.localeCompare(b.name));
          return {
            ...node,
            loaded: true,
            tree: node.tree
              ? { ...node.tree, children: updatedChildren }
              : { path: node.fullPath, resources: [], children: updatedChildren },
          };
        } else if (node.tree?.children) {
          return {
            ...node,
            tree: { ...node.tree, children: updateChildren(node.tree.children, depth + 1) },
          };
        }
      }
      return node;
    });

  return updateChildren(folders, 0);
}

/**
 * Removes a folder from the tree by its full path.
 * Returns a new array with the folder removed (immutable update).
 */
export function removeFolderFromTree(folders: FolderNodeDto[], pathToRemove: string): FolderNodeDto[] {
  return folders
    .filter((folder) => folder.fullPath !== pathToRemove)
    .map((folder) => {
      if (folder.tree?.children) {
        return {
          ...folder,
          tree: {
            ...folder.tree,
            children: removeFolderFromTree(folder.tree.children, pathToRemove),
          },
        };
      }
      return folder;
    });
}

/**
 * Finds a folder node in the tree by its full path.
 * Returns the folder node or undefined if not found.
 */
export function findFolderInTree(folders: readonly FolderNodeDto[], fullPath: string): FolderNodeDto | undefined {
  for (const folder of folders) {
    if (folder.fullPath === fullPath) return folder;
    if (folder.tree?.children) {
      const found = findFolderInTree(folder.tree.children, fullPath);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Narrows a folder tree to the folders whose path contains `filter` (trimmed,
 * case-insensitive), keeping an unmatched folder only as the ancestor of a match.
 *
 * A matching folder is kept whole: its descendants' paths start with its own, so
 * they match too. An unmatched ancestor is copied with its children pruned. An
 * empty filter returns the tree as it is.
 */
export function filterFolderTree(folders: FolderNodeDto[], filter: string): FolderNodeDto[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return folders;

  const prune = (nodes: readonly FolderNodeDto[]): FolderNodeDto[] =>
    nodes.flatMap((folder) => {
      if (folder.fullPath.toLowerCase().includes(needle)) return [folder];
      const children = folder.tree ? prune(folder.tree.children) : [];
      return folder.tree && children.length > 0 ? [{ ...folder, tree: { ...folder.tree, children } }] : [];
    });

  return prune(folders);
}

/**
 * Creates a deep copy of a folder with all paths updated to reflect a new parent location.
 * For example, moving folder "common" (fullPath "common") into "apps" updates:
 * - "common" -> "apps.common"
 * - "common.buttons" -> "apps.common.buttons"
 */
export function rebaseFolderPaths(folder: FolderNodeDto, newParentPath: string): FolderNodeDto {
  const newFullPath = newParentPath ? `${newParentPath}.${folder.name}` : folder.name;
  return {
    ...folder,
    fullPath: newFullPath,
    tree: folder.tree
      ? {
          ...folder.tree,
          path: newFullPath,
          children: folder.tree.children.map((child) => rebaseFolderPaths(child, newFullPath)),
        }
      : undefined,
  };
}

/**
 * Collects the full paths of every folder in the tree that has at least one child,
 * i.e. every folder that expand-all has something to open.
 */
export function collectExpandablePaths(folders: FolderNodeDto[]): string[] {
  const paths: string[] = [];

  const walk = (nodes: FolderNodeDto[]): void => {
    for (const node of nodes) {
      const children = node.tree?.children ?? [];
      if (children.length > 0) {
        paths.push(node.fullPath);
        walk(children);
      }
    }
  };

  walk(folders);
  return paths;
}

/**
 * Returns the strict ancestor paths of a dot-delimited folder path, outermost first.
 * `apps.common.buttons` yields `['apps', 'apps.common']`. The path itself is excluded:
 * revealing a folder does not open it.
 */
export function collectAncestorPaths(path: string): string[] {
  if (!path) return [];

  const segments = path.split('.');
  const ancestors: string[] = [];

  for (let i = 1; i < segments.length; i++) {
    ancestors.push(segments.slice(0, i).join('.'));
  }

  return ancestors;
}

/**
 * Removes a path and everything beneath it from a set of expanded paths.
 * Used after a folder is deleted so the set cannot accumulate paths that no longer exist.
 */
export function prunePathsUnder(paths: ReadonlySet<string>, removedPath: string): Set<string> {
  const prefix = `${removedPath}.`;
  const next = new Set<string>();

  for (const path of paths) {
    if (path === removedPath || path.startsWith(prefix)) continue;
    next.add(path);
  }

  return next;
}

/**
 * Rewrites expanded paths after a folder moves, so a subtree the user had opened
 * stays open where it lands instead of snapping shut.
 */
export function rebaseExpandedPaths(
  paths: ReadonlySet<string>,
  sourcePath: string,
  destinationParentPath: string,
): Set<string> {
  const segments = sourcePath.split('.');
  const folderName = segments[segments.length - 1];
  const newSourcePath = destinationParentPath ? `${destinationParentPath}.${folderName}` : folderName;

  if (newSourcePath === sourcePath) return new Set(paths);

  const prefix = `${sourcePath}.`;
  const next = new Set<string>();

  for (const path of paths) {
    if (path === sourcePath) next.add(newSourcePath);
    else if (path.startsWith(prefix)) next.add(`${newSourcePath}.${path.slice(prefix.length)}`);
    else next.add(path);
  }

  return next;
}
