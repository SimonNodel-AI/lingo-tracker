import { registerFlags } from '../runner/flag-record';
import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import {
  EXPORT_OPTION_TABLE,
  resolveExportTable,
  type ExportTableContext,
  type ExportAnswers,
  type ResolvedExportOptions,
} from './export-option-table';
import { tableFlags, tableQuestions, type TableRegistration } from './option-table';

vi.mock('@simoncodes-ca/core', () => {
  throw new Error('Option tables must load without core or command handlers.');
});

const flagCases: Record<string, { argv: string[]; value: unknown }> = {
  format: { argv: ['--format', 'json'], value: 'json' },
  collection: { argv: ['--collection', ' main, shared '], value: ['main', 'shared'] },
  locale: { argv: ['--locale', ' fr, de '], value: ['fr', 'de'] },
  status: { argv: ['--status', ' new, stale '], value: ['new', 'stale'] },
  tags: { argv: ['--tags', ' first, second '], value: ['first', 'second'] },
  output: { argv: ['--output', 'custom/export'], value: 'custom/export' },
  structure: { argv: ['--structure', 'flat'], value: 'flat' },
  rich: { argv: ['--rich'], value: true },
  includeBase: { argv: ['--include-base'], value: true },
  includeStatus: { argv: ['--include-status'], value: true },
  includeComment: { argv: ['--include-comment'], value: true },
  includeTags: { argv: ['--include-tags'], value: true },
  protectNotes: { argv: ['--no-protect-notes'], value: false },
  basePropertyName: { argv: ['--base-property-name', 'source'], value: 'source' },
  filename: { argv: ['--filename', '{locale}-messages'], value: '{locale}-messages' },
  dryRun: { argv: ['--dry-run'], value: true },
  verbose: { argv: ['--verbose'], value: true },
};
const context: ExportTableContext = {
  config: {},
  targetLocales: ['fr'],
  outputInitial: 'custom/export',
  selectionPrompt: ({ name, message }) => ({ type: 'multiselect', name, message }),
};

// @ts-expect-error A list registration cannot silently discard a custom parser.
const _invalidList: TableRegistration = {
  flags: '--locales <list>',
  description: 'Locales',
  defaultValue: undefined,
  list: 'optional',
  parse: (value: string) => value,
};
// @ts-expect-error The status record must return its status field.
const _missingStatusRule: typeof EXPORT_OPTION_TABLE.status = { ...EXPORT_OPTION_TABLE.status, resolve: () => ({}) };
// @ts-expect-error The locale record must return its locales field.
const _missingLocalesRule: typeof EXPORT_OPTION_TABLE.locale = { ...EXPORT_OPTION_TABLE.locale, resolve: () => ({}) };

const _invalidSelectionPrompt: typeof EXPORT_OPTION_TABLE.collection = {
  ...EXPORT_OPTION_TABLE.collection,
  // @ts-expect-error A selection prompt must name an actual export answer key.
  selection: { prompt: 'collectons' },
};
const _invalidAllFlag: typeof EXPORT_OPTION_TABLE.collection = {
  ...EXPORT_OPTION_TABLE.collection,
  // @ts-expect-error An all flag must name an actual command option key.
  selection: { allFlag: 'collections' },
};

describe('export option table', () => {
  for (const [key, record] of Object.entries(EXPORT_OPTION_TABLE)) {
    it(`defines registration, defaults and resolution for ${key}`, () => {
      const command = new Command();
      registerFlags(command, tableFlags({ [key]: record }));
      const testCase = flagCases[key];
      expect(testCase).toBeDefined();
      command.parse(testCase.argv, { from: 'user' });
      expect(command.opts()[key]).toEqual(testCase.value);
    });
  }

  it('covers every command options key and registers without loading handlers', () => {
    const registrations = tableFlags(EXPORT_OPTION_TABLE);
    const command = new Command();
    registerFlags(command, registrations);
    expect(command.options).toHaveLength(17);
    command.parse([], { from: 'user' });
    expect(command.opts()).toEqual({ protectNotes: true, dryRun: false, verbose: false });
    const helpDefaults = {
      status: 'new,stale',
      structure: 'hierarchical',
      rich: false,
      includeBase: false,
      includeStatus: false,
      includeComment: false,
      includeTags: false,
    };
    for (const [key, value] of Object.entries(helpDefaults)) {
      expect(command.options.find((option) => option.attributeName() === key)?.description).toContain(
        `(default: ${JSON.stringify(value)})`,
      );
    }
  });

  it('builds every export prompt in record order and omits supplied flags', () => {
    const questions = tableQuestions<ExportAnswers, ExportTableContext>(EXPORT_OPTION_TABLE, {}, context);
    expect(questions.map((question) => question.name)).toEqual([
      'format',
      'collections',
      'locales',
      'statusFilter',
      'tags',
      'output',
      'structure',
      'rich',
      'includeBase',
      'includeStatus',
      'includeComment',
      'includeTags',
      'basePropertyName',
      'filename',
    ]);
    expect(questions.find((question) => question.name === 'output')?.initial).toBe('custom/export');
    expect(
      tableQuestions<ExportAnswers, ExportTableContext>(
        EXPORT_OPTION_TABLE,
        {
          format: 'json',
          collection: ['main'],
          locale: ['fr'],
          status: ['new'],
          tags: ['first'],
          output: 'custom/export',
          structure: 'flat',
          rich: false,
          includeBase: false,
          includeStatus: false,
          includeComment: false,
          includeTags: false,
          basePropertyName: 'source',
          filename: 'messages',
        },
        context,
      ),
    ).toEqual([]);
  });

  it('resolves the complete result while rejecting omitted fields at compile time', () => {
    const options = resolveExportTable({}, context);
    expect(options).toEqual({
      format: undefined,
      outputDirectory: undefined,
      locales: undefined,
      status: ['new', 'stale'],
      tags: undefined,
      filenamePattern: undefined,
      dryRun: undefined,
      verbose: undefined,
      jsonStructure: 'hierarchical',
      richJson: false,
      includeBase: false,
      includeStatus: false,
      includeComment: false,
      includeTags: false,
      basePropertyName: undefined,
      augmentProtectedTerms: true,
    });
    const { status, ...withoutStatus } = options;
    const { locales, ...withoutLocales } = options;
    // @ts-expect-error A complete result must include status.
    const _missingStatus: ResolvedExportOptions = withoutStatus;
    // @ts-expect-error A complete result must include locales, even when undefined.
    const _missingLocales: ResolvedExportOptions = withoutLocales;
    expect(status).toEqual(['new', 'stale']);
    expect(locales).toBeUndefined();
  });
});
