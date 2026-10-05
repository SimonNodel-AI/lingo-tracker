import { detectImportFormat, type ImportFormat } from '@simoncodes-ca/core';
import type { ImportStrategy } from '@simoncodes-ca/domain';
import type prompts from 'prompts';
import {
  IMPORT_OPTION_TABLE,
  resolveStrategy,
  type ImportTableContext,
  resolveImportTable,
} from './import-option-table';
import { orderedTableQuestions } from './option-table';

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

/** Detection is pure; failure means an explicit format question is needed. */
function sourceFormat(source: string): ImportFormat | undefined {
  try {
    return detectImportFormat(source);
  } catch {
    return undefined;
  }
}

export function resolveImportOptions(values: ImportCommandOptions) {
  return resolveImportTable(values, {
    configuredLocales: [],
    baseLocale: '',
    sourceExists: () => false,
    sourceFormat,
  });
}
export function importQuestions(options: ImportCommandOptions, context: ImportOptionsContext): prompts.PromptObject[] {
  resolveStrategy(options.strategy);
  return orderedTableQuestions<ImportCommandOptions, ImportTableContext>(IMPORT_OPTION_TABLE, options, {
    ...context,
    sourceFormat,
  });
}
