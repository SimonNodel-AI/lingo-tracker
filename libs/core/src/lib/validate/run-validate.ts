import type { Collection } from '../config/open-collection';
import { describeTermFileProblem, readProjectTerms } from '../config/project-terms';
import type { RunOutcome } from '../run-outcome';
import { generateValidationSummary } from './generate-validation-summary';
import type { ResourceValidationResult, ValidationOptions } from './types';
import { validateResources } from './validate-resources';

/** User choices for one validation of the opened collections. */
export interface ValidateRunOptions {
  readonly allowTranslated?: boolean;
  readonly skipLocales?: readonly string[];
  readonly skipIcu?: boolean;
  readonly skipPlaceholders?: boolean;
  readonly requirePortablePlurals?: boolean;
}

/**
 * The printable outcome of one validation run. An empty scope is an in-band failure with
 * detail lines; a completed run carries the full validation result and its summary.
 * Warnings are separate so adapters can report them before either outcome.
 */
export type ValidateRunResult =
  | {
      readonly status: 'failed';
      readonly outcome: RunOutcome;
      readonly error: string;
      readonly details: readonly string[];
      readonly warnings: readonly string[];
    }
  | {
      readonly status: 'complete';
      readonly outcome: RunOutcome;
      readonly validation: ResourceValidationResult;
      readonly summary: string;
      readonly warnings: readonly string[];
    };

/**
 * Validates the opened collections for CI and returns the result ready for an adapter to print.
 *
 * The run resolves target and skipped locales, reads each collection's Project Terms, assembles
 * the status, ICU, placeholder, and terminology checks, then produces the summary. A collection
 * set with nothing to validate returns an in-band failure. Term-file and unknown-locale warnings
 * return alongside the outcome; no warning is printed by core.
 */
export function runValidate(collections: readonly Collection[], options: ValidateRunOptions = {}): ValidateRunResult {
  if (collections.length === 0) {
    return {
      status: 'failed',
      outcome: 'failed',
      error: 'No collections found in configuration.',
      details: [],
      warnings: [],
    };
  }

  // Each collection is validated against its own target locales: its locales without its base locale.
  const targetLocales = [...new Set(collections.flatMap((collection) => collection.targetLocales))];
  if (targetLocales.length === 0) {
    return {
      status: 'failed',
      outcome: 'failed',
      error: 'No target locales found in configuration.',
      details: ["Target locales are each collection's locales except its base locale."],
      warnings: [],
    };
  }

  const baseLocales = new Set(collections.map((collection) => collection.baseLocale));
  const effectiveSkipped: string[] = [];
  const warnings: string[] = [];
  for (const locale of options.skipLocales ?? []) {
    if (targetLocales.includes(locale)) {
      effectiveSkipped.push(locale);
      continue;
    }
    if (baseLocales.has(locale)) {
      // A base locale is never a target here, so there is nothing to skip: silently ignore it.
      continue;
    }
    warnings.push(`Skipping unknown locale '${locale}' — not in configured locales`);
  }

  if (targetLocales.every((locale) => effectiveSkipped.includes(locale))) {
    return {
      status: 'failed',
      outcome: 'failed',
      error: 'All target locales were skipped; nothing to validate.',
      details: [],
      warnings,
    };
  }

  // Read every collection's Project Terms. Collections share the global files, so report each
  // term-file problem once. Validate checks translations, not protected terms: a missing or
  // broken protected-terms file only warns, as does a named rule file that is missing.
  const projectTerms = collections.map((collection) => readProjectTerms(collection));
  const problems = projectTerms.flatMap((terms) => terms.problems);
  warnings.push(
    ...new Set(
      problems
        .filter((problem) => problem.file === 'protected-terms' || problem.severity === 'warning')
        .map(describeTermFileProblem),
    ),
  );
  // A broken rule file becomes terminology.loadError and fails validation: otherwise a typo
  // would silently switch the check off in CI.
  const ruleFileError = problems.find(
    (problem) => problem.file === 'preferred-terminology' && problem.severity === 'error',
  )?.message;
  // Preferred terminology is one file for the project. The first collection with rules wins;
  // later rule lists are not checked for agreement. An empty first read cannot hide later rules.
  const rules = [...(projectTerms.find((terms) => terms.preferredTerminology.length > 0)?.preferredTerminology ?? [])];
  const compileValues = !options.skipIcu;
  const requirePortablePlurals = options.requirePortablePlurals ?? false;
  const validationOptions: ValidationOptions = {
    allowTranslated: options.allowTranslated ?? false,
    skippedLocales: effectiveSkipped,
    // Portability is a static parse, so an explicit request runs even alongside skipIcu.
    // Base values are checked alongside targets because they are copied into every translation slot.
    icu: compileValues || requirePortablePlurals ? { compileValues, requirePortablePlurals } : undefined,
    // A renamed placeholder renders empty; neither ICU compilation nor status catches it.
    placeholders: !options.skipPlaceholders,
    // Without rules or a load error, omit the check and its summary output entirely.
    terminology: rules.length > 0 || ruleFileError !== undefined ? { rules, loadError: ruleFileError } : undefined,
  };
  const validation = validateResources(collections, validationOptions);
  return {
    status: 'complete',
    outcome: validation.passed ? 'succeeded' : 'failed',
    validation,
    summary: generateValidationSummary(validation, validationOptions),
    warnings,
  };
}
