import { resolve } from 'node:path';
import { ResourceNotFoundError } from '../lib/errors/lingo-tracker-error';
import { validateAndResolvePaths } from '../lib/resource/resource-file-paths';
import { openResourceFolder, type ResourceFolder } from '../lib/resource/resource-folder';
import type { ResourceTreeEntry } from '../lib/resource/load-resource-tree';
import { type ResourceMutation, upsertMutation } from '../lib/resource/resource-mutation';
import type { TranslationConfig } from '../config/translation-config';
import { autoTranslateResource } from '../lib/translation/auto-translate-resources';
import type { TranslationStatus } from '@simoncodes-ca/domain';
import { translocoToICU, normalizeTags } from '@simoncodes-ca/domain';

export interface EditResourceOptions {
  key: string;
  targetFolder?: string;
  baseValue?: string;
  comment?: string;
  tags?: string[];
  locales?: Record<string, { value: string; status?: TranslationStatus }>;
  baseLocale?: string;
  cwd?: string;
  translationConfig?: TranslationConfig;
  /**
   * All configured locales. Required when using auto-translation after a base
   * value change so the orchestrator knows which target locales to update.
   */
  allLocales?: readonly string[];
}

export interface EditResourceResult {
  resolvedKey: string;
  updated: boolean;
  message?: string;
  entry?: ResourceTreeEntry;
  skippedLocales?: string[];
  /** What changed on disk (empty when nothing was updated). */
  mutations: ResourceMutation[];
}

/**
 * Edits an existing resource entry in the translations folder.
 *
 * When `options.translationConfig` is enabled and `options.baseValue` changes,
 * all non-base locales are automatically re-translated. The updated translations
 * are written in a second pass after the initial save, so the base value change
 * is persisted even if auto-translation fails.
 *
 * @param translationsFolder - Root translations folder path
 * @param options - Edit options including the resource key and fields to update
 * @returns Result object indicating what changed
 */
export async function editResource(
  translationsFolder: string,
  options: EditResourceOptions,
): Promise<EditResourceResult> {
  const { cwd = process.cwd(), baseLocale = 'en' } = options;

  const paths = validateAndResolvePaths({
    key: options.key,
    translationsFolder,
    targetFolder: options.targetFolder,
    cwd,
  });

  const folder = openResourceFolder(paths.folderPath, { baseLocale });
  const current = folder.get(paths.entryKey);

  if (!current?.meta) {
    throw new ResourceNotFoundError(paths.resolvedKey);
  }

  const key = paths.entryKey;
  // Live view of the stored entry: it reflects every change made through `folder`.
  const { entry } = current;
  let hasChanges = false;

  // 1. Update Base Value — normalize to ICU format before comparing and storing.
  // setBase applies the Staleness rule to every translation.
  const normalizedBaseValue = options.baseValue !== undefined ? translocoToICU(options.baseValue) : undefined;
  const baseValueDidChange = normalizedBaseValue !== undefined && normalizedBaseValue !== entry.source;

  if (baseValueDidChange) {
    folder.setBase(key, normalizedBaseValue);
    hasChanges = true;
  }

  // 2. Update Comment
  if (options.comment !== undefined && folder.setDetails(key, { comment: options.comment })) {
    hasChanges = true;
  }

  // 3. Update Tags
  if (options.tags !== undefined && folder.setDetails(key, { tags: normalizeTags(options.tags) })) {
    hasChanges = true;
  }

  // 4. Update Locales
  if (options.locales) {
    for (const [locale, { value, status }] of Object.entries(options.locales)) {
      if (locale === baseLocale) continue; // Base value handled separately

      const normalizedLocaleValue = translocoToICU(value);
      const resolvedStatus = status ?? 'translated';
      const localeMeta = folder.get(key)?.meta?.[locale];

      if (normalizedLocaleValue !== entry[locale]) {
        folder.setTranslation(key, locale, normalizedLocaleValue, resolvedStatus);
        hasChanges = true;
      } else if (localeMeta && localeMeta.status !== resolvedStatus) {
        folder.setStatus(key, locale, resolvedStatus);
        hasChanges = true;
      }
    }
  }

  if (!hasChanges) {
    return {
      resolvedKey: paths.resolvedKey,
      updated: false,
      message: 'No changes detected',
      mutations: [],
    };
  }

  // Two-phase write: persist the edit before attempting auto-translation, so the
  // base value update is durable even if the translation API call fails.
  folder.save();

  // 5. Auto-translate when base value changed and translation is configured
  let autoTranslateSkippedLocales: string[] | undefined;

  if (baseValueDidChange) {
    const autoTranslateResult = await applyAutoTranslationsAfterBaseValueChange({
      folder,
      key,
      baseValue: normalizedBaseValue,
      baseLocale,
      allLocales: options.allLocales,
      translationConfig: options.translationConfig,
    });

    if (autoTranslateResult.skippedLocales.length > 0) {
      autoTranslateSkippedLocales = autoTranslateResult.skippedLocales;
    }

    if (autoTranslateResult.didTranslate) {
      // Second phase: persist the translated values.
      folder.save();
    }
  }

  const updatedEntry = folder.treeEntry(key);
  if (!updatedEntry) {
    throw new ResourceNotFoundError(paths.resolvedKey);
  }

  return {
    resolvedKey: paths.resolvedKey,
    updated: true,
    entry: updatedEntry,
    mutations: [upsertMutation(resolve(cwd, translationsFolder), paths.resolvedKey, updatedEntry)],
    ...(autoTranslateSkippedLocales !== undefined && { skippedLocales: autoTranslateSkippedLocales }),
  };
}

interface ApplyAutoTranslationsParams {
  readonly folder: ResourceFolder;
  readonly key: string;
  readonly baseValue: string;
  readonly baseLocale: string;
  readonly allLocales: readonly string[] | undefined;
  readonly translationConfig: TranslationConfig | undefined;
}

interface ApplyAutoTranslationsResult {
  readonly didTranslate: boolean;
  readonly skippedLocales: string[];
}

/**
 * Translates the updated base value to all non-base locales and records the
 * results in `folder` (not saved).
 *
 * Returns `{ didTranslate: false, skippedLocales: [] }` when auto-translation is
 * not configured, disabled, or when no target locales are available.
 */
async function applyAutoTranslationsAfterBaseValueChange(
  params: ApplyAutoTranslationsParams,
): Promise<ApplyAutoTranslationsResult> {
  const { folder, key, baseValue, baseLocale, allLocales, translationConfig } = params;

  if (!translationConfig?.enabled || !allLocales || allLocales.length === 0) {
    return { didTranslate: false, skippedLocales: [] };
  }

  const targetLocales = allLocales.filter((locale) => locale !== baseLocale);
  if (targetLocales.length === 0) {
    return { didTranslate: false, skippedLocales: [] };
  }

  const autoTranslateResult = await autoTranslateResource({
    baseValue,
    baseLocale,
    targetLocales,
    translationConfig,
  });

  if (autoTranslateResult.translations.length === 0) {
    return { didTranslate: false, skippedLocales: autoTranslateResult.skippedLocales };
  }

  for (const { locale, value } of autoTranslateResult.translations) {
    folder.setTranslation(key, locale, translocoToICU(value), 'translated');
  }

  return { didTranslate: true, skippedLocales: autoTranslateResult.skippedLocales };
}
