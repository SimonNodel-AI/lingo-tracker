import type { Collection } from '../config/open-collection';
import { canImportLocale, DEFAULT_IMPORT_STRATEGY, importStrategyPolicy } from '@simoncodes-ca/domain';
import { InvalidImportLocaleError } from '../errors';
import {
  describeTermFileProblem,
  type ProjectTerms,
  readProjectTerms,
  requireProtectedTerms,
} from '../config/project-terms';
import { calculateImportStatistics, calculateStatusTransitions } from './import-statistics';
import type {
  ICUAutoFix,
  ICUAutoFixError,
  ImportChange,
  ImportResult,
  ImportRunOptions,
  ImportStrategy,
} from './types';

/** Import options with the strategy and its defaults filled in. */
export type ResolvedImportOptions = ImportRunOptions & {
  readonly strategy: ImportStrategy;
  readonly createMissing: boolean;
  readonly updateComments: boolean;
  readonly updateTags: boolean;
};

/**
 * The state of one import run. Every step of {@link importResources} reads the settings from
 * here and appends its findings here, so no step passes accumulators to the next.
 */
export interface ImportSession {
  readonly collection: Collection;
  readonly options: ResolvedImportOptions;
  /** The collection's Project Terms, read once for the run. */
  readonly terms: ProjectTerms;
  /** The import writes base values (`source`), not translations. Only the `migration` strategy allows it. */
  readonly isBaseLocaleImport: boolean;
  readonly changes: ImportChange[];
  readonly warnings: string[];
  readonly errors: string[];
  readonly filesModified: Set<string>;
  readonly icuAutoFixes: ICUAutoFix[];
  readonly icuAutoFixErrors: ICUAutoFixError[];
}

/**
 * Starts an import run: applies the strategy defaults (`createMissing`, `updateComments`,
 * `updateTags`; explicit options win), refuses a base-locale import unless the strategy is
 * `migration`, and reads the collection's Project Terms. A protected-terms file that cannot be
 * used stops the run before anything is written; a preferred-terminology problem only limits the
 * advisory check, so it opens the run's warnings (on a base-locale import, the only kind that
 * checks), as does a named protected-terms file that does not exist (on a target-locale import).
 *
 * @throws {InvalidImportLocaleError} The target locale is the collection's base locale and the strategy is not `migration`.
 * @throws {ProtectedTermsFileError} A protected-terms file exists but is not a JSON array of strings.
 */
export function openImportSession(collection: Collection, options: ImportRunOptions): ImportSession {
  const strategy = options.strategy ?? DEFAULT_IMPORT_STRATEGY;
  const defaults = importStrategyPolicy(strategy).defaults;
  const isBaseLocaleImport = options.locale === collection.baseLocale;

  if (!canImportLocale(options.locale, collection.baseLocale, strategy)) {
    throw new InvalidImportLocaleError(collection.baseLocale, strategy);
  }

  const terms = readProjectTerms(collection);
  requireProtectedTerms(terms);
  const relevant = isBaseLocaleImport ? 'preferred-terminology' : 'protected-terms';
  const warnings = terms.problems.filter((problem) => problem.file === relevant).map(describeTermFileProblem);

  return {
    collection,
    terms,
    options: {
      ...options,
      strategy,
      createMissing: options.createMissing ?? defaults.createMissing,
      updateComments: options.updateComments ?? defaults.updateComments,
      updateTags: options.updateTags ?? defaults.updateTags,
    },
    isBaseLocaleImport,
    changes: [],
    warnings,
    errors: [],
    filesModified: new Set(),
    icuAutoFixes: [],
    icuAutoFixErrors: [],
  };
}

/** The result of a finished import run: counts and status transitions derived from its changes. */
export function sessionResult(session: ImportSession): ImportResult {
  const statistics = calculateImportStatistics(session.changes);

  return {
    strategy: session.options.strategy,
    locale: session.options.locale,
    collection: session.collection.name,
    resourcesImported: statistics.resourcesUpdated,
    ...statistics,
    changes: session.changes,
    statusTransitions: calculateStatusTransitions(session.changes),
    filesModified: Array.from(session.filesModified),
    warnings: session.warnings,
    errors: session.errors,
    icuAutoFixes: session.icuAutoFixes,
    icuAutoFixErrors: session.icuAutoFixErrors,
    dryRun: session.options.dryRun ?? false,
  };
}
