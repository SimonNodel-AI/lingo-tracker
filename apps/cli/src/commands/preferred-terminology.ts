import {
  displayTermPath,
  type OpenedProject,
  planProjectTermsUpdate,
  preferredTerminologyRequestFromFlags,
} from '@simoncodes-ca/core';
import type { PreferredTermRule } from '@simoncodes-ca/domain';
import { defineCommand } from '../runner/command-runner';
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
  run: ({ project, cwd, answers }) => run(answers, project, cwd),
});

/** A thrown error ends the command: the runner prints `❌ <message>` and exits 1. */
function run(options: PreferredTerminologyOptions, project: OpenedProject, cwd: string): void {
  const hasList = options.list === true;
  const plan = planProjectTermsUpdate(project, {
    preferredTerminology: preferredTerminologyRequestFromFlags(options),
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
  const result = plan.apply().preferredTerminologyResult;

  if (result?.action && result.changedRule) {
    const verb = result.action === 'added' ? 'Added' : result.action === 'updated' ? 'Updated' : 'Removed';
    const where = displayTermPath(result.filePath, cwd);
    ConsoleFormatter.success(`${verb} preferred terminology rule: ${formatRule(result.changedRule)} (${where})`);
  }
}
