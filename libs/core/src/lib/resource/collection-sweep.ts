import type { Collection } from '../config/open-collection';
import {
  type CollectionFolderAddress,
  type CollectionFolderProblem,
  type WalkCollectionFoldersOptions,
  walkCollectionFolders,
} from './collection-folders';
import { openResourceFolder, type ResourceFolder } from './resource-folder';

/**
 * Collection Sweep — the write side of the Resource Folder, the twin of the Collection Reader.
 *
 * Every write that goes over many folders of a collection (add/remove locale, normalize, folder
 * move and delete, pattern move) walks them here, so one set of rules applies:
 *
 * - Which folders are swept is the collection-folder policy the reader uses too
 *   (`collection-folders.ts`): hidden folders and everything below them are not part of the
 *   collection, a missing translations folder is an empty collection, and a folder that cannot be
 *   listed is a problem.
 * - Each folder is opened with the collection's base locale, through `openResourceFolder`, and
 *   handed to the caller to change and save. Folders without entries are swept too.
 * - A folder whose files are not valid JSON is not opened; it is yielded as a problem, and the
 *   sweep continues. The caller decides what a problem means.
 */

/** What the sweep needs from a collection. A resolved `Collection` fits. */
export type CollectionSweepTarget = Pick<Collection, 'translationsFolder' | 'baseLocale'>;

/** One folder of a sweep: opened, or a problem. */
export type SweptFolder =
  | (CollectionFolderAddress & { readonly folder: ResourceFolder; readonly problem?: undefined })
  | (CollectionFolderAddress & { readonly folder?: undefined; readonly problem: CollectionFolderProblem });

export type SweepCollectionOptions = Pick<WalkCollectionFoldersOptions, 'startPath'>;

/**
 * Opens every collection folder under `startPath` (default: the root), parents before children,
 * in directory order. Lazy: a folder is opened when the caller reaches it, so a save made to an
 * earlier folder is on disk before the next one is read.
 */
export function* sweepCollection(
  collection: CollectionSweepTarget,
  options: SweepCollectionOptions = {},
): Generator<SweptFolder> {
  for (const visit of walkCollectionFolders(collection.translationsFolder, options)) {
    const { segments, folderPath, absolutePath, depth } = visit;
    const address = { segments, folderPath, absolutePath, depth };
    if (visit.problem) {
      yield { ...address, problem: visit.problem };
      continue;
    }

    let folder: ResourceFolder;
    try {
      folder = openResourceFolder(absolutePath, { baseLocale: collection.baseLocale });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { ...address, problem: { folderPath, absolutePath, message } };
      continue;
    }
    yield { ...address, folder };
  }
}

/**
 * The full keys of every entry the sweep finds under `startPath`, and the folders it could not read.
 */
export function sweepKeys(
  collection: CollectionSweepTarget,
  options: SweepCollectionOptions = {},
): { keys: string[]; problems: CollectionFolderProblem[] } {
  const keys: string[] = [];
  const problems: CollectionFolderProblem[] = [];
  for (const swept of sweepCollection(collection, options)) {
    if (swept.problem) {
      problems.push(swept.problem);
    } else {
      keys.push(...swept.folder.keys().map((entryKey) => fullKeyOf(swept.folderPath, entryKey)));
    }
  }
  return { keys, problems };
}

/** The full key of `entryKey` in the folder at `folderPath` (`''` is the collection root). */
export function fullKeyOf(folderPath: string, entryKey: string): string {
  return folderPath ? `${folderPath}.${entryKey}` : entryKey;
}
