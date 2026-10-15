import type { RunOutcome } from '@simoncodes-ca/core';
import { CommandOutput } from '../runner/command-output';
import type { CommandResult } from '../runner/command-runner';
import { printRunReport } from './run-report';
import { saveRunSummary } from './write-run-summary';

export interface ReportedRun {
  counts?: Readonly<Record<string, number>>;
  warnings: readonly string[];
  errors: readonly string[];
  outcome: RunOutcome;
  dryRun?: boolean;
  /** Optional Markdown summary, saved before printing the body. */
  summary?: {
    kind: 'import' | 'export';
    text: string | (() => string);
    directory?: string;
    previewOnDryRun?: boolean;
  };
  printBody?: () => void;
  /** Completion text printed after diagnostics, before the summary announcement. */
  printCompletion?: () => void;
}

/** Owns save summary → body → report → completion → announcement, including dry runs. */
export function reportRun({ summary, printBody, printCompletion, ...report }: ReportedRun): CommandResult {
  const saved = summary
    ? saveRunSummary(summary.kind, summary.text, {
        directory: summary.directory,
        previewOnDryRun: summary.previewOnDryRun,
        dryRun: Boolean(report.dryRun),
      })
    : undefined;
  printBody?.();
  const exit = printRunReport({ ...report, summaryPath: saved?.path });
  printCompletion?.();
  saved?.announce();
  return exit;
}

/** Verbose timestamps share one injected clock; start is called when the core run starts. */
export class RunTiming {
  private startedAt: number | undefined;

  constructor(
    private readonly now: () => number,
    private readonly enabled: boolean,
  ) {}

  start(): void {
    if (!this.enabled) return;
    this.startedAt = this.now();
    CommandOutput.log(`Started at: ${new Date(this.startedAt).toLocaleTimeString()}`);
  }

  complete(): void {
    if (this.startedAt === undefined) return;
    const endTime = this.now();
    const elapsedMilliseconds = endTime - this.startedAt;
    const elapsedSeconds = (elapsedMilliseconds / 1000).toFixed(2);
    CommandOutput.log(`\nCompleted at: ${new Date(endTime).toLocaleTimeString()}`);
    CommandOutput.log(`Elapsed time: ${elapsedSeconds}s (${elapsedMilliseconds}ms)`);
  }
}
