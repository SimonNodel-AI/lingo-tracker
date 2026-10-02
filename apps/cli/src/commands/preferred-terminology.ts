import {
  displayTermPath,
  InvalidProjectTermsEditError,
  type OpenedProject,
  type PreferredTerminologyEditResult,
  PreferredTerminologyValidationError,
  type ProjectTermsEditProblem,
  planProjectTermsUpdate,
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

const preferredEditWording: Record<ProjectTermsEditProblem, string | undefined> = {
  'preferred-missing': 'Provide one of --list, --add <discouraged> --preferred <preferred>, or --remove <discouraged>',
  'preferred-conflict': '--add and --remove cannot be combined; run them separately',
  'protected-conflict': undefined,
  'protected-missing': undefined,
  'protected-file-path': undefined,
  'protected-replacement-conflict': undefined,
  'preferred-remove-shape': undefined,
  'preferred-replacement-shape': undefined,
  'preferred-upsert-shape': undefined,
};

/** `Expenditure → Investment — reason`, without a reason suffix when there is none. */
function formatRule(rule: PreferredTermRule): string {
  const base = `${rule.discouraged} → ${rule.preferred}`;
  return rule.reason ? `${base} — ${rule.reason}` : base;
}

export const preferredTerminologyCommand = defineCommand<PreferredTerminologyOptions>()({
  name: 'Preferred terminology',
  collection: 'none',
  run: ({ project, cwd, answers }) => run(answers, project, cwd),
});

/** A thrown error ends the command: the runner prints `❌ <message>` and exits 1. */
function run(options: PreferredTerminologyOptions, project: OpenedProject, cwd: string): CommandResult {
  const hasList = options.list === true;
  // A partial CLI rule cannot be represented as a core upsert. Keep only these flag-shape checks here.
  if (options.add !== undefined && options.remove !== undefined && options.preferred === undefined) {
    throw new Error('--add and --remove cannot be combined; run them separately');
  }
  if (
    options.add === undefined &&
    (options.preferred !== undefined || options.reason !== undefined) &&
    (options.remove !== undefined || hasList)
  ) {
    throw new Error('--preferred and --reason can only be used with --add');
  }
  if (options.add !== undefined && options.preferred === undefined) {
    throw new Error('--add requires --preferred <preferred>');
  }
  let result: PreferredTerminologyEditResult | undefined;
  try {
    const plan = planProjectTermsUpdate(project, {
      preferredTerminology: {
        list: hasList,
        ...(options.add !== undefined &&
          options.preferred !== undefined && {
            upsert: { discouraged: options.add, preferred: options.preferred, reason: options.reason },
          }),
        ...(options.remove !== undefined && { remove: options.remove }),
      },
    });
    const { preferredTerminology: loaded } = plan.view;
    if (loaded !== undefined) {
      const where = displayTermPath(loaded.filePath, cwd);
      if (loaded.warning) ConsoleFormatter.warning(loaded.warning);
      if (hasList) {
        ConsoleFormatter.section('Preferred Terminology');
        ConsoleFormatter.keyValue('File', where);
        if (loaded.error) throw new Error(loaded.error);
        if (loaded.rules.length === 0) ConsoleFormatter.indent('(none)');
        else for (const rule of loaded.rules) ConsoleFormatter.indent(formatRule(rule));
      }
      if (loaded.error) throw new Error(loaded.error);
    }
    result = plan.apply().preferredTerminologyResult;
  } catch (error) {
    if (error instanceof InvalidProjectTermsEditError) {
      const message = preferredEditWording[error.problem];
      if (message !== undefined) throw new Error(message);
    }
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
  if (result?.action && result.changedRule) {
    const verb = result.action === 'added' ? 'Added' : result.action === 'updated' ? 'Updated' : 'Removed';
    const where = displayTermPath(result.filePath, cwd);
    ConsoleFormatter.success(`${verb} preferred terminology rule: ${formatRule(result.changedRule)} (${where})`);
  }
}
