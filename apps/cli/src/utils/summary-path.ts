import * as path from 'path';
import * as os from 'os';

export function buildSummaryPath(type: 'import' | 'export', directory = os.tmpdir()): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(directory, `lingo-tracker-${type}-summary-${timestamp}.md`);
}
