import * as fs from 'node:fs';
import * as path from 'node:path';
import { walkCollectionFolders } from '../resource/collection-folders';
import { openResourceFolder } from '../resource/resource-folder';

/**
 * Returns the collection folders under `rootPath` (the collection-folder policy: hidden folders
 * and folders that cannot be listed are left out), deepest first.
 * This is essential for safe folder cleanup operations.
 *
 * @param rootPath - The translations folder
 * @returns Array of folder paths sorted by depth (deepest first)
 */
export function getAllFoldersBottomUp(rootPath: string): string[] {
  const foldersWithDepth: { path: string; depth: number }[] = [];

  for (const visit of walkCollectionFolders(rootPath)) {
    if (visit.problem) continue;
    foldersWithDepth.push({ path: visit.absolutePath, depth: visit.depth });
  }

  // Sort by depth descending (deepest folders first) for bottom-up processing
  return foldersWithDepth.sort((a, b) => b.depth - a.depth).map((folder) => folder.path);
}

/**
 * Determines if a folder is considered empty according to LingoTracker rules.
 * A folder is empty if it has:
 * - No resource_entries.json file, OR
 * - An empty resource_entries.json (no entries or {}), AND
 * - No subfolders (a hidden subfolder counts, so the folder that holds one is kept)
 *
 * Files like tracker_meta.json and hidden files (.gitkeep, .DS_Store) are ignored.
 *
 * @param folderPath - The folder path to check
 * @returns true if the folder is empty and can be safely removed
 */
export function isFolderEmpty(folderPath: string): boolean {
  if (!fs.existsSync(folderPath)) {
    return true;
  }

  const entries = fs.readdirSync(folderPath);

  // Check for subfolders - if any exist, folder is not empty
  const hasSubfolders = entries.some((entry: string) => {
    const entryPath = path.join(folderPath, entry);
    const stats = fs.statSync(entryPath);
    return stats.isDirectory();
  });

  if (hasSubfolders) {
    return false;
  }

  // Empty unless resource_entries.json has entries (a missing file counts as empty)
  try {
    return openResourceFolder(folderPath).isEmpty();
  } catch {
    // If we can't parse the file, consider it NOT empty to prevent deletion
    // This preserves corrupted files so they can be manually fixed
    return false;
  }
}
