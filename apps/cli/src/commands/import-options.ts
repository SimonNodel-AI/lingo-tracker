import { detectImportFormat, type ImportFormat, type ImportRunOptions } from '@simoncodes-ca/core';
import {
  canImportLocale,
  type ImportStrategy,
  IMPORT_STRATEGIES,
  importableLocales,
  isImportStrategy,
} from '@simoncodes-ca/domain';
import type prompts from 'prompts';
import { IMPORT_DEFAULTS, IMPORT_MIGRATION_DEFAULTS, mergeRunOptions } from './run-option-defaults';

export interface ImportCommandOptions {
  format?: ImportFormat;
  source?: string;
  locale?: string;
  collection?: string;
  strategy?: ImportStrategy;
  updateComments?: boolean;
  updateTags?: boolean;
  preserveStatus?: boolean;
  createMissing?: boolean;
  validateBase?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

export interface ImportOptionsContext {
  readonly configuredLocales: readonly string[];
  readonly baseLocale: string;
  /** The command supplies file existence; resolution itself does no I/O. */
  readonly sourceExists: (source: string) => boolean;
}

type ImportAnswers = ImportCommandOptions & Readonly<Record<string, unknown>>;

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

/** Detection is pure; failure means an explicit format question is needed. */
function sourceFormat(source: string): ImportFormat | undefined {
  try {
    return detectImportFormat(source);
  } catch {
    return undefined;
  }
}

/** Leave strategy-dependent switches unset so core applies its policy defaults. */
export function resolveImportOptions(values: ImportCommandOptions) {
  const options: Omit<ImportRunOptions, 'locale'> & { source?: string; format?: ImportFormat; locale?: string } = {
    source: values.source,
    format: values.format,
    locale: values.locale,
    strategy: resolveStrategy(values.strategy),
    updateComments: values.updateComments,
    updateTags: values.updateTags,
    preserveStatus: values.preserveStatus ?? IMPORT_DEFAULTS.preserveStatus,
    createMissing: values.createMissing,
    validateBase: values.validateBase ?? IMPORT_DEFAULTS.validateBase,
    dryRun: values.dryRun,
    verbose: values.verbose,
  };
  return options;
}

/** Validate Commander flags and prompt answers before reading the strategy policy. */
function resolveStrategy(value: unknown): ImportStrategy {
  if (value === undefined) return IMPORT_DEFAULTS.strategy;
  if (isImportStrategy(value)) return value;
  throw new Error(`Invalid --strategy "${String(value)}". Valid strategies: ${IMPORT_STRATEGIES.join(', ')}.`);
}

/**
 * The questions for what the flags left out. Later questions depend on earlier answers
 * (the format is only asked when the source's extension does not tell it; the locale
 * choices and the migration flags depend on the strategy), through prompts' function-valued
 * `type` and `choices`.
 */
export function importQuestions(
  options: ImportCommandOptions,
  { configuredLocales, baseLocale, sourceExists }: ImportOptionsContext,
): prompts.PromptObject[] {
  resolveStrategy(options.strategy);
  const questions: prompts.PromptObject[] = [];
  const stateOf = (answers: ImportAnswers) => importOptionState(options, answers, { configuredLocales, baseLocale });

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

  if (!options.format) {
    questions.push({
      // Keep format unset for core when the source extension is sufficient.
      type: (_prev: unknown, values: Record<string, unknown>) => {
        return sourceFormat(mergeRunOptions(options, values).source ?? '') ? null : 'select';
      },
      name: 'format',
      message: 'Select import format:',
      choices: [
        { title: 'JSON', value: 'json', description: 'JSON format (flat or hierarchical)' },
        { title: 'XLIFF 1.2', value: 'xliff', description: 'XLIFF format for professional translation services' },
      ],
    });
  }

  if (!options.strategy) {
    questions.push({
      type: 'select',
      name: 'strategy',
      message: 'Select import strategy:',
      choices: [
        {
          title: 'Translation Service',
          value: IMPORT_DEFAULTS.strategy,
          description: 'Import from professional translation services (default)',
        },
        { title: 'Verification', value: 'verification', description: 'Language expert verification workflow' },
        { title: 'Migration', value: 'migration', description: 'Migrate from another translation system' },
        { title: 'Update', value: 'update', description: 'Bulk update existing translations' },
      ],
    });
  }

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

  const migrationFlag = (name: 'updateComments' | 'updateTags' | 'createMissing', message: string) => {
    if (options[name] === undefined) {
      questions.push({
        // Migration-only flag prompts are CLI UX, not a strategy rule.
        type: (_prev: unknown, values: Record<string, unknown>) => (stateOf(values).migration ? 'confirm' : null),
        name,
        message,
        initial: IMPORT_MIGRATION_DEFAULTS[name],
      });
    }
  };
  migrationFlag('updateComments', 'Update comments from import data?');
  migrationFlag('updateTags', 'Update tags from import data?');
  migrationFlag('createMissing', 'Create missing resources?');

  return questions;
}
