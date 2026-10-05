import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import type { ImportCommandOptions } from './import-options';
import {
  IMPORT_OPTION_TABLE,
  resolveImportTable,
  type ImportTableContext,
  type ResolvedImportOptions,
} from './import-option-table';
import { tableOptions, orderedTableQuestions, type OrderedCommandOptionRecord } from './option-table';

vi.mock('@simoncodes-ca/core', () => {
  throw new Error('Option tables must load without core or command handlers.');
});

const flagCases: Record<string, { argv: string[]; value: unknown }> = {
  format: { argv: ['--format', 'json'], value: 'json' },
  source: { argv: ['--source', 'messages.json'], value: 'messages.json' },
  locale: { argv: ['--locale', 'fr'], value: 'fr' },
  collection: { argv: ['--collection', 'main'], value: 'main' },
  strategy: { argv: ['--strategy', 'migration'], value: 'migration' },
  updateComments: { argv: ['--update-comments'], value: true },
  updateTags: { argv: ['--update-tags'], value: true },
  preserveStatus: { argv: ['--preserve-status'], value: true },
  createMissing: { argv: ['--create-missing'], value: true },
  validateBase: { argv: ['--no-validate-base'], value: false },
  dryRun: { argv: ['--dry-run'], value: true },
  verbose: { argv: ['--verbose'], value: true },
};
const context: ImportTableContext = {
  configuredLocales: ['en', 'fr'],
  baseLocale: 'en',
  sourceExists: () => true,
  sourceFormat: () => undefined,
};

// @ts-expect-error A prompted import record must specify its prompt order.
const _missingOrder: OrderedCommandOptionRecord<ImportCommandOptions, ImportTableContext> = {
  flags: '--source <path>',
  description: 'Source',
  defaultValue: undefined,
  prompt: () => [],
  resolve: () => ({}),
};
// @ts-expect-error The locale record must return its locale field.
const _missingLocaleRule: typeof IMPORT_OPTION_TABLE.locale = { ...IMPORT_OPTION_TABLE.locale, resolve: () => ({}) };

describe('import option table', () => {
  for (const [key, record] of Object.entries(IMPORT_OPTION_TABLE)) {
    it(`defines registration, defaults and resolution for ${key}`, () => {
      const command = new Command();
      for (const register of tableOptions({ [key]: record })) register(command);
      const testCase = flagCases[key];
      expect(testCase).toBeDefined();
      command.parse(testCase.argv, { from: 'user' });
      expect(command.opts()[key]).toEqual(testCase.value);
    });
  }

  it('covers every command options key and registers without loading handlers', () => {
    const registrations = tableOptions(IMPORT_OPTION_TABLE);
    expect(registrations).toHaveLength(13);
    const command = new Command();
    for (const register of registrations) register(command);
    command.parse([], { from: 'user' });
    expect(command.opts()).toEqual({ dryRun: false, verbose: false });
    const helpDefaults = {
      strategy: 'translation-service',
      updateComments: false,
      updateTags: false,
      preserveStatus: false,
      createMissing: false,
      validateBase: true,
    };
    for (const [key, value] of Object.entries(helpDefaults)) {
      expect(command.options.find((option) => option.attributeName() === key)?.description).toContain(
        `(default: ${JSON.stringify(value)})`,
      );
    }
  });

  it('builds every import prompt in dependency order and omits supplied flags', () => {
    const questions = orderedTableQuestions<ImportCommandOptions, ImportTableContext>(IMPORT_OPTION_TABLE, {}, context);
    expect(questions.map((question) => question.name)).toEqual([
      'source',
      'format',
      'strategy',
      'locale',
      'locale',
      'locale',
      'locale',
      'locale',
      'updateComments',
      'updateTags',
      'createMissing',
    ]);
    const visible = questions.filter((question) =>
      typeof question.type === 'function'
        ? question.type(undefined, { strategy: 'migration' }, question)
        : question.type,
    );
    expect(visible.map((question) => question.name)).toEqual([
      'source',
      'format',
      'strategy',
      'locale',
      'updateComments',
      'updateTags',
      'createMissing',
    ]);
    expect(
      orderedTableQuestions<ImportCommandOptions, ImportTableContext>(
        IMPORT_OPTION_TABLE,
        {
          source: 'messages.json',
          format: 'json',
          strategy: 'migration',
          locale: 'fr',
          updateComments: false,
          updateTags: false,
          createMissing: false,
        },
        context,
      ),
    ).toEqual([]);
  });

  it('resolves the complete result while rejecting omitted fields at compile time', () => {
    const options = resolveImportTable({}, context);
    expect(options).toEqual({
      source: undefined,
      format: undefined,
      locale: undefined,
      strategy: 'translation-service',
      updateComments: undefined,
      updateTags: undefined,
      preserveStatus: false,
      createMissing: undefined,
      validateBase: true,
      dryRun: undefined,
      verbose: undefined,
    });
    const { locale, ...withoutLocale } = options;
    // @ts-expect-error A complete result must include locale, even when undefined.
    const _missingLocale: ResolvedImportOptions = withoutLocale;
    expect(locale).toBeUndefined();
  });
});
