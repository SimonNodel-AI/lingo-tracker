import { existsSync } from 'node:fs';
import type { Collection } from '../config/open-collection';
import { filterResources, loadResources } from './export-common';
import { generateExportSummary } from './export-summary';
import { exportToJson } from './export-to-json';
import { exportToXliff } from './export-to-xliff';
import type { ExportOptions, ExportResult } from './types';

/** Options for {@link runExport}. `locales` narrows the export; unknown and base locales are ignored. */
export interface ExportRunOptions extends Omit<ExportOptions, 'collections'> {
  /** Protected terms, read by the caller: the global list, and each collection's own list by collection name. */
  protectedTerms?: {
    global?: string[];
    collections?: Readonly<Record<string, string[]>>;
  };
}

export interface ExportLocaleResult {
  locale: string;
  /** `skipped`: no resource matched the filters. `failed`: the exporter reported errors, or threw. */
  outcome: 'exported' | 'skipped' | 'failed';
  resourcesExported: number;
  filesCreated: string[];
  /** The exception message, when the exporter threw. */
  error?: string;
}

/** The totals over every locale, the outcome per locale, and the Markdown summary of the run. */
export interface ExportRunResult extends ExportResult {
  /** One entry per target locale, in export order. */
  localeResults: ExportLocaleResult[];
  summary: string;
}

/**
 * The locales an export writes: every target locale of the collections, in order of first
 * appearance, narrowed to `requested` when given. A collection's base locale is never a target.
 */
export function exportTargetLocales(collections: readonly Collection[], requested?: readonly string[]): string[] {
  const locales = new Set(collections.flatMap((collection) => collection.targetLocales));
  return [...locales].filter((locale) => !requested || requested.includes(locale));
}

/**
 * Exports the collections' resources, one file per target locale (see {@link exportTargetLocales}).
 *
 * For each locale, the resources of the collections that have that locale as a target are
 * filtered by status and tags (and annotated with the protected terms their source contains),
 * then written by the JSON or XLIFF exporter. A locale with no matching resource is skipped;
 * a locale whose exporter throws is reported and the run continues with the next locale.
 *
 * @throws {Error} The collections do not share one base locale (an export file has one source language).
 */
export async function runExport(
  collections: readonly Collection[],
  options: ExportRunOptions,
): Promise<ExportRunResult> {
  const { protectedTerms, ...exportOptions } = options;
  const baseLocale = sharedBaseLocale(collections);
  const targetLocales = exportTargetLocales(collections, options.locales);
  const runOptions: ExportOptions = {
    ...exportOptions,
    collections: collections.map((collection) => collection.name),
    locales: targetLocales,
  };

  const totals: ExportResult = {
    format: options.format,
    filesCreated: [],
    resourcesExported: 0,
    warnings: [],
    errors: [],
    collections: runOptions.collections ?? [],
    locales: targetLocales,
    outputDirectory: options.outputDirectory,
    omittedResources: [],
    malformedFiles: [],
    hierarchicalConflicts: [],
  };
  const localeResults: ExportLocaleResult[] = [];

  if (targetLocales.length > 0) {
    // Read per collection so a key shared by two collections survives in each one's own locales.
    const resourcesByCollection = new Map(
      collections.map((collection) => {
        // The reader reads a missing folder as an empty collection; say so, since a mistyped
        // translationsFolder would otherwise export nothing without a word.
        if (!existsSync(collection.translationsFolder)) {
          totals.warnings.push(
            `Collection '${collection.name}': translations folder not found: ${collection.translationsFolder}`,
          );
        }
        const { resources, problems } = loadResources(collection, protectedTerms?.collections?.[collection.name]);
        // A folder the reader could not read is left out of every locale file; the summary lists it.
        totals.malformedFiles.push(...problems.map((problem) => problem.message));
        return [collection.name, resources];
      }),
    );

    for (const locale of targetLocales) {
      // Among the collections that target this locale, the last one wins a shared key.
      const eligible = new Map(
        collections
          .filter((collection) => collection.targetLocales.includes(locale))
          .flatMap((collection) => resourcesByCollection.get(collection.name) ?? [])
          .map((resource) => [resource.fullKey, resource]),
      );
      const filtered = filterResources([...eligible.values()], locale, options.status, options.tags, {
        globalProtectedTerms: protectedTerms?.global,
        augmentProtectedTerms: options.augmentProtectedTerms !== false,
        baseLocale,
      });

      if (filtered.length === 0) {
        options.onProgress?.(`Skipping ${locale}: No matching resources.`);
        localeResults.push({ locale, outcome: 'skipped', resourcesExported: 0, filesCreated: [] });
        continue;
      }

      const localeOptions: ExportOptions = { ...runOptions, locales: [locale] };
      try {
        const result =
          options.format === 'xliff'
            ? await exportToXliff(filtered, localeOptions, baseLocale)
            : exportToJson(filtered, localeOptions, baseLocale);

        totals.resourcesExported += result.resourcesExported;
        totals.filesCreated.push(...result.filesCreated);
        totals.warnings.push(...result.warnings);
        totals.errors.push(...result.errors);
        totals.hierarchicalConflicts.push(...result.hierarchicalConflicts);
        totals.omittedResources.push(...result.omittedResources);
        totals.malformedFiles.push(...result.malformedFiles);
        localeResults.push({
          locale,
          outcome: result.filesCreated.length > 0 ? 'exported' : 'failed',
          resourcesExported: result.resourcesExported,
          filesCreated: result.filesCreated,
        });
      } catch (error) {
        const message = (error as Error).message;
        totals.errors.push(`Export for locale ${locale} failed: ${message}`);
        localeResults.push({ locale, outcome: 'failed', resourcesExported: 0, filesCreated: [], error: message });
      }
    }
  }

  return { ...totals, localeResults, summary: generateExportSummary(totals, runOptions) };
}

function sharedBaseLocale(collections: readonly Collection[]): string {
  const baseLocales = new Set(collections.map((collection) => collection.baseLocale));
  const [baseLocale] = baseLocales;
  if (baseLocales.size !== 1 || baseLocale === undefined) {
    const listed = collections.map((collection) => `${collection.name}: ${collection.baseLocale}`).join(', ');
    throw new Error(
      `Cannot export collections with different base locales together (${listed}). Export them separately.`,
    );
  }
  return baseLocale;
}
