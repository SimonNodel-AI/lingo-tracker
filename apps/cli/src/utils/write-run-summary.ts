import * as fs from 'fs';
import { CommandOutput } from '../runner/command-output';
import { ConsoleFormatter } from './console-formatter';
import { buildSummaryPath } from './summary-path';

/** Writes a run's Markdown report to a CLI-owned temporary summary path. */
export function writeRunSummary(kind: 'import' | 'export', text: string, directory?: string): string {
  const summaryPath = buildSummaryPath(kind, directory);
  fs.writeFileSync(summaryPath, text, 'utf8');
  return summaryPath;
}

/**
 * Writes a run's summary and announces where it went. The summary is a by-product, so a
 * failed write only warns and never changes the run's exit code. A dry run writes nothing
 * (and never renders a lazy summary) unless `previewOnDryRun` is set, which also prints the
 * rendered text as the only preview of the run; it announces where the file would go.
 */
export function reportRunSummary(
  kind: 'import' | 'export',
  summary: string | (() => string),
  { dryRun, previewOnDryRun = false, directory }: { dryRun: boolean; previewOnDryRun?: boolean; directory?: string },
): void {
  const label = `${kind[0].toUpperCase()}${kind.slice(1)} summary`;
  CommandOutput.log('');
  if (dryRun) {
    CommandOutput.log(`${label} would be written to: ${buildSummaryPath(kind, directory)}`);
    if (previewOnDryRun) CommandOutput.log(typeof summary === 'function' ? summary() : summary);
    return;
  }
  try {
    CommandOutput.log(
      `${label} written to: ${writeRunSummary(kind, typeof summary === 'function' ? summary() : summary, directory)}`,
    );
  } catch (error) {
    ConsoleFormatter.warning(
      `Failed to write ${kind} summary file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
