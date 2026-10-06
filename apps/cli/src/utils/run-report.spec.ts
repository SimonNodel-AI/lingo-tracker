import { describe, expect, it } from 'vitest';
import { withCommandOutput } from '../runner/command-output';
import { printRunReport, type RunReport } from './run-report';

function report(input: Partial<RunReport> = {}) {
  let stdout = '';
  let stderr = '';
  const result = withCommandOutput(
    {
      sink: {
        stdout: (text) => {
          stdout += text;
        },
        stderr: (text) => {
          stderr += text;
        },
      },
    },
    () => printRunReport({ warnings: [], errors: [], outcome: 'succeeded', ...input }),
  );
  return { result, stdout, stderr };
}

const items = (count: number): string[] => Array.from({ length: count }, (_, index) => `item ${index + 1}`);

describe('printRunReport', () => {
  it('prints nothing for empty lists', () => {
    expect(report()).toEqual({ result: undefined, stdout: '', stderr: '' });
  });

  it('prints counts on stdout in order', () => {
    expect(report({ counts: { Files: 2, Resources: 5 } }).stdout).toBe('  Files: 2\n  Resources: 5\n');
  });

  it('prints warnings only, bulleted on stderr', () => {
    const { stderr, stdout, result } = report({ warnings: ['one', 'two'] });
    expect(stderr).toBe('⚠️  Warnings (2):\n  - one\n  - two\n');
    expect(stdout).toBe('');
    expect(result).toBeUndefined();
  });

  it('prints errors only, bulleted on stderr', () => {
    const { stderr, result } = report({ errors: ['boom'], outcome: 'failed' });
    expect(stderr).toBe('❌ Errors (1):\n  - boom\n');
    expect(result).toEqual({ exitCode: 1 });
  });

  it('prints warnings before errors', () => {
    const { stderr } = report({ warnings: ['w'], errors: ['e'], outcome: 'failed' });
    expect(stderr).toBe('⚠️  Warnings (1):\n  - w\n❌ Errors (1):\n  - e\n');
  });

  it('prints a list of exactly ten in full even with a summary path', () => {
    const { stderr } = report({ warnings: items(10), summaryPath: '/tmp/summary.md' });
    expect(stderr).not.toContain('more');
    expect(stderr).toContain('  - item 10');
  });

  it('caps lists over ten and points at the summary when one was written', () => {
    const { stderr } = report({ warnings: items(12), errors: items(11), outcome: 'failed', summaryPath: '/tmp/s.md' });
    expect(stderr).toContain('Warnings (12):');
    expect(stderr).toContain('  - item 10\n  ... and 2 more (full list in /tmp/s.md)\n');
    expect(stderr).not.toContain('item 11\n  ... and 2');
    expect(stderr).toContain('Errors (11):');
    expect(stderr).toContain('  ... and 1 more (full list in /tmp/s.md)\n');
  });

  it('prints every item without a summary path', () => {
    const { stderr } = report({ errors: items(12), outcome: 'failed' });
    expect(stderr).toContain('  - item 12\n');
    expect(stderr).not.toContain('more');
  });

  it('prints every item in a dry run, which writes no summary file', () => {
    const { stderr } = report({ warnings: items(12), dryRun: true, summaryPath: '/tmp/s.md' });
    expect(stderr).toContain('  - item 12\n');
    expect(stderr).not.toContain('more');
  });

  it('returns the exit result for the outcome', () => {
    expect(report({ outcome: 'succeeded' }).result).toBeUndefined();
    expect(report({ outcome: 'failed' }).result).toEqual({ exitCode: 1 });
  });
  it('prints the declared JSON payload byte for byte, with diagnostics still on stderr', () => {
    const payload = { collections: [{ collectionName: 'main', entriesProcessed: 2 }], totals: { entriesProcessed: 2 } };
    const result = report({
      presentation: { kind: 'json', payload },
      counts: { 'Total entries processed': 2 },
      section: 'Summary',
      notice: 'Dry run completed - no changes were made.',
      warnings: ['warning'],
      errors: ['failure'],
      outcome: 'failed',
    });
    expect(result.stdout).toBe(`${JSON.stringify(payload, null, 2)}\n`);
    expect(result.stderr).toBe('⚠️  Warnings (1):\n  - warning\n❌ Errors (1):\n  - failure\n');
    expect(result.result).toEqual({ exitCode: 1 });
  });
  it('counts a multiline failure once and keeps its diagnostic details', () => {
    const result = report({ errors: ['Failure\nCause'], outcome: 'failed' });
    expect(result.stderr).toBe('❌ Errors (1):\n  - Failure\n  Cause\n');
    expect(result.result).toEqual({ exitCode: 1 });
  });
});
