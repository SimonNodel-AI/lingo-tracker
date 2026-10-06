import { flagName } from '../runner/flag-record';
import type { ImportRunOptions, ImportFormat } from '@simoncodes-ca/core';
import {
  canImportLocale,
  type ImportStrategy,
  IMPORT_STRATEGIES,
  importableLocales,
  isImportStrategy,
  DEFAULT_IMPORT_STRATEGY,
  importStrategyPolicy,
} from '@simoncodes-ca/domain';
import type prompts from 'prompts';
import type { ImportCommandOptions, ImportOptionsContext } from './import-options';
import { mergeRunOptions } from './run-option-defaults';
import { resolveOption, type OrderedCommandOptionTable } from './option-table';

type ImportAnswers = ImportCommandOptions & Readonly<Record<string, unknown>>;
export interface ImportTableContext extends ImportOptionsContext {
  readonly sourceFormat: (source: string) => ImportFormat | undefined;
}
export type ResolvedImportOptions = Required<Omit<ImportRunOptions, 'locale' | 'onProgress'>> &
  Pick<ImportRunOptions, 'onProgress'> & {
    source: string | undefined;
    format: ImportFormat | undefined;
    locale: string | undefined;
  };
type ImportOptionResults = {
  [Key in keyof Required<ImportCommandOptions>]: Pick<ResolvedImportOptions, Extract<Key, keyof ResolvedImportOptions>>;
};

const strategyDefaults = importStrategyPolicy(DEFAULT_IMPORT_STRATEGY).defaults;
const migrationDefaults = importStrategyPolicy('migration').defaults;
/** Strategy drives locale choices and migration-only prompt visibility. */
function importOptionState(
  flags: ImportCommandOptions,
  answers: ImportAnswers,
  context: Pick<ImportOptionsContext, 'configuredLocales' | 'baseLocale'>,
) {
  const values = mergeRunOptions(flags, answers);
  const strategy = resolveStrategy(values.strategy);
  return {
    strategy,
    locales: importableLocales(context.configuredLocales, context.baseLocale, strategy),
    migration: strategy === 'migration',
  };
}

/** Validate Commander flags and prompt answers before reading the strategy policy. */
export function resolveStrategy(value: unknown): ImportStrategy {
  if (value === undefined) value = IMPORT_OPTION_TABLE.strategy.defaultValue;
  if (isImportStrategy(value)) return value;
  throw new Error(
    `Invalid ${flagName(IMPORT_OPTION_TABLE.strategy)} "${String(value)}". Valid strategies: ${IMPORT_STRATEGIES.join(', ')}.`,
  );
}

export const IMPORT_OPTION_TABLE: OrderedCommandOptionTable<
  ImportCommandOptions,
  ImportCommandOptions,
  ImportTableContext,
  ImportOptionResults
> = {
  format: {
    flags: '-f, --format <format>',
    description: 'Import format (xliff | json) - auto-detected from file extension if omitted',
    defaultValue: undefined,
    promptOrder: 1,
    prompt: (options, context) => {
      const questions: prompts.PromptObject[] = [];
      if (!options.format) {
        questions.push({
          // Keep format unset for core when the source extension is sufficient.
          type: (_prev: unknown, values: Record<string, unknown>) => {
            return context.sourceFormat(mergeRunOptions<ImportCommandOptions>(options, values).source ?? '')
              ? null
              : 'select';
          },
          name: 'format',
          message: 'Select import format:',
          choices: [
            { title: 'JSON', value: 'json', description: 'JSON format (flat or hierarchical)' },
            { title: 'XLIFF 1.2', value: 'xliff', description: 'XLIFF format for professional translation services' },
          ],
        });
      }

      return questions;
    },
    resolve: (values) => ({ format: values.format }),
  },
  source: {
    flags: '-s, --source <path>',
    description: 'Path to import file (required)',
    defaultValue: undefined,
    promptOrder: 0,
    prompt: (options, context) => {
      const { sourceExists } = context;
      const questions: prompts.PromptObject[] = [];
      if (!options.source) {
        questions.push({
          type: 'text',
          name: 'source',
          message: 'Enter path to import file:',
          validate: (value: string) => {
            if (!value || value.trim() === '') {
              return 'Source file is required';
            }
            if (!sourceExists(value)) {
              return `File not found: ${value}`;
            }
            return true;
          },
        });
      }

      return questions;
    },
    resolve: (values) => ({ source: values.source }),
  },
  locale: {
    flags: '-l, --locale <locale>',
    description: 'Target locale for import (e.g., es, fr-ca)',
    defaultValue: undefined,
    promptOrder: 3,
    prompt: (options, context) => {
      const { configuredLocales, baseLocale } = context;
      const questions: prompts.PromptObject[] = [];
      const stateOf = (answers: ImportAnswers) =>
        importOptionState(options, answers, { configuredLocales, baseLocale });
      if (!options.locale) {
        questions.push({
          type: (_prev: unknown, values: ImportAnswers) => (stateOf(values).locales.length > 0 ? 'select' : null),
          name: 'locale',
          message: 'Select target locale for import:',
          choices: (_prev: unknown, values: ImportAnswers) =>
            stateOf(values).locales.map((loc) => ({
              title: loc === baseLocale ? `${loc} (base locale)` : loc,
              value: loc,
            })),
          validate: () => true,
        });
        // prompts does not pass prior answers to validate. Mutually exclusive text
        // descriptors bind an immutable policy instead of changing state in type.
        for (const strategy of IMPORT_STRATEGIES) {
          questions.push({
            type: (_prev: unknown, values: ImportAnswers) => {
              const state = stateOf(values);
              return state.strategy === strategy && state.locales.length === 0 ? 'text' : null;
            },
            name: 'locale',
            message: 'Select target locale for import:',
            choices: [],
            validate: (value: string) => {
              if (!value || value.trim() === '') return 'Locale is required';
              return (
                canImportLocale(value, baseLocale, strategy) ||
                `Cannot import into base locale "${baseLocale}" with strategy "${strategy}"`
              );
            },
          });
        }
      }

      return questions;
    },
    resolve: (values) => ({ locale: values.locale }),
  },
  collection: {
    flags: '-c, --collection <name>',
    description: 'Target collection to import into',
    defaultValue: undefined,
    resolve: () => ({}),
  },
  strategy: {
    flags: '--strategy <strategy>',
    description: 'Import strategy (translation-service | verification | migration | update)',
    defaultValue: DEFAULT_IMPORT_STRATEGY,
    defaultMode: 'help',
    promptOrder: 2,
    prompt: (options, _context, defaultValue) => {
      const questions: prompts.PromptObject[] = [];
      if (!options.strategy) {
        questions.push({
          type: 'select',
          name: 'strategy',
          message: 'Select import strategy:',
          choices: [
            {
              title: 'Translation Service',
              value: defaultValue,
              description: 'Import from professional translation services (default)',
            },
            { title: 'Verification', value: 'verification', description: 'Language expert verification workflow' },
            { title: 'Migration', value: 'migration', description: 'Migrate from another translation system' },
            { title: 'Update', value: 'update', description: 'Bulk update existing translations' },
          ],
        });
      }

      return questions;
    },
    resolve: (values) => ({ strategy: resolveStrategy(values.strategy) }),
  },
  updateComments: {
    flags: '--update-comments',
    description: `Update resource comments from import data (migration: ${migrationDefaults.updateComments})`,
    defaultValue: strategyDefaults.updateComments,
    defaultMode: 'help',
    promptOrder: 4,
    prompt: (options, context) =>
      options.updateComments !== undefined
        ? []
        : [
            {
              type: (_prev: unknown, values: ImportAnswers) =>
                importOptionState(options, values, context).migration ? 'confirm' : null,
              name: 'updateComments',
              message: 'Update comments from import data?',
              initial: migrationDefaults.updateComments,
            },
          ],
    resolve: (values) => ({ updateComments: values.updateComments }),
  },
  updateTags: {
    flags: '--update-tags',
    description: `Update resource tags from rich JSON (migration: ${migrationDefaults.updateTags})`,
    defaultValue: strategyDefaults.updateTags,
    defaultMode: 'help',
    promptOrder: 5,
    prompt: (options, context) =>
      options.updateTags !== undefined
        ? []
        : [
            {
              type: (_prev: unknown, values: ImportAnswers) =>
                importOptionState(options, values, context).migration ? 'confirm' : null,
              name: 'updateTags',
              message: 'Update tags from import data?',
              initial: migrationDefaults.updateTags,
            },
          ],
    resolve: (values) => ({ updateTags: values.updateTags }),
  },
  preserveStatus: {
    flags: '--preserve-status',
    description: 'Allow rich JSON to specify status (advanced)',
    defaultValue: false,
    defaultMode: 'help',
    resolve: (values, defaultValue) => ({ preserveStatus: values.preserveStatus ?? Boolean(defaultValue) }),
  },
  createMissing: {
    flags: '--create-missing',
    description: `Create new resources if they don't exist (migration: ${migrationDefaults.createMissing})`,
    defaultValue: strategyDefaults.createMissing,
    defaultMode: 'help',
    promptOrder: 6,
    prompt: (options, context) =>
      options.createMissing !== undefined
        ? []
        : [
            {
              type: (_prev: unknown, values: ImportAnswers) =>
                importOptionState(options, values, context).migration ? 'confirm' : null,
              name: 'createMissing',
              message: 'Create missing resources?',
              initial: migrationDefaults.createMissing,
            },
          ],
    resolve: (values) => ({ createMissing: values.createMissing }),
  },
  validateBase: {
    flags: '--no-validate-base',
    description: 'Do not warn when source base value differs from existing',
    defaultValue: true,
    defaultMode: 'help',
    positive: { flags: '--validate-base', description: 'Warn if source base value differs from existing' },
    resolve: (values, defaultValue) => ({ validateBase: values.validateBase ?? Boolean(defaultValue) }),
  },
  dryRun: {
    flags: '--dry-run',
    description: 'Show what would be imported without modifying files',
    defaultValue: false,
    defaultMode: 'commander',
    resolve: (values) => ({ dryRun: values.dryRun }),
  },
  verbose: {
    flags: '--verbose',
    description: 'Show detailed import progress',
    defaultValue: false,
    defaultMode: 'commander',
    resolve: (values) => ({ verbose: values.verbose }),
  },
};

/** Every resolved field must be present, including fields whose value is undefined. */
export function resolveImportTable(values: ImportCommandOptions, context: ImportTableContext): ResolvedImportOptions {
  return {
    ...resolveOption(IMPORT_OPTION_TABLE.source, values, context),
    ...resolveOption(IMPORT_OPTION_TABLE.format, values, context),
    ...resolveOption(IMPORT_OPTION_TABLE.locale, values, context),
    ...resolveOption(IMPORT_OPTION_TABLE.strategy, values, context),
    ...resolveOption(IMPORT_OPTION_TABLE.updateComments, values, context),
    ...resolveOption(IMPORT_OPTION_TABLE.updateTags, values, context),
    ...resolveOption(IMPORT_OPTION_TABLE.preserveStatus, values, context),
    ...resolveOption(IMPORT_OPTION_TABLE.createMissing, values, context),
    ...resolveOption(IMPORT_OPTION_TABLE.validateBase, values, context),
    ...resolveOption(IMPORT_OPTION_TABLE.dryRun, values, context),
    ...resolveOption(IMPORT_OPTION_TABLE.verbose, values, context),
  };
}
