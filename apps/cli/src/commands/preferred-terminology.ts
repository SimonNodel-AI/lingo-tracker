import { relative } from 'node:path';
import {
  type LingoTrackerConfig,
  loadPreferredTerminology,
  PreferredTerminologyValidationError,
  writePreferredTerminology,
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

/** Renders an absolute path relative to the project root, for readable output. */
function displayPath(filePath: string, cwd: string): string {
  const rel = relative(cwd, filePath);
  return rel && !rel.startsWith('..') ? rel : filePath;
}

/** `Expenditure → Investment — reason`, without the reason suffix when there is none. */
function formatRule(rule: PreferredTermRule): string {
  const base = `${rule.discouraged} → ${rule.preferred}`;
  return rule.reason ? `${base} — ${rule.reason}` : base;
}

function sameTerm(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
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

  const result = loadPreferredTerminology(config, cwd);
  const where = displayPath(result.filePath, cwd);

  if (result.warning) {
    ConsoleFormatter.warning(result.warning);
  }

  if (hasList) {
    ConsoleFormatter.section('Preferred Terminology');
    ConsoleFormatter.keyValue('File', where);
    if (result.error) {
      throw new Error(result.error);
    }
    if (result.rules.length === 0) {
      ConsoleFormatter.indent('(none)');
    } else {
      for (const rule of result.rules) {
        ConsoleFormatter.indent(formatRule(rule));
      }
    }
  }

  if (!hasAdd && !hasRemove) return;

  // Writing would replace a file we could not read; make the user fix it first.
  if (result.error) {
    throw new Error(result.error);
  }

  const next = [...result.rules];
  let successMessage: string;

  if (hasRemove) {
    const term = options.remove ?? '';
    const index = next.findIndex((rule) => sameTerm(rule.discouraged, term));
    if (index === -1) {
      throw new Error(`No preferred terminology rule for "${term.trim()}" (${where})`);
    }
    const [removed] = next.splice(index, 1);
    successMessage = `Removed preferred terminology rule: ${formatRule(removed)} (${where})`;
  } else {
    // Upsert: a rule for the same discouraged term (any casing) is replaced entirely,
    // so omitting --reason on an update clears the previous reason.
    const rule: PreferredTermRule = {
      discouraged: (options.add ?? '').trim(),
      preferred: (options.preferred ?? '').trim(),
      ...(options.reason?.trim() ? { reason: options.reason.trim() } : {}),
    };
    const index = next.findIndex((existing) => sameTerm(existing.discouraged, rule.discouraged));
    if (index === -1) {
      next.push(rule);
      successMessage = `Added preferred terminology rule: ${formatRule(rule)} (${where})`;
    } else {
      next[index] = rule;
      successMessage = `Updated preferred terminology rule: ${formatRule(rule)} (${where})`;
    }
  }

  try {
    writePreferredTerminology(result.filePath, next);
  } catch (error) {
    if (error instanceof PreferredTerminologyValidationError) {
      ConsoleFormatter.error(
        'Preferred terminology not saved:',
        error.errors.map((ruleError) => {
          const row = next[ruleError.index];
          const label = row ? `"${row.discouraged} → ${row.preferred}"` : `row ${ruleError.index + 1}`;
          return `${label}: ${ruleError.message}`;
        }),
      );
      return { exitCode: 1 };
    }
    throw new Error(error instanceof Error ? error.message : String(error));
  }

  ConsoleFormatter.success(successMessage);
}
