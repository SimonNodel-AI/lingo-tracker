import { flagName } from '../runner/flag-record';
import { DEFAULT_CONFIG, type ExportFormat, type LingoTrackerConfig } from '@simoncodes-ca/core';
import type prompts from 'prompts';
import { type ExplicitEmptyList, parseListSelection, selectionNames, selectionPrompt, type Selection } from '../utils';
import {
  EXPORT_OPTION_TABLE,
  type ExportAnswers,
  type ExportTableContext,
  resolveExportTable,
  stringList,
} from './export-option-table';
import { tableQuestions } from './option-table';

export interface ExportCommandOptions {
  format?: ExportFormat;
  collection?: string[];
  locale?: string[];
  status?: string[] | ExplicitEmptyList;
  tags?: string[];
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

export interface ExportOptionsContext {
  readonly config: Partial<Pick<LingoTrackerConfig, 'exportFolder' | 'collections'>>;
  readonly targetLocales: string[];
}

/** Checks prompt selections before the runner looks up requested collection names. */
export function exportSelection(answers: ExportAnswers): Selection {
  for (const [name, label] of [
    ['collections', 'collection'],
    ['locales', 'target locale'],
    ['statusFilter', 'translation status'],
  ] as const) {
    if (stringList(answers[name])?.length === 0) throw new Error(`Select at least one ${label}.`);
  }
  return parseListSelection(answers.collection, stringList(answers.collections)) ?? { kind: 'all' };
}

export function resolveExportOptions(values: ExportAnswers) {
  const options = resolveExportTable(values, tableContext({ config: {}, targetLocales: [] }));
  const advisories =
    options.basePropertyName && !options.includeBase
      ? [
          `${flagName(EXPORT_OPTION_TABLE.basePropertyName)} has no effect without ${flagName(EXPORT_OPTION_TABLE.includeBase)}`,
        ]
      : [];
  return { options, advisories };
}
function tableContext(context: ExportOptionsContext): ExportTableContext {
  return {
    ...context,
    outputInitial: context.config.exportFolder || DEFAULT_CONFIG.exportFolder,
    selectionPrompt,
    selectionNames,
    parseListSelection,
  };
}
export function exportQuestions(options: ExportCommandOptions, context: ExportOptionsContext): prompts.PromptObject[] {
  return tableQuestions<ExportAnswers, ExportTableContext>(EXPORT_OPTION_TABLE, options, tableContext(context));
}
