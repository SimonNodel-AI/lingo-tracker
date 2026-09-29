import {
  displayTermPath,
  editPreferredTerminology,
  type LingoTrackerConfig,
  loadPreferredTerminology,
  type PreferredTerminologyEditResult,
  PreferredTerminologyValidationError,
} from '@simoncodes-ca/core';
import type { PreferredTermRule } from '@simoncodes-ca/domain';
import { type CommandResult, defineCommand } from '../runner/command-runner';
import { ConsoleFormatter } from '../utils';

export interface PreferredTerminologyOptions {
  list?: boolean;
  /** Discouraged term to add, or to update when a rule for it already exists (case-insensitive). */
  add?: string;
  /** Preferred term for `--add`. Required with `--add`, rejected without it. */
  preferred?: string;
  /** Optional reason for `--add`. Rejected without `--add`. */
  reason?: string;
  /** Discouraged term whose rule should be removed (case-insensitive). */
  remove?: string;
}

/** `Expenditure → Investment — reason`, without a reason suffix when there is none. */
function formatRule(rule: PreferredTermRule): string {
  const base = `${rule.discouraged} → ${rule.preferred}`;
  return rule.reason ? `${base} — ${rule.reason}` : base;
}

export const preferredTerminologyCommand = defineCommand<PreferredTerminologyOptions>()({
  name: 'Preferred terminology',
  collection: 'none',
  run: ({ config, cwd, answers }) => run(answers, config, cwd),
});

/** A thrown error ends the command: the runner prints `❌ <message>` and exits 1. */
function run(options: PreferredTerminologyOptions, config: LingoTrackerConfig, cwd: string): CommandResult {
  const hasList = options.list === true;
  const hasAdd = options.add !== undefined;
  const hasRemove = options.remove !== undefined;

  if (!hasList && !hasAdd && !hasRemove) {
    throw new Error('Provide one of --list, --add <discouraged> --preferred <preferred>, or --remove <discouraged>');
  }
  if (hasAdd && hasRemove) {
    throw new Error('--add and --remove cannot be combined; run them separately');
  }
  if (!hasAdd && (options.preferred !== undefined || options.reason !== undefined)) {
    throw new Error('--preferred and --reason can only be used with --add');
  }
  if (hasAdd && options.preferred === undefined) {
    throw new Error('--add requires --preferred <preferred>');
  }

  const loaded = loadPreferredTerminology(config, cwd);
  const where = displayTermPath(loaded.filePath, cwd);
  if (loaded.warning) ConsoleFormatter.warning(loaded.warning);
  if (hasList) {
    ConsoleFormatter.section('Preferred Terminology');
    ConsoleFormatter.keyValue('File', where);
    if (loaded.error) throw new Error(loaded.error);
    if (loaded.rules.length === 0) ConsoleFormatter.indent('(none)');
    else for (const rule of loaded.rules) ConsoleFormatter.indent(formatRule(rule));
  }
  if (!hasAdd && !hasRemove) return;
  if (loaded.error) throw new Error(loaded.error);

  let result: PreferredTerminologyEditResult;
  try {
    result = editPreferredTerminology(config, options, cwd, loaded);
  } catch (error) {
    if (error instanceof PreferredTerminologyValidationError) {
      ConsoleFormatter.error(
        'Preferred terminology not saved:',
        error.errors.map((ruleError) => {
          const row = error.submittedRules?.[ruleError.index];
          const label = row ? `"${row.discouraged} → ${row.preferred}"` : `row ${ruleError.index + 1}`;
          return `${label}: ${ruleError.message}`;
        }),
      );
      return { exitCode: 1 };
    }
    throw new Error(error instanceof Error ? error.message : String(error));
  }
  if (result.action && result.changedRule) {
    const verb = result.action === 'added' ? 'Added' : result.action === 'updated' ? 'Updated' : 'Removed';
    ConsoleFormatter.success(`${verb} preferred terminology rule: ${formatRule(result.changedRule)} (${where})`);
  }
}
