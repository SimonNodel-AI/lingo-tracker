import { DEFAULT_IMPORT_STRATEGY, importStrategyPolicy } from '@simoncodes-ca/domain';

/** Values applied after import and export prompts; help uses the same values. */
export const EXPORT_DEFAULTS = {
  status: 'new,stale',
  basePropertyName: 'baseValue',
  structure: 'hierarchical' as const,
  rich: false,
  includeBase: false,
  includeStatus: false,
  includeComment: false,
  includeTags: false,
};

export const IMPORT_DEFAULTS = {
  strategy: DEFAULT_IMPORT_STRATEGY,
  preserveStatus: false,
  validateBase: true,
};

/**
 * Prompt dependencies prefer supplied flags, including false and empty strings; undefined leaves answers intact.
 * The runner instead merges submitted answers over flags.
 */
export function mergeRunOptions<Options extends object>(flags: Options, answers: Options): Options {
  const supplied = Object.fromEntries(Object.entries(flags).filter(([, value]) => value !== undefined));
  return { ...answers, ...supplied };
}

/** Help and migration prompt initials read the same policy objects. */
export const IMPORT_STRATEGY_DEFAULTS = importStrategyPolicy(IMPORT_DEFAULTS.strategy).defaults;
export const IMPORT_MIGRATION_DEFAULTS = importStrategyPolicy('migration').defaults;
