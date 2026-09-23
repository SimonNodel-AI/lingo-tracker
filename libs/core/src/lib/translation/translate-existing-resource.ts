import { resolve } from 'node:path';
import { needsTranslation } from '@simoncodes-ca/domain';
import type { TranslationConfig } from '../../config/translation-config';
import type { ResourceTreeEntry } from '../resource/load-resource-tree';
import { validateAndResolvePaths } from '../resource/resource-file-paths';
import { openResourceFolder, type ResourceFolder } from '../resource/resource-folder';
import { type ResourceMutation, upsertMutation } from '../resource/resource-mutation';
import { autoTranslateResource } from './auto-translate-resources';

export interface TranslateExistingResourceOptions {
  readonly key: string;
  readonly translationsFolder: string;
  readonly translationConfig: TranslationConfig;
  readonly allLocales: readonly string[];
  readonly baseLocale: string;
  readonly cwd?: string;
}

export interface TranslateExistingResourceResult {
  readonly translatedCount: number;
  readonly skippedLocales: string[];
  readonly entry: ResourceTreeEntry;
  /** What changed on disk (empty when nothing was translated). */
  readonly mutations: ResourceMutation[];
}

/**
 * Translates an existing resource entry for all locales with 'new' or 'stale' status.
 *
 * Resolves the resource key to its file paths, reads the current state, identifies
 * which locales still need translation (status is 'new' or 'stale'), calls the
 * auto-translate provider, updates the resource entries and tracker metadata, and
 * writes both files to disk.
 *
 * Returns early with `translatedCount: 0` when no locales require translation.
 *
 * Throws {@link TranslationError} if the translation provider fails — callers
 * should map this to an appropriate HTTP error (e.g. 502 Bad Gateway).
 *
 * @param options - Resolution and translation parameters for this resource.
 * @returns The updated resource entry along with translation and skip counts.
 */
export async function translateExistingResource(
  options: TranslateExistingResourceOptions,
): Promise<TranslateExistingResourceResult> {
  const { key, translationsFolder, translationConfig, allLocales, baseLocale, cwd = process.cwd() } = options;

  const paths = validateAndResolvePaths({ key, translationsFolder, cwd });

  const folder = openResourceFolder(paths.folderPath, { baseLocale });
  const current = folder.get(paths.entryKey);

  if (!current?.meta) {
    throw new Error(`Resource not found: ${paths.resolvedKey}`);
  }

  const { entry, meta } = current;
  const targetLocales = allLocales.filter((locale) => locale !== baseLocale && needsTranslation(meta[locale]));

  if (targetLocales.length === 0) {
    return {
      translatedCount: 0,
      skippedLocales: [],
      entry: requireTreeEntry(folder, paths.entryKey, paths.resolvedKey),
      mutations: [],
    };
  }

  const { translations: translatedEntries, skippedLocales } = await autoTranslateResource({
    baseValue: entry.source,
    baseLocale,
    targetLocales,
    translationConfig,
  });

  for (const { locale, value } of translatedEntries) {
    folder.setTranslation(paths.entryKey, locale, value, 'translated');
  }

  if (translatedEntries.length > 0) {
    folder.save();
  }

  const updatedEntry = requireTreeEntry(folder, paths.entryKey, paths.resolvedKey);

  return {
    translatedCount: translatedEntries.length,
    skippedLocales,
    entry: updatedEntry,
    mutations:
      translatedEntries.length > 0
        ? [upsertMutation(resolve(cwd, translationsFolder), paths.resolvedKey, updatedEntry)]
        : [],
  };
}

function requireTreeEntry(folder: ResourceFolder, entryKey: string, resolvedKey: string): ResourceTreeEntry {
  const treeEntry = folder.treeEntry(entryKey);
  if (!treeEntry) {
    throw new Error(`Resource not found: ${resolvedKey}`);
  }
  return treeEntry;
}
