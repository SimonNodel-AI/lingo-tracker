import { flagName } from '../runner/flag-record';
import { DEFAULT_CONFIG, type ExportFormat, type LingoTrackerConfig } from '@simoncodes-ca/core';
import type prompts from 'prompts';
import { type ExplicitEmptyList, selectionNames, selectionPrompt, type Selection } from '../utils';
import {
  EXPORT_OPTION_TABLE,
  type ExportAnswers,
  type ExportTableContext,
  resolveExportTable,
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

/** The runner has already decoded and validated every selection. */
export function exportSelection(selections: Partial<Record<keyof ExportCommandOptions, Selection>>): Selection {
  return selections.collection ?? { kind: 'all' };
}

export function resolveExportOptions(
  values: ExportAnswers,
  selections: Partial<Record<keyof ExportCommandOptions, Selection>>,
) {
  values = {
    ...values,
    locale: selectionNames(selections.locale),
    status: selections.status?.kind === 'some' ? selections.status.names : values.status,
  };
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
  };
}
export function exportQuestions(options: ExportCommandOptions, context: ExportOptionsContext): prompts.PromptObject[] {
  return tableQuestions<ExportAnswers, ExportTableContext>(EXPORT_OPTION_TABLE, options, tableContext(context));
}
