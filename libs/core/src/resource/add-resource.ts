import { resolve } from 'node:path';
import type { TranslationStatus } from '@simoncodes-ca/domain';
import { validateAndResolvePaths } from '../lib/resource/resource-file-paths';
import { ensureDirectoryExists } from '../lib/file-io/directory-operations';
import { openResourceFolder } from '../lib/resource/resource-folder';
import { type ResourceMutation, upsertMutation } from '../lib/resource/resource-mutation';
import type { TranslationConfig } from '../config/translation-config';
import { autoTranslateResource } from '../lib/translation/auto-translate-resources';
import { translocoToICU, normalizeTags, isUntranslatedCopy } from '@simoncodes-ca/domain';

export interface AddResourceOptions {
  cwd?: string;
  translationConfig?: TranslationConfig;
}

export interface AddResourceParams {
  /** Dot-delimited key, e.g., "apps.common.buttons.ok" */
  key: string;
  /** Base locale value (the source text) */
  baseValue: string;
  /** Optional context for translators */
  comment?: string;
  /** Optional tags (will be stored as array) */
  tags?: string[];
  /** Optional target folder to override part of the path */
  targetFolder?: string;
  /** Base locale (defaults to "en") */
  baseLocale?: string;
  /** Localized translations with locale, value, and status */
  translations?: Array<{
    locale: string;
    value: string;
    status: TranslationStatus;
  }>;
  /**
   * All configured locales. Required when using auto-translation so the
   * orchestrator knows which target locales to translate into.
   */
  allLocales?: readonly string[];
}

/**
 * Adds or updates a resource entry in the translations folder.
 * Creates nested folders and files as needed at each level.
 *
 * When `options.translationConfig` is provided and enabled, and no explicit
 * translations are supplied, the base value is automatically translated to all
 * non-base locales using the configured provider.
 *
 * @param translationsFolder - Root translations folder path
 * @param params - Resource creation parameters
 * @param options - Additional options (e.g., cwd, translationConfig)
 * @returns Object with the resolved key, status, actual translations written to disk,
 *          any locales skipped due to ICU format (only present when auto-translation ran),
 *          and the mutation that describes the stored entry
 */
export async function addResource(
  translationsFolder: string,
  params: AddResourceParams,
  options: AddResourceOptions = {},
): Promise<{
  resolvedKey: string;
  created: boolean;
  translations: Array<{ locale: string; value: string; status: TranslationStatus }>;
  skippedLocales?: string[];
  mutations: ResourceMutation[];
}> {
  const { cwd = process.cwd(), translationConfig } = options;
  const baseLocale = params.baseLocale || 'en';

  // Validate and resolve paths
  const paths = validateAndResolvePaths({
    key: params.key,
    translationsFolder,
    targetFolder: params.targetFolder,
    cwd,
  });

  // Ensure directory exists
  ensureDirectoryExists({
    directoryPath: paths.folderPath,
    errorContext: 'Creating resource folder',
  });

  const folder = openResourceFolder(paths.folderPath, { baseLocale });
  const isNewEntry = !folder.has(paths.entryKey);

  // Normalize values to ICU format before storing
  const normalizedBaseValue = translocoToICU(params.baseValue);
  const normalizedTags = normalizeTags(params.tags ?? []);

  // Resolve translations: prefer explicit translations, fall back to auto-translation, then nothing.
  // Pass the ICU-normalized base value so the translation provider receives the stored form,
  // not the raw Transloco-style input from the caller.
  const resolveResult = await resolveTranslations({
    params,
    normalizedBaseValue,
    baseLocale,
    translationConfig,
  });

  const normalizedTranslations = resolveResult?.translations.map(({ locale, value, status }) => ({
    locale,
    value: translocoToICU(value),
    status,
  }));

  // add-resource replaces the whole entry (previous translations and metadata are dropped).
  // setEntry clears it in place so an existing key keeps its position in the file.
  folder.setEntry(paths.entryKey, { source: normalizedBaseValue }, {});
  folder.setBase(paths.entryKey, normalizedBaseValue);
  folder.setDetails(paths.entryKey, { comment: params.comment || undefined, tags: normalizedTags });

  // Skip the base locale — its value is the entry's 'source'.
  for (const { locale, value, status } of normalizedTranslations ?? []) {
    if (locale === baseLocale) continue;
    // Staleness rule: an untranslated copy of the base is 'new', whatever status was requested.
    folder.setTranslation(
      paths.entryKey,
      locale,
      value,
      isUntranslatedCopy(value, normalizedBaseValue) ? 'new' : status,
    );
  }

  folder.save();

  return {
    resolvedKey: paths.resolvedKey,
    created: isNewEntry,
    translations: normalizedTranslations ?? [],
    ...(resolveResult?.skippedLocales !== undefined && { skippedLocales: resolveResult.skippedLocales }),
    mutations: [upsertMutation(resolve(cwd, translationsFolder), paths.resolvedKey, folder.treeEntry(paths.entryKey))],
  };
}

interface ResolveTranslationsParams {
  readonly params: AddResourceParams;
  /** ICU-normalized form of the base value — this is what gets stored and what the translation provider should receive. */
  readonly normalizedBaseValue: string;
  readonly baseLocale: string;
  readonly translationConfig: TranslationConfig | undefined;
}

interface ResolveTranslationsResult {
  readonly translations: Array<{ locale: string; value: string; status: TranslationStatus }>;
  readonly skippedLocales: string[];
}

/**
 * Determines which translations to use for the resource entry.
 *
 * Priority:
 * 1. Explicit `params.translations` — used as-is when provided (no `skippedLocales`).
 * 2. Auto-translation — triggered when `translationConfig` is enabled and
 *    `params.allLocales` is set (caller must supply target locale list).
 * 3. No translations — returns `undefined` so the entry is stored without them.
 */
async function resolveTranslations(
  resolveParams: ResolveTranslationsParams,
): Promise<ResolveTranslationsResult | undefined> {
  const { params, normalizedBaseValue, baseLocale, translationConfig } = resolveParams;

  if (params.translations && params.translations.length > 0) {
    return { translations: params.translations, skippedLocales: [] };
  }

  const shouldAutoTranslate = translationConfig?.enabled && params.allLocales && params.allLocales.length > 0;
  if (!shouldAutoTranslate || !translationConfig || !params.allLocales) {
    return undefined;
  }

  const targetLocales = params.allLocales.filter((locale) => locale !== baseLocale);
  if (targetLocales.length === 0) {
    return undefined;
  }

  const autoTranslateResult = await autoTranslateResource({
    baseValue: normalizedBaseValue,
    baseLocale,
    targetLocales,
    translationConfig,
  });

  return {
    translations: autoTranslateResult.translations.map(({ locale, value, status }) => ({ locale, value, status })),
    skippedLocales: autoTranslateResult.skippedLocales,
  };
}
