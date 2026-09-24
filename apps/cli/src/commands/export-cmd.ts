import {
  type Collection,
  type ExportFormat,
  type ExportRunResult,
  exportTargetLocales,
  type LingoTrackerConfig,
  openCollection,
  readCollectionProtectedTerms,
  readGlobalProtectedTerms,
  runExport,
  validateBasePropertyName,
  validateOutputDirectory,
} from '@simoncodes-ca/core';
import type { TranslationStatus } from '@simoncodes-ca/domain';
import * as fs from 'fs';
import * as path from 'path';
import type prompts from 'prompts';
import { type Answers, defineCommand, NO_COLLECTIONS_MESSAGE } from '../runner/command-runner';
import {
  buildSummaryPath,
  ConsoleFormatter,
  multiselectResultToString,
  parseCommaSeparatedList,
  processMultiselectWithAll,
} from '../utils';

export interface ExportCommandOptions {
  format?: ExportFormat;
  collection?: string;
  locale?: string;
  status?: string;
  tags?: string;
  output?: string;
  structure?: 'flat' | 'hierarchical';
  rich?: boolean;
  includeBase?: boolean;
  includeStatus?: boolean;
  includeComment?: boolean;
  includeTags?: boolean;
  basePropertyName?: string;
  filename?: string;
  dryRun?: boolean;
  verbose?: boolean;
  /** Whether to emit do-not-translate instructions (default true, negation of --no-protect-notes). */
  protectNotes?: boolean;
}

export const exportCommand = defineCommand<ExportCommandOptions>()({
  name: 'Export',
  // `--collection` takes a comma-separated list here (default: every collection), so the command opens them.
  collection: 'none',
  // The locale choices need the opened collections; only build them when they will be asked.
  prompts: (options, { config, cwd, interactive }) =>
    interactive ? buildQuestions(options, config, exportTargetLocales(openCollections(config, cwd))) : [],
  required: ['format'],
  run: async ({ config, cwd, answers }) => {
    const options = resolveAnswers(answers);
    const { format } = options;

    // Warn if --base-property-name was set without --include-base
    if (options.basePropertyName && !options.includeBase) {
      ConsoleFormatter.warning('--base-property-name has no effect without --include-base');
    }

    // Validate --base-property-name if provided (throws a message the runner prints)
    if (options.basePropertyName) {
      validateBasePropertyName(options.basePropertyName);
    }

    // Resolve output directory
    const outputDir = options.output
      ? path.resolve(cwd, options.output)
      : path.resolve(cwd, config.exportFolder || 'dist/lingo-export');

    validateOutputDirectory(outputDir);

    // An unknown name throws CollectionNotFoundError; none configured fails like every other command.
    const collections = openCollections(config, cwd, parseCommaSeparatedList(options.collection));

    const targetLocales = exportTargetLocales(collections, parseCommaSeparatedList(options.locale));
    if (targetLocales.length === 0) {
      ConsoleFormatter.warning('No target locales selected.');
      return;
    }

    ConsoleFormatter.progress(`Exporting to ${format.toUpperCase()}...`);
    ConsoleFormatter.indent(`Collections: ${collections.map((c) => c.name).join(', ')}`);
    ConsoleFormatter.indent(`Locales: ${targetLocales.join(', ')}`);
    ConsoleFormatter.indent(`Output: ${outputDir}`);
    if (options.dryRun) ConsoleFormatter.indent('[DRY RUN]');

    const result = await runExport(collections, {
      format,
      outputDirectory: outputDir,
      locales: targetLocales,
      status: parseCommaSeparatedList(options.status)?.map((s) => s as TranslationStatus),
      tags: parseCommaSeparatedList(options.tags),
      filenamePattern: options.filename,
      dryRun: options.dryRun,
      verbose: options.verbose,
      jsonStructure: options.structure,
      richJson: options.rich,
      includeBase: options.includeBase,
      includeStatus: options.includeStatus,
      includeComment: options.includeComment,
      includeTags: options.includeTags,
      basePropertyName: options.basePropertyName,
      augmentProtectedTerms: options.protectNotes !== false,
      protectedTerms: readProtectedTerms(config, collections, cwd),
      onProgress: options.verbose ? (msg) => console.log(`   ${msg}`) : undefined,
    });

    displayResults(result);

    const summaryPath = buildSummaryPath('export');
    if (!options.dryRun) {
      fs.writeFileSync(summaryPath, result.summary);
      console.log(`\n📄 Summary written to: ${summaryPath}`);
    } else {
      console.log('\n📄 Summary (Dry Run):');
      console.log(result.summary);
    }
    const failed = result.errors.length + result.hierarchicalConflicts.length > 0 && !options.dryRun;
    return failed ? { exitCode: 1 } : undefined;
  },
});

/** Opens the named collections (default: every one). Throws when none is configured or a name is unknown. */
function openCollections(config: LingoTrackerConfig, cwd: string, names?: string[]): Collection[] {
  const configured = Object.keys(config.collections ?? {});
  if (configured.length === 0) {
    throw new Error(NO_COLLECTIONS_MESSAGE);
  }
  return [...new Set(names ?? configured)].map((name) => openCollection(config, name, { cwd }));
}

function readProtectedTerms(config: LingoTrackerConfig, collections: readonly Collection[], cwd: string) {
  return {
    global: readGlobalProtectedTerms(config, cwd),
    collections: Object.fromEntries(collections.map((c) => [c.name, readCollectionProtectedTerms(c.config, cwd)])),
  };
}

function displayResults(result: ExportRunResult): void {
  for (const { locale, outcome, resourcesExported, filesCreated, error } of result.localeResults) {
    if (outcome === 'exported') {
      ConsoleFormatter.indent(`✅ ${locale}: Exported ${resourcesExported} resources to ${filesCreated.join(', ')}`);
    } else if (outcome === 'failed') {
      ConsoleFormatter.indent(error ? `❌ ${locale}: Export failed - ${error}` : `❌ ${locale}: Failed`);
    }
  }

  ConsoleFormatter.section('Export Summary');
  ConsoleFormatter.keyValue('Files Created', result.filesCreated.length);
  ConsoleFormatter.keyValue('Resources Exported', result.resourcesExported);

  if (result.warnings.length > 0) {
    console.log('');
    ConsoleFormatter.warning(`Warnings (${result.warnings.length}):`);
    result.warnings.forEach((w) => {
      ConsoleFormatter.indent(`- ${w}`);
    });
  }

  const errors = [...result.errors, ...result.hierarchicalConflicts];
  if (errors.length > 0) {
    console.log('');
    ConsoleFormatter.error(`Errors (${errors.length}):`);
    errors.forEach((e) => {
      ConsoleFormatter.indent(`- ${e}`);
    });
  }
}

/** The questions for every option the flags left out. */
function buildQuestions(
  options: ExportCommandOptions,
  config: LingoTrackerConfig,
  targetLocales: string[],
): prompts.PromptObject[] {
  const collectionNames = Object.keys(config.collections || {});

  const questions: prompts.PromptObject[] = [];

  // Format selection (required)
  if (!options.format) {
    questions.push({
      type: 'select',
      name: 'format',
      message: 'Select export format',
      choices: [
        { title: 'XLIFF 1.2 (for translation tools)', value: 'xliff' },
        { title: 'JSON (for runtime bundles)', value: 'json' },
      ],
      initial: 0,
    });
  }

  // Collection selection
  if (!options.collection) {
    questions.push({
      type: 'multiselect',
      name: 'collections',
      message: 'Select collections to export',
      choices: [
        { title: 'All Collections', value: '__ALL__', selected: true },
        ...collectionNames.map((name) => ({ title: name, value: name })),
      ],
      hint: 'Space to select. Return to submit',
      instructions: false,
    });
  }

  // Locale selection
  if (!options.locale) {
    questions.push({
      type: 'multiselect',
      name: 'locales',
      message: 'Select target locales to export',
      choices: [
        { title: 'All Target Locales', value: '__ALL__', selected: true },
        ...targetLocales.map((l: string) => ({ title: l, value: l })),
      ],
      hint: 'Space to select. Return to submit',
      instructions: false,
    });
  }

  // Status filter
  if (!options.status) {
    questions.push({
      type: 'multiselect',
      name: 'statusFilter',
      message: 'Filter by translation status',
      choices: [
        { title: 'New (not yet translated)', value: 'new', selected: true },
        { title: 'Stale (source changed)', value: 'stale', selected: true },
        {
          title: 'Translated (has translation)',
          value: 'translated',
          selected: false,
        },
        { title: 'Verified (reviewed)', value: 'verified', selected: false },
      ],
      hint: 'Space to select. Return to submit',
      instructions: false,
    });
  }

  // Tags filter
  if (!options.tags) {
    questions.push({
      type: 'text',
      name: 'tags',
      message: 'Filter by tags (comma-separated, optional)',
      initial: '',
    });
  }

  // Output directory
  if (!options.output) {
    const defaultOutput = config.exportFolder || 'dist/lingo-export';
    questions.push({
      type: 'text',
      name: 'output',
      message: 'Output directory',
      initial: defaultOutput,
    });
  }

  // Format-specific questions (only shown based on format selection)
  if (!options.format || options.format === 'json') {
    // JSON structure
    if (options.structure === undefined) {
      questions.push({
        type: (_prev: unknown, values: { format?: string; rich?: boolean }) => {
          const selectedFormat = options.format || values.format;
          return selectedFormat === 'json' ? 'select' : null;
        },
        name: 'structure',
        message: 'JSON structure type',
        choices: [
          { title: 'Hierarchical (nested objects)', value: 'hierarchical' },
          { title: 'Flat (dot-delimited keys)', value: 'flat' },
        ],
        initial: 0,
      });
    }

    // Rich JSON
    if (options.rich === undefined) {
      questions.push({
        type: (_prev: unknown, values: { format?: string; rich?: boolean }) => {
          const selectedFormat = options.format || values.format;
          return selectedFormat === 'json' ? 'toggle' : null;
        },
        name: 'rich',
        message: 'Use rich JSON objects (include metadata)?',
        initial: false,
        active: 'Yes',
        inactive: 'No',
      });
    }

    // Include base value
    if (options.includeBase === undefined) {
      questions.push({
        type: (_prev: unknown, values: { format?: string; rich?: boolean }) => {
          const selectedFormat = options.format || values.format;
          const isRich = options.rich !== undefined ? options.rich : values.rich;
          return selectedFormat === 'json' && isRich ? 'toggle' : null;
        },
        name: 'includeBase',
        message: 'Include base locale value in rich objects?',
        initial: false,
        active: 'Yes',
        inactive: 'No',
      });
    }

    // Include status
    if (options.includeStatus === undefined) {
      questions.push({
        type: (_prev: unknown, values: { format?: string; rich?: boolean }) => {
          const selectedFormat = options.format || values.format;
          const isRich = options.rich !== undefined ? options.rich : values.rich;
          return selectedFormat === 'json' && isRich ? 'toggle' : null;
        },
        name: 'includeStatus',
        message: 'Include translation status in rich objects?',
        initial: false,
        active: 'Yes',
        inactive: 'No',
      });
    }

    // Include comment
    if (options.includeComment === undefined) {
      questions.push({
        type: (_prev: unknown, values: { format?: string; rich?: boolean }) => {
          const selectedFormat = options.format || values.format;
          const isRich = options.rich !== undefined ? options.rich : values.rich;
          return selectedFormat === 'json' && isRich ? 'toggle' : null;
        },
        name: 'includeComment',
        message: 'Include comments?',
        initial: true,
        active: 'Yes',
        inactive: 'No',
      });
    }

    // Include tags
    if (options.includeTags === undefined) {
      questions.push({
        type: (_prev: unknown, values: { format?: string; rich?: boolean }) => {
          const selectedFormat = options.format || values.format;
          const isRich = options.rich !== undefined ? options.rich : values.rich;
          return selectedFormat === 'json' && isRich ? 'toggle' : null;
        },
        name: 'includeTags',
        message: 'Include tags array in rich objects?',
        initial: false,
        active: 'Yes',
        inactive: 'No',
      });
    }

    // Base property name
    if (options.basePropertyName === undefined) {
      questions.push({
        type: (_prev: unknown, values: { format?: string; includeBase?: boolean }) => {
          const selectedFormat = options.format || values.format;
          const isIncludeBase = options.includeBase !== undefined ? options.includeBase : values.includeBase;
          return selectedFormat === 'json' && isIncludeBase ? 'text' : null;
        },
        name: 'basePropertyName',
        message: 'Property name for base locale value',
        initial: 'baseValue',
      });
    }
  }

  // Custom filename pattern
  if (!options.filename) {
    questions.push({
      type: 'text',
      name: 'filename',
      message: 'Custom filename pattern (optional, e.g., "translations-{locale}")',
      initial: '',
    });
  }

  // Dry run
  if (options.dryRun === undefined) {
    questions.push({
      type: 'toggle',
      name: 'dryRun',
      message: 'Dry run (preview without writing files)?',
      initial: false,
      active: 'Yes',
      inactive: 'No',
    });
  }

  // Verbose
  if (options.verbose === undefined) {
    questions.push({
      type: 'toggle',
      name: 'verbose',
      message: 'Verbose output (show detailed progress)?',
      initial: false,
      active: 'Yes',
      inactive: 'No',
    });
  }

  return questions;
}

/**
 * Flags win over prompt answers; the multiselect answers (`collections`, `locales`,
 * `statusFilter`) become the comma-separated options; unset options get their defaults.
 */
function resolveAnswers(answers: Answers<ExportCommandOptions>): ExportCommandOptions {
  const collections = stringList(answers.collections);
  const locales = stringList(answers.locales);
  const statusFilter = stringList(answers.statusFilter);
  return {
    ...answers,
    collection:
      answers.collection ?? (collections && multiselectResultToString(processMultiselectWithAll(collections))),
    locale: answers.locale ?? (locales && multiselectResultToString(processMultiselectWithAll(locales))),
    status: answers.status ?? statusFilter?.join(','),
    tags: answers.tags || undefined,
    output: answers.output || undefined,
    structure: answers.structure ?? 'hierarchical',
    rich: answers.rich ?? false,
    includeBase: answers.includeBase ?? false,
    includeStatus: answers.includeStatus ?? false,
    includeComment: answers.includeComment ?? false,
    includeTags: answers.includeTags ?? false,
    basePropertyName: answers.basePropertyName || undefined,
    filename: answers.filename || undefined,
    dryRun: answers.dryRun ?? false,
    verbose: answers.verbose ?? false,
  };
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}
