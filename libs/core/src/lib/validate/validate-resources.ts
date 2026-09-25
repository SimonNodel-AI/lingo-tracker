import type { TranslationStatus } from '@simoncodes-ca/domain';
import type { Collection } from '../config/open-collection';
import { type LoadedResource, loadResources } from '../export/export-common';
import type {
  IcuValidationResult,
  PlaceholderValidationResult,
  ResourceValidationDetail,
  ResourceValidationResult,
  StatusCounts,
  UnreadableFolderDetail,
  ValidationOptions,
} from './types';
import { validateIcuValues } from './validate-icu';
import { validatePlaceholders } from './validate-placeholders';
import { validateTerminology } from './validate-terminology';

/**
 * Validates translation resources collection by collection.
 *
 * Each collection is read through the Collection Reader and validated with its own
 * base locale and target locales (minus `options.skippedLocales`). A key present in
 * two collections is validated in both.
 *
 * Status validation, per resource and target locale:
 * - 'new' status → failure (resource not yet translated)
 * - 'stale' status → failure (translation out of sync with source)
 * - 'translated' status → failure (default) or warning (if allowTranslated=true)
 * - 'verified' status → success (translation reviewed and approved)
 * - Missing status/metadata → treated as 'new' (failure)
 *
 * A folder the reader could not read (malformed JSON, or an entry that is not an
 * object) is listed in `unreadableFolders` and fails validation: its resources were
 * not checked.
 *
 * When `options.icu` is provided, a second pass compiles every stored value
 * under the locale it is stored under, base values under the collection's base
 * locale. Any value that fails to compile is a failure regardless of its status —
 * plural categories are per-language, so a value approved by a reviewer can still
 * throw for its own locale.
 *
 * When `options.placeholders` is set, a third pass checks that every
 * translation interpolates the same arguments as its base value. A renamed
 * argument renders as empty text rather than raising, so neither of the other
 * two passes can see it.
 *
 * When `options.terminology` is provided, a fourth pass scans each collection's
 * base-locale values for discouraged terms. Its findings are advisory and never
 * fail validation; only a rule file that could not be loaded does.
 *
 * Every resource is validated before returning; the function never stops at the first failure.
 *
 * @param collections - The opened collections to validate (see `openCollection`)
 * @param options - Validation configuration options
 * @returns Comprehensive validation result with counts, failures, warnings, and successes
 *
 * @example
 * ```typescript
 * const collections = Object.keys(config.collections).map((name) => openCollection(config, name, { cwd }));
 * const result = validateResources(collections, { allowTranslated: false, skippedLocales: ['de'] });
 *
 * if (!result.passed) {
 *   console.error(`Validation failed: ${result.failures.length} failures`);
 * }
 * ```
 */
export function validateResources(
  collections: readonly Collection[],
  options: ValidationOptions,
): ResourceValidationResult {
  const skipped = new Set(options.skippedLocales ?? []);

  // Initialize result accumulators
  const failures: ResourceValidationDetail[] = [];
  const warnings: ResourceValidationDetail[] = [];
  const successes: ResourceValidationDetail[] = [];
  const unreadableFolders: UnreadableFolderDetail[] = [];
  const icuResults: IcuValidationResult[] = [];
  const placeholderResults: PlaceholderValidationResult[] = [];
  const allResources: LoadedResource[] = [];
  const validatedLocales = new Set<string>();

  const statusCounts: StatusCounts = {
    new: 0,
    translated: 0,
    stale: 0,
    verified: 0,
  };

  let totalResourcesValidated = 0;

  for (const collection of collections) {
    const { resources, problems } = loadResources(collection);
    const targetLocales = collection.targetLocales.filter((locale) => !skipped.has(locale));
    allResources.push(...resources);
    for (const locale of targetLocales) validatedLocales.add(locale);
    unreadableFolders.push(
      ...problems.map(({ folderPath, message }) => ({ collection: collection.name, folderPath, message })),
    );

    // Validate each resource for each of the collection's target locales
    for (const resource of resources) {
      for (const locale of targetLocales) {
        totalResourcesValidated++;

        const validationDetail = validateSingleResourceInLocale(resource, locale);
        statusCounts[validationDetail.status]++;
        categorizeValidationDetail(validationDetail, options, failures, warnings, successes);
      }
    }

    // ICU compilation is a separate question from translation status: it asks
    // whether the stored value renders at all, not whether anyone approved it.
    if (options.icu) {
      icuResults.push(
        validateIcuValues(resources, targetLocales, { ...options.icu, baseLocale: collection.baseLocale }),
      );
    }

    // And placeholder agreement is a third: a value can be approved and compile
    // cleanly while interpolating an argument the caller never passes.
    if (options.placeholders) {
      placeholderResults.push(validatePlaceholders(resources, targetLocales, collection.baseLocale));
    }
  }

  const icu = options.icu ? mergeIcuResults(icuResults) : undefined;
  const placeholders = options.placeholders ? mergePlaceholderResults(placeholderResults) : undefined;

  // Terminology is advisory: findings suggest wording and never block. A rule
  // file that failed to load does block, because then nothing was checked.
  const terminology = options.terminology
    ? validateTerminology(allResources, {
        ...options.terminology,
        baseLocaleByCollection: Object.fromEntries(collections.map(({ name, baseLocale }) => [name, baseLocale])),
      })
    : undefined;

  const passed =
    failures.length === 0 &&
    unreadableFolders.length === 0 &&
    (icu?.failures.length ?? 0) === 0 &&
    (placeholders?.failures.length ?? 0) === 0 &&
    terminology?.configError === undefined;

  return {
    icu,
    placeholders,
    terminology,
    unreadableFolders,
    totalResourcesValidated,
    totalUniqueKeys: allResources.length,
    localesValidated: validatedLocales.size,
    collectionsValidated: collections.length,
    statusCounts,
    failures,
    warnings,
    successes,
    passed,
  };
}

function mergeIcuResults(results: readonly IcuValidationResult[]): IcuValidationResult {
  return {
    failures: results.flatMap((result) => result.failures),
    warnings: results.flatMap((result) => result.warnings),
    unsupportedLocales: [...new Set(results.flatMap((result) => result.unsupportedLocales))],
    valuesChecked: results.reduce((total, result) => total + result.valuesChecked, 0),
  };
}

function mergePlaceholderResults(results: readonly PlaceholderValidationResult[]): PlaceholderValidationResult {
  return {
    failures: results.flatMap((result) => result.failures),
    valuesChecked: results.reduce((total, result) => total + result.valuesChecked, 0),
  };
}

/**
 * Validates a single resource for a specific locale.
 *
 * Determines the translation status for the resource in the target locale.
 * If no status is found in metadata, treats the resource as 'new'.
 *
 * @param resource - The loaded resource to validate
 * @param locale - The target locale to check
 * @returns Validation detail with key, locale, collection, and status
 */
function validateSingleResourceInLocale(resource: LoadedResource, locale: string): ResourceValidationDetail {
  // Get status for this locale, defaulting to 'new' if not found
  const status: TranslationStatus = resource.status[locale] ?? 'new';

  return {
    key: resource.fullKey,
    locale,
    collection: resource.collection,
    status,
  };
}

/**
 * Categorizes a validation detail into failures, warnings, or successes.
 *
 * Categorization rules:
 * - 'new' → failure (not translated)
 * - 'stale' → failure (out of sync)
 * - 'translated' → failure (if allowTranslated=false) or warning (if allowTranslated=true)
 * - 'verified' → success
 *
 * @param detail - The validation detail to categorize
 * @param options - Validation options (controls translated handling)
 * @param failures - Array to append failures to
 * @param warnings - Array to append warnings to
 * @param successes - Array to append successes to
 */
function categorizeValidationDetail(
  detail: ResourceValidationDetail,
  options: ValidationOptions,
  failures: ResourceValidationDetail[],
  warnings: ResourceValidationDetail[],
  successes: ResourceValidationDetail[],
): void {
  switch (detail.status) {
    case 'new':
    case 'stale':
      failures.push(detail);
      break;

    case 'translated':
      if (options.allowTranslated) {
        warnings.push(detail);
      } else {
        failures.push(detail);
      }
      break;

    case 'verified':
      successes.push(detail);
      break;
  }
}
