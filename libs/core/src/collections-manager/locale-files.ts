import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { RESOURCE_ENTRIES_FILENAME } from '../constants';
import type { Collection } from '../lib/config/open-collection';
import { walkFolders } from '../lib/normalize/iterative-folder-walker';
import { openResourceFolder } from '../lib/resource/resource-folder';

export interface LocaleFilesResult {
  /** Entries the locale was added to or dropped from. */
  readonly entries: number;
  /** Folders whose files were rewritten. */
  readonly filesUpdated: number;
}

/**
 * Seeds `locale` in every resource folder of `collection` with the base value and status
 * `new` (the same convention normalize uses for a missing locale). Touches only the
 * translation files, never the config.
 */
export function seedLocaleFiles(collection: Collection, locale: string): LocaleFilesResult {
  return rewriteFolders(collection, (folder) => folder.seedLocale(locale));
}

/** Drops `locale` from every resource folder of `collection`. Touches only the translation files. */
export function dropLocaleFiles(collection: Collection, locale: string): LocaleFilesResult {
  return rewriteFolders(collection, (folder) => folder.dropLocale(locale));
}

function rewriteFolders(
  collection: Collection,
  change: (folder: ReturnType<typeof openResourceFolder>) => number,
): LocaleFilesResult {
  let entries = 0;
  let filesUpdated = 0;

  for (const visit of walkFolders(collection.translationsFolder)) {
    if (!existsSync(path.join(visit.absolutePath, RESOURCE_ENTRIES_FILENAME))) continue;

    const folder = openResourceFolder(visit.absolutePath, { baseLocale: collection.baseLocale });
    const changed = change(folder);
    if (changed > 0) {
      folder.save();
      entries += changed;
      filesUpdated++;
    }
  }

  return { entries, filesUpdated };
}
