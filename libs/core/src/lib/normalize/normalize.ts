import { existsSync } from 'node:fs';
import type { Collection } from '../config/open-collection';
import { ReadOnlyCollectionError } from '../errors/lingo-tracker-error';
import { openResourceFolder, type ResourceFolder } from '../resource/resource-folder';
import { cleanupEmptyFolders } from './cleanup-empty-folders';
import { walkFolders } from './iterative-folder-walker';
import { normalizeEntryValues } from './normalize-entry';

export interface NormalizeOptions {
  /** Report what would change without writing anything. */
  readonly dryRun?: boolean;
}

export interface NormalizeResult {
  readonly entriesProcessed: number;
  readonly localesAdded: number;
  readonly valuesConverted: number;
  readonly tagsNormalized: number;
  readonly filesCreated: number;
  readonly filesUpdated: number;
  readonly foldersRemoved: number;
  readonly dryRun: boolean;
}

type Counters = {
  -readonly [K in Exclude<keyof NormalizeResult, 'dryRun' | 'foldersRemoved'>]: number;
};

/**
 * Normalizes every resource folder of a writable collection:
 * - makes `resource_entries.json` and `tracker_meta.json` exist wherever there are entries,
 * - converts Transloco `{{ x }}` syntax to ICU and normalizes tags (`normalizeEntryValues`),
 * - recomputes checksums, re-applies the Staleness rule and seeds the collection's missing
 *   target locales, through `ResourceFolder.normalizeEntry`,
 * - removes empty folders afterwards.
 *
 * Non-destructive: existing values, comments and tags are kept. A folder whose files are not
 * valid JSON is reported on stderr and skipped.
 *
 * @throws {ReadOnlyCollectionError} The collection is read-only.
 */
export async function normalize(collection: Collection, options: NormalizeOptions = {}): Promise<NormalizeResult> {
  if (collection.readOnly) {
    throw new ReadOnlyCollectionError(collection.name);
  }
  const dryRun = options.dryRun ?? false;
  const counters: Counters = {
    entriesProcessed: 0,
    localesAdded: 0,
    valuesConverted: 0,
    tagsNormalized: 0,
    filesCreated: 0,
    filesUpdated: 0,
  };

  if (!existsSync(collection.translationsFolder)) {
    return { ...counters, foldersRemoved: 0, dryRun };
  }

  for (const visit of walkFolders(collection.translationsFolder, { skipHidden: false })) {
    normalizeFolder(visit.absolutePath, collection, dryRun, counters);
  }

  const { foldersRemoved } = cleanupEmptyFolders(collection.translationsFolder, dryRun);
  return { ...counters, foldersRemoved, dryRun };
}

function normalizeFolder(folderPath: string, collection: Collection, dryRun: boolean, counters: Counters): void {
  const folder = openFolderOrWarn(folderPath, collection.baseLocale);
  if (folder === null || folder.isEmpty()) {
    return;
  }

  let folderChanged = false;
  for (const key of folder.keys()) {
    const stored = folder.get(key);
    if (!stored) continue;

    const values = normalizeEntryValues(stored.entry);
    const report = folder.normalizeEntry(key, values.entry, collection.targetLocales);

    counters.entriesProcessed++;
    counters.localesAdded += report.localesAdded;
    counters.valuesConverted += values.valuesConverted;
    counters.tagsNormalized += values.tagsNormalized;
    if (report.changed) folderChanged = true;
  }

  // Normalize guarantees both files exist, so a missing file is written even without changes.
  const filesMissing = !existsSync(folder.entriesPath) || !existsSync(folder.metaPath);
  if (!folderChanged && !filesMissing) {
    return;
  }

  const { written, created } = folder.save({ dryRun });
  counters.filesCreated += created.length;
  counters.filesUpdated += written.length - created.length;
}

function openFolderOrWarn(folderPath: string, baseLocale: string): ResourceFolder | null {
  try {
    return openResourceFolder(folderPath, { baseLocale });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('\n⚠️  Skipping folder due to invalid JSON:', folderPath);
    console.error('    Parse error:', errorMessage);
    console.error('    Please fix the JSON syntax manually.\n');
    return null;
  }
}
