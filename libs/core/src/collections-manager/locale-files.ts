import type { Collection } from '../lib/config/open-collection';
import { sweepCollection } from '../lib/resource/collection-sweep';
import type { ResourceFolder } from '../lib/resource/resource-folder';

export interface LocaleFilesResult {
  /** Entries the locale was added to or dropped from. */
  readonly entries: number;
  /** Folders whose files were rewritten. */
  readonly filesUpdated: number;
}

/**
 * Seeds `locale` in every resource folder of `collection` through `ResourceFolder.seedLocale`
 * (the one seeding rule, which normalize shares). Touches only the translation files, never the config.
 */
export function seedLocaleFiles(collection: Collection, locale: string): LocaleFilesResult {
  return rewriteFolders(collection, (folder) => folder.seedLocale(locale));
}

/** Drops `locale` from every resource folder of `collection`. Touches only the translation files. */
export function dropLocaleFiles(collection: Collection, locale: string): LocaleFilesResult {
  return rewriteFolders(collection, (folder) => folder.dropLocale(locale));
}

/**
 * Applies `change` to every folder of the Collection Sweep and saves the ones it changed.
 * @throws Error A folder cannot be read (the folders swept before it are already saved).
 */
function rewriteFolders(collection: Collection, change: (folder: ResourceFolder) => number): LocaleFilesResult {
  let entries = 0;
  let filesUpdated = 0;

  for (const { folder, problem } of sweepCollection(collection)) {
    if (problem) {
      throw new Error(problem.message);
    }
    const changed = change(folder);
    if (changed > 0) {
      folder.save();
      entries += changed;
      filesUpdated++;
    }
  }

  return { entries, filesUpdated };
}
