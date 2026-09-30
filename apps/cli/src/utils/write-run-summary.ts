import * as fs from 'fs';
import { buildSummaryPath } from './summary-path';

/** Writes a run's Markdown report to a CLI-owned temporary summary path. */
export function writeRunSummary(kind: 'import' | 'export', text: string): string {
  const summaryPath = buildSummaryPath(kind);
  fs.writeFileSync(summaryPath, text, 'utf8');
  return summaryPath;
}
