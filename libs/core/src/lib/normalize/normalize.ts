import * as fs from 'node:fs';
import { normalizeEntry } from './normalize-entry';
import { cleanupEmptyFolders } from './cleanup-empty-folders';
import { walkFolders } from './iterative-folder-walker';
import { openResourceFolder, type ResourceFolder } from '../resource/resource-folder';

export interface NormalizeParams {
  readonly translationsFolder: string;
  readonly baseLocale: string;
  readonly locales: string[];
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

interface NormalizationCounters {
  entriesProcessed: number;
  localesAdded: number;
  valuesConverted: number;
  tagsNormalized: number;
  filesCreated: number;
  filesUpdated: number;
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

interface NormalizeFolderParams {
  readonly folderPath: string;
  readonly baseLocale: string;
  readonly locales: string[];
  readonly dryRun: boolean;
  readonly counters: NormalizationCounters;
}

function normalizeFolderResources(params: NormalizeFolderParams): void {
  const { folderPath, baseLocale, locales, dryRun, counters } = params;

  // Skip this folder if there was a JSON parsing error
  const folder = openFolderOrWarn(folderPath, baseLocale);
  if (folder === null || folder.isEmpty()) {
    return;
  }

  let folderHadChanges = false;

  for (const entryKey of folder.keys()) {
    const stored = folder.get(entryKey);
    if (!stored) continue;

    const result = normalizeEntry({
      entryKey,
      resourceEntry: stored.entry,
      metadata: stored.meta ?? {},
      baseLocale,
      locales,
    });

    folder.setEntry(entryKey, result.resourceEntry, result.metadata);

    counters.entriesProcessed++;
    counters.localesAdded += result.changes.localesAdded;
    counters.valuesConverted += result.changes.valuesConverted;
    counters.tagsNormalized += result.changes.tagsNormalized;

    if (Object.values(result.changes).some((count) => count > 0)) {
      folderHadChanges = true;
    }
  }

  // Normalize guarantees both files exist, so a missing file is written even without changes.
  const filesMissing = !fs.existsSync(folder.entriesPath) || !fs.existsSync(folder.metaPath);
  if (!folderHadChanges && !filesMissing) {
    return;
  }

  const { written, created } = folder.save({ dryRun });
  counters.filesCreated += created.length;
  counters.filesUpdated += written.length - created.length;
}

interface NormalizeAllFoldersParams {
  readonly rootPath: string;
  readonly baseLocale: string;
  readonly locales: string[];
  readonly dryRun: boolean;
  readonly counters: NormalizationCounters;
}

async function normalizeAllFolders(params: NormalizeAllFoldersParams): Promise<void> {
  const { rootPath, baseLocale, locales, dryRun, counters } = params;

  const foldersByDepth = new Map<number, string[]>();
  for (const visit of walkFolders(rootPath, { skipHidden: false })) {
    const group = foldersByDepth.get(visit.depth) ?? [];
    group.push(visit.absolutePath);
    foldersByDepth.set(visit.depth, group);
  }

  const depths = [...foldersByDepth.keys()].sort((a, b) => a - b);
  for (const depth of depths) {
    // Concurrency safety: folders at the same depth share the `counters` object. This is safe
    // because normalizeFolderResources contains no await points — all I/O (ResourceFolder
    // open/save) is synchronous, so mutations to `counters` are never interleaved.
    await Promise.all(
      (foldersByDepth.get(depth) ?? []).map((folderPath) =>
        normalizeFolderResources({ folderPath, baseLocale, locales, dryRun, counters }),
      ),
    );
  }
}

/**
 * Normalizes all translation resources in a translations folder by:
 * - Ensuring resource_entries.json and tracker_meta.json exist at every level
 * - Recomputing checksums for all entries
 * - Adding missing locale entries
 * - Updating translation statuses based on base value changes
 * - Removing empty folders after normalization
 *
 * This operation is non-destructive: it preserves existing values, comments, and tags.
 *
 * @param params - Normalization parameters including folder path and locale configuration
 * @returns Summary of normalization results with counts of changes made
 */
export async function normalize(params: NormalizeParams): Promise<NormalizeResult> {
  const { translationsFolder, baseLocale, locales, dryRun = false } = params;

  const counters: NormalizationCounters = {
    entriesProcessed: 0,
    localesAdded: 0,
    valuesConverted: 0,
    tagsNormalized: 0,
    filesCreated: 0,
    filesUpdated: 0,
  };

  if (!fs.existsSync(translationsFolder)) {
    return {
      entriesProcessed: 0,
      localesAdded: 0,
      valuesConverted: 0,
      tagsNormalized: 0,
      filesCreated: 0,
      filesUpdated: 0,
      foldersRemoved: 0,
      dryRun,
    };
  }

  await normalizeAllFolders({
    rootPath: translationsFolder,
    baseLocale,
    locales,
    dryRun,
    counters,
  });

  const cleanupResult = cleanupEmptyFolders(translationsFolder, dryRun);

  return {
    entriesProcessed: counters.entriesProcessed,
    localesAdded: counters.localesAdded,
    valuesConverted: counters.valuesConverted,
    tagsNormalized: counters.tagsNormalized,
    filesCreated: counters.filesCreated,
    filesUpdated: counters.filesUpdated,
    foldersRemoved: cleanupResult.foldersRemoved,
    dryRun,
  };
}
