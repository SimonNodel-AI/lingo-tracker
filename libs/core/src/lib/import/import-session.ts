import type { Collection } from '../config/open-collection';
import { getStrategyDefaults } from './import-common';
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
 * `updateTags`; explicit options win) and refuses a base-locale import unless the strategy is
 * `migration`.
 *
 * @throws {Error} The target locale is the collection's base locale and the strategy is not `migration`.
 */
export function openImportSession(collection: Collection, options: ImportRunOptions): ImportSession {
  const strategy = options.strategy ?? 'translation-service';
  const defaults = getStrategyDefaults(strategy);
  const isBaseLocaleImport = options.locale === collection.baseLocale;

  if (isBaseLocaleImport && strategy !== 'migration') {
    throw new Error(
      `Cannot import into base locale "${collection.baseLocale}" with strategy "${strategy}". ` +
        `Only "migration" strategy supports base locale imports.`,
    );
  }

  return {
    collection,
    options: {
      ...options,
      strategy,
      createMissing: options.createMissing ?? defaults.createMissing,
      updateComments: options.updateComments ?? defaults.updateComments,
      updateTags: options.updateTags ?? defaults.updateTags,
    },
    isBaseLocaleImport,
    changes: [],
    warnings: [],
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
