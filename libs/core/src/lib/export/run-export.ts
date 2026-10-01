import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_CONFIG } from '../../constants';
import type { Collection } from '../config/open-collection';
import { describeTermFileProblem, readProjectTerms } from '../config/project-terms';
import { CoreOperationError } from '../errors/lingo-tracker-error';
import { filterResources, loadResources, validateBasePropertyName, validateOutputDirectory } from './export-common';
import { generateExportSummary } from './export-summary';
import { exportToJson } from './export-to-json';
import { exportToXliff } from './export-to-xliff';
import type { ExportOptions, ExportResult } from './types';

/** Options for {@link runExport}. `locales` narrows the export; unknown and base locales are ignored. */
export type ExportRunOptions = Omit<ExportOptions, 'collections' | 'outputDirectory'> & {
  /** Explicit output path, relative to cwd when needed. */
  outputDirectory?: string;
  /** Configured export folder, used when outputDirectory is absent. */
  exportFolder?: string;
  /** Project root for relative output paths. Default: process.cwd(). */
  cwd?: string;
  /** Called after preconditions pass, before any resources are read. */
  onStart?: (plan: { outputDirectory: string; locales: readonly string[] }) => void;
};

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

/** Resolves an explicit path, the configured folder, or the shared default against the project root. */
function resolveExportOutputDirectory(
  outputDirectory?: string,
  exportFolder?: string,
  cwd: string = process.cwd(),
): string {
  return resolve(cwd, outputDirectory || exportFolder || DEFAULT_CONFIG.exportFolder);
}

/**
 * Exports the collections' resources, one file per target locale (see {@link exportTargetLocales}).
 *
 * For each locale, the resources of the collections that have that locale as a target are
 * filtered by status and tags (and annotated with the protected terms their source contains,
 * from each collection's Project Terms: a broken protected-terms file is an error, so the run
 * fails, and a named file that does not exist is a warning), then written by the JSON or XLIFF
 * exporter. Warnings and errors are deduped (collections share the global terms file). A locale with no matching resource is skipped; a locale whose exporter
 * throws is reported and the run continues with the next locale.
 *
 * @throws {CoreOperationError} The base property name is invalid or the output directory cannot be used.
 * @throws {CoreOperationError} Target locales exist, but the collections do not share one base locale.
 */
export async function runExport(
  collections: readonly Collection[],
  options: ExportRunOptions,
): Promise<ExportRunResult> {
  if (options.basePropertyName !== undefined) validateBasePropertyName(options.basePropertyName);
  const outputDirectory = resolveExportOutputDirectory(options.outputDirectory, options.exportFolder, options.cwd);
  validateOutputDirectory(outputDirectory);
  const targetLocales = exportTargetLocales(collections, options.locales);
  if (targetLocales.length > 0) options.onStart?.({ outputDirectory, locales: targetLocales });
  const augmentProtectedTerms = options.augmentProtectedTerms !== false;
  const runOptions: ExportOptions = {
    ...options,
    outputDirectory,
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
    outputDirectory,
    omittedResources: [],
    malformedFiles: [],
    hierarchicalConflicts: [],
  };
  const localeResults: ExportLocaleResult[] = [];

  if (targetLocales.length > 0) {
    const baseLocale = sharedBaseLocale(collections);
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
        const { resources, problems } = loadResources(collection, protectedTermsOf(collection));
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
        augmentProtectedTerms,
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

  // Collections share the global terms file, so the same problem would otherwise repeat per collection.
  totals.warnings = [...new Set(totals.warnings)];
  totals.errors = [...new Set(totals.errors)];
  return {
    ...totals,
    localeResults,
    summary: generateExportSummary(totals, runOptions),
  };

  /**
   * The collection's protected terms for the do-not-translate notes. A broken terms file is an
   * error (the run fails: its notes would silently be missing); a named file that does not exist
   * is a warning.
   */
  function protectedTermsOf(collection: Collection): string[] | undefined {
    if (!augmentProtectedTerms) return undefined;
    const terms = readProjectTerms(collection);
    for (const problem of terms.problems) {
      if (problem.file === 'protected-terms') {
        (problem.severity === 'error' ? totals.errors : totals.warnings).push(describeTermFileProblem(problem));
      }
    }
    return [...terms.protectedTerms];
  }
}

function sharedBaseLocale(collections: readonly Collection[]): string {
  const baseLocales = new Set(collections.map((collection) => collection.baseLocale));
  const [baseLocale] = baseLocales;
  if (baseLocales.size !== 1 || baseLocale === undefined) {
    const listed = collections.map((collection) => `${collection.name}: ${collection.baseLocale}`).join(', ');
    throw new CoreOperationError(
      `Cannot export collections with different base locales together (${listed}). Export them separately.`,
    );
  }
  return baseLocale;
}
