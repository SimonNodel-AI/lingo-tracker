import type { ExportRunOptions } from '@simoncodes-ca/core';
import { TRANSLATION_STATUSES, type TranslationStatus } from '@simoncodes-ca/domain';
import type prompts from 'prompts';
import type { ExportCommandOptions, ExportOptionsContext } from './export-options';
import type { parseListSelection, selectionNames, selectionPrompt } from '../utils/prompt-utils';
import { parseCommaSeparatedList } from '../utils/string-parsers';
import { mergeRunOptions } from './run-option-defaults';
import { resolveOption, type CommandOptionTable } from './option-table';

export type ExportAnswers = ExportCommandOptions & {
  readonly collections?: unknown;
  readonly locales?: unknown;
  readonly statusFilter?: unknown;
};
export interface ExportTableContext extends ExportOptionsContext {
  readonly outputInitial: string;
  readonly selectionPrompt: typeof selectionPrompt;
  readonly selectionNames: typeof selectionNames;
  readonly parseListSelection: typeof parseListSelection;
}
export type ResolvedExportOptions = Required<
  Omit<ExportRunOptions, 'format' | 'cwd' | 'exportFolder' | 'onStart' | 'onProgress'>
> &
  Pick<ExportRunOptions, 'cwd' | 'exportFolder' | 'onStart' | 'onProgress'> & {
    format: ExportCommandOptions['format'];
  };
type ExportOptionResults = {
  [Key in keyof Required<ExportCommandOptions>]: Pick<
    ResolvedExportOptions,
    Key extends 'output'
      ? 'outputDirectory'
      : Key extends 'locale'
        ? 'locales'
        : Key extends 'filename'
          ? 'filenamePattern'
          : Key extends 'structure'
            ? 'jsonStructure'
            : Key extends 'rich'
              ? 'richJson'
              : Key extends 'protectNotes'
                ? 'augmentProtectedTerms'
                : Extract<Key, keyof ResolvedExportOptions>
  >;
};

const json = (options: ExportCommandOptions) => options.format === 'json';
const richJson = (options: ExportCommandOptions) => json(options) && Boolean(options.rich);
const toggle = (message: string): Partial<prompts.PromptObject> => ({ message, active: 'Yes', inactive: 'No' });
const BASE_PROPERTY_INITIAL = 'baseValue';
const STATUS_TITLES: Record<TranslationStatus, string> = {
  new: 'New (not yet translated)',
  stale: 'Stale (source changed)',
  translated: 'Translated (has translation)',
  verified: 'Verified (reviewed)',
};
// Keep the established prompt order while deriving the choices from domain.
const statusOrder = (status: TranslationStatus) =>
  status === 'stale' ? 1 : status === 'translated' ? 2 : TRANSLATION_STATUSES.indexOf(status);
export function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}
function resolveStatuses(values: ExportAnswers, defaultValue: string): string[] {
  const status = values.status;
  if (status !== undefined && Array.isArray(status) === false) {
    throw new Error(`Invalid --status "${status.input}". Valid statuses: ${TRANSLATION_STATUSES.join(', ')}`);
  }
  const statuses =
    (Array.isArray(status) ? status : undefined) ??
    stringList(values.statusFilter) ??
    parseCommaSeparatedList(defaultValue) ??
    [];
  if (statuses.length === 0) throw new Error(`Invalid --status "". Valid statuses: ${TRANSLATION_STATUSES.join(', ')}`);
  return statuses;
}

export const EXPORT_OPTION_TABLE: CommandOptionTable<
  ExportCommandOptions,
  ExportAnswers,
  ExportTableContext,
  ExportOptionResults
> = {
  format: {
    flags: '-f, --format <format>',
    description: 'Export format (xliff | json)',
    defaultValue: undefined,
    prompt: (options) => {
      return options.format
        ? []
        : [
            {
              type: 'select',
              name: 'format',
              message: 'Select export format',
              choices: [
                { title: 'XLIFF 1.2 (for translation tools)', value: 'xliff' },
                { title: 'JSON (for runtime bundles)', value: 'json' },
              ],
              initial: 0,
            },
          ];
    },
    resolve: (values) => ({ format: values.format }),
  },
  collection: {
    flags: '-c, --collection <names>',
    description: 'Specific collection(s) to export (comma-separated)',
    list: 'optional',
    defaultValue: undefined,
    prompt: (options, context) => {
      return options.collection
        ? []
        : [
            context.selectionPrompt({
              name: 'collections',
              message: 'Select collections to export',
              choices: Object.keys(context.config.collections || {}),
              allTitle: 'All Collections',
              mode: 'multiple',
            }),
          ];
    },
    resolve: () => ({}),
  },
  locale: {
    flags: '-l, --locale <locales>',
    description: 'Target locale(s) to export (comma-separated)',
    list: 'optional',
    defaultValue: undefined,
    prompt: (options, context) => {
      return options.locale
        ? []
        : [
            context.selectionPrompt({
              name: 'locales',
              message: 'Select target locales to export',
              choices: context.targetLocales,
              allTitle: 'All Target Locales',
              mode: 'multiple',
            }),
          ];
    },
    resolve: (values, _defaultValue, context) => ({
      locales: context.selectionNames(context.parseListSelection(values.locale, stringList(values.locales))),
    }),
  },
  status: {
    flags: '-s, --status <statuses>',
    description: 'Filter by translation status (comma-separated)',
    list: 'preserve',
    defaultValue: 'new,stale',
    defaultMode: 'help',
    prompt: (options, _context, defaultValue) => {
      const selectedStatuses = parseCommaSeparatedList(String(defaultValue)) ?? [];
      return options.status
        ? []
        : [
            {
              type: 'multiselect',
              name: 'statusFilter',
              message: 'Filter by translation status',
              choices: TRANSLATION_STATUSES.map((status) => ({
                title: STATUS_TITLES[status],
                value: status,
                selected: selectedStatuses.includes(status),
              })).sort((left, right) => statusOrder(left.value) - statusOrder(right.value)),
              min: 1,
              hint: 'Space to select. Return to submit',
              instructions: false,
            },
          ];
    },
    resolve: (values, defaultValue) => ({ status: resolveStatuses(values, String(defaultValue)) }),
  },
  tags: {
    flags: '-t, --tags <tags>',
    description: 'Filter by tags (comma-separated)',
    list: 'optional',
    defaultValue: undefined,
    prompt: (options) => {
      return options.tags
        ? []
        : [
            {
              type: 'text',
              name: 'tags',
              message: 'Filter by tags (comma-separated, optional)',
              initial: '',
            },
          ];
    },
    resolve: (values) => ({ tags: values.tags?.length ? values.tags : undefined }),
  },
  output: {
    flags: '-o, --output <path>',
    description: 'Output directory path',
    defaultValue: undefined,
    prompt: (options, context) => {
      return options.output
        ? []
        : [
            {
              type: 'text',
              name: 'output',
              message: 'Output directory',
              initial: context.outputInitial,
            },
          ];
    },
    resolve: (values) => ({ outputDirectory: values.output || undefined }),
  },
  structure: {
    flags: '--structure <type>',
    description: 'JSON structure (flat | hierarchical)',
    defaultValue: 'hierarchical',
    defaultMode: 'help',
    prompt: (options, _context, defaultValue) => {
      if (options.structure !== undefined || (options.format && options.format !== 'json')) return [];
      const rule = {
        visible: json,
        type: 'select' as const,
        initial: defaultValue === 'hierarchical' ? 0 : 1,
        prompt: {
          message: 'JSON structure type',
          choices: [
            { title: 'Hierarchical (nested objects)', value: 'hierarchical' },
            { title: 'Flat (dot-delimited keys)', value: 'flat' },
          ],
        },
      };
      return [
        {
          ...rule.prompt,
          name: 'structure',
          type: (_prev: unknown, answers: ExportAnswers) =>
            rule.visible(mergeRunOptions(options, answers)) ? rule.type : null,
          initial: rule.initial,
        },
      ];
    },
    resolve: (values, defaultValue) => ({
      jsonStructure: values.structure ?? (defaultValue === 'flat' ? 'flat' : 'hierarchical'),
    }),
  },
  rich: {
    flags: '--rich',
    description: 'Include metadata in JSON objects',
    defaultValue: false,
    defaultMode: 'help',
    prompt: (options, _context, defaultValue) => {
      if (options.rich !== undefined || (options.format && options.format !== 'json')) return [];
      const rule = {
        visible: json,
        type: 'toggle' as const,
        prompt: toggle('Use rich JSON objects (include metadata)?'),
      };
      return [
        {
          ...rule.prompt,
          name: 'rich',
          type: (_prev: unknown, answers: ExportAnswers) =>
            rule.visible(mergeRunOptions(options, answers)) ? rule.type : null,
          initial: defaultValue,
        },
      ];
    },
    resolve: (values, defaultValue) => ({ richJson: values.rich ?? Boolean(defaultValue) }),
  },
  includeBase: {
    flags: '--include-base',
    description: 'Include base locale value (JSON only)',
    defaultValue: false,
    defaultMode: 'help',
    prompt: (options, _context, defaultValue) => {
      if (options.includeBase !== undefined || (options.format && options.format !== 'json')) return [];
      const rule = {
        visible: richJson,
        type: 'toggle' as const,
        prompt: toggle('Include base locale value in rich objects?'),
      };
      return [
        {
          ...rule.prompt,
          name: 'includeBase',
          type: (_prev: unknown, answers: ExportAnswers) =>
            rule.visible(mergeRunOptions(options, answers)) ? rule.type : null,
          initial: defaultValue,
        },
      ];
    },
    resolve: (values, defaultValue) => ({ includeBase: values.includeBase ?? Boolean(defaultValue) }),
  },
  includeStatus: {
    flags: '--include-status',
    description: 'Include translation status (JSON only)',
    defaultValue: false,
    defaultMode: 'help',
    prompt: (options, _context, defaultValue) => {
      if (options.includeStatus !== undefined || (options.format && options.format !== 'json')) return [];
      const rule = {
        visible: richJson,
        type: 'toggle' as const,
        prompt: toggle('Include translation status in rich objects?'),
      };
      return [
        {
          ...rule.prompt,
          name: 'includeStatus',
          type: (_prev: unknown, answers: ExportAnswers) =>
            rule.visible(mergeRunOptions(options, answers)) ? rule.type : null,
          initial: defaultValue,
        },
      ];
    },
    resolve: (values, defaultValue) => ({ includeStatus: values.includeStatus ?? Boolean(defaultValue) }),
  },
  includeComment: {
    flags: '--include-comment',
    description: 'Include comment (JSON only)',
    defaultValue: false,
    defaultMode: 'help',
    prompt: (options, _context, defaultValue) => {
      if (options.includeComment !== undefined || (options.format && options.format !== 'json')) return [];
      const rule = {
        visible: richJson,
        type: 'toggle' as const,
        prompt: toggle('Include comments?'),
      };
      return [
        {
          ...rule.prompt,
          name: 'includeComment',
          type: (_prev: unknown, answers: ExportAnswers) =>
            rule.visible(mergeRunOptions(options, answers)) ? rule.type : null,
          initial: defaultValue,
        },
      ];
    },
    resolve: (values, defaultValue) => ({ includeComment: values.includeComment ?? Boolean(defaultValue) }),
  },
  includeTags: {
    flags: '--include-tags',
    description: 'Include tags array (JSON only)',
    defaultValue: false,
    defaultMode: 'help',
    prompt: (options, _context, defaultValue) => {
      if (options.includeTags !== undefined || (options.format && options.format !== 'json')) return [];
      const rule = {
        visible: richJson,
        type: 'toggle' as const,
        prompt: toggle('Include tags array in rich objects?'),
      };
      return [
        {
          ...rule.prompt,
          name: 'includeTags',
          type: (_prev: unknown, answers: ExportAnswers) =>
            rule.visible(mergeRunOptions(options, answers)) ? rule.type : null,
          initial: defaultValue,
        },
      ];
    },
    resolve: (values, defaultValue) => ({ includeTags: values.includeTags ?? Boolean(defaultValue) }),
  },
  protectNotes: {
    flags: '--no-protect-notes',
    description: 'Do not emit do-not-translate instructions for protected terms',
    defaultValue: true,
    resolve: (values, defaultValue) => ({ augmentProtectedTerms: (values.protectNotes ?? defaultValue) !== false }),
  },
  // Preserve the includeBase-only condition, including when rich is false.
  basePropertyName: {
    flags: '--base-property-name <name>',
    description: `Property name for base locale value in JSON output (default: ${BASE_PROPERTY_INITIAL})`,
    defaultValue: undefined,
    prompt: (options) => {
      if (options.basePropertyName !== undefined || (options.format && options.format !== 'json')) return [];
      const rule = {
        visible: (options: ExportCommandOptions) => json(options) && Boolean(options.includeBase),
        type: 'text' as const,
        initial: BASE_PROPERTY_INITIAL,
        prompt: { message: 'Property name for base locale value' },
      };
      return [
        {
          ...rule.prompt,
          name: 'basePropertyName',
          type: (_prev: unknown, answers: ExportAnswers) =>
            rule.visible(mergeRunOptions(options, answers)) ? rule.type : null,
          initial: rule.initial,
        },
      ];
    },
    resolve: (values) => ({ basePropertyName: values.basePropertyName || undefined }),
  },
  filename: {
    flags: '--filename <pattern>',
    description: 'Custom filename pattern',
    defaultValue: undefined,
    prompt: (options) =>
      options.filename
        ? []
        : [
            {
              type: 'text',
              name: 'filename',
              message: 'Custom filename pattern (optional, e.g., "translations-{locale}")',
              initial: '',
            },
          ],
    resolve: (values) => ({ filenamePattern: values.filename || undefined }),
  },
  dryRun: {
    flags: '--dry-run',
    description: 'Show what would be exported without writing files',
    defaultValue: false,
    defaultMode: 'commander',
    resolve: (values) => ({ dryRun: values.dryRun }),
  },
  verbose: {
    flags: '--verbose',
    description: 'Show detailed export progress',
    defaultValue: false,
    defaultMode: 'commander',
    resolve: (values) => ({ verbose: values.verbose }),
  },
};

/** Every resolved field must be present, including fields whose value is undefined. */
export function resolveExportTable(values: ExportAnswers, context: ExportTableContext): ResolvedExportOptions {
  return {
    ...resolveOption(EXPORT_OPTION_TABLE.format, values, context),
    ...resolveOption(EXPORT_OPTION_TABLE.output, values, context),
    ...resolveOption(EXPORT_OPTION_TABLE.locale, values, context),
    ...resolveOption(EXPORT_OPTION_TABLE.status, values, context),
    ...resolveOption(EXPORT_OPTION_TABLE.tags, values, context),
    ...resolveOption(EXPORT_OPTION_TABLE.filename, values, context),
    ...resolveOption(EXPORT_OPTION_TABLE.dryRun, values, context),
    ...resolveOption(EXPORT_OPTION_TABLE.verbose, values, context),
    ...resolveOption(EXPORT_OPTION_TABLE.structure, values, context),
    ...resolveOption(EXPORT_OPTION_TABLE.rich, values, context),
    ...resolveOption(EXPORT_OPTION_TABLE.includeBase, values, context),
    ...resolveOption(EXPORT_OPTION_TABLE.includeStatus, values, context),
    ...resolveOption(EXPORT_OPTION_TABLE.includeComment, values, context),
    ...resolveOption(EXPORT_OPTION_TABLE.includeTags, values, context),
    ...resolveOption(EXPORT_OPTION_TABLE.basePropertyName, values, context),
    ...resolveOption(EXPORT_OPTION_TABLE.protectNotes, values, context),
  };
}
