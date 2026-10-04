import type { RunOutcome } from '@simoncodes-ca/core';
import { exitForRunOutcome } from '../runner/run-outcome';
import type { CommandResult } from '../runner/command-runner';
import { ConsoleFormatter } from './console-formatter';

/** Longest warnings or errors list printed in full when a run summary file holds the rest. */
export const RUN_REPORT_LIST_LIMIT = 10;

export interface RunReport {
  /** Labeled totals printed first, in order, on stdout. */
  counts?: Readonly<Record<string, number>>;
  warnings: readonly string[];
  errors: readonly string[];
  outcome: RunOutcome;
  /** A dry run writes no summary file, so its lists are never capped. */
  dryRun?: boolean;
  /** Where the command wrote its run summary; only then may a long list be capped. */
  summaryPath?: string;
}

/**
 * Prints a run's counts, warnings and errors the same way for every command and returns
 * its exit result. Warnings and errors go to stderr as `Warnings (N):` / `Errors (N):`
 * with `- ` bullets. A list over {@link RUN_REPORT_LIST_LIMIT} is capped only when the
 * full list is in the run summary file; otherwise every item is printed.
 */
export function printRunReport({ counts, warnings, errors, outcome, dryRun, summaryPath }: RunReport): CommandResult {
  for (const [label, value] of Object.entries(counts ?? {})) ConsoleFormatter.keyValue(label, value);
  const fullListPath = dryRun ? undefined : summaryPath;
  if (warnings.length > 0)
    ConsoleFormatter.warning(`Warnings (${warnings.length}):`, bulletList(warnings, fullListPath));
  if (errors.length > 0) ConsoleFormatter.error(`Errors (${errors.length}):`, bulletList(errors, fullListPath));
  return exitForRunOutcome(outcome);
}

function bulletList(items: readonly string[], fullListPath: string | undefined): string[] {
  const shown = fullListPath && items.length > RUN_REPORT_LIST_LIMIT ? items.slice(0, RUN_REPORT_LIST_LIMIT) : items;
  const lines = shown.map((item) => `- ${item}`);
  if (shown.length < items.length)
    lines.push(`... and ${items.length - shown.length} more (full list in ${fullListPath})`);
  return lines;
}
