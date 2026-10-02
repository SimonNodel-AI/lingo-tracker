import * as fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportRunSummary } from './write-run-summary';

vi.mock('fs', () => ({ writeFileSync: vi.fn() }));

describe('reportRunSummary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.writeFileSync).mockReset();
  });

  it('writes the summary and announces its path', () => {
    reportRunSummary('import', () => '# Summary', { dryRun: false });

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('lingo-tracker-import-summary'),
      '# Summary',
      'utf8',
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^Import summary written to: .*import-summary/));
  });

  it('accepts a plain string summary', () => {
    reportRunSummary('export', '# Plain', { dryRun: false });

    expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('export-summary'), '# Plain', 'utf8');
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^Export summary written to: /));
  });

  it('warns without throwing when the write fails', () => {
    vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    expect(() => reportRunSummary('export', '# Plain', { dryRun: false })).not.toThrow();
    expect(console.error).toHaveBeenCalledWith('⚠️  Failed to write export summary file: disk full');
  });

  it('warns without throwing when a lazy summary fails to render', () => {
    const summary = (): string => {
      throw new Error('render failed');
    };

    expect(() => reportRunSummary('import', summary, { dryRun: false })).not.toThrow();
    expect(console.error).toHaveBeenCalledWith('⚠️  Failed to write import summary file: render failed');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('writes and renders nothing on a dry run, only announcing the path', () => {
    const summary = vi.fn(() => '# Never');

    reportRunSummary('import', summary, { dryRun: true });

    expect(summary).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^Import summary would be written to: /));
  });

  it('prints the rendered summary after the path on a dry run with previewOnDryRun', () => {
    reportRunSummary('export', () => '# Preview', { dryRun: true, previewOnDryRun: true });

    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^Export summary would be written to: /));
    expect(console.log).toHaveBeenLastCalledWith('# Preview');
  });
});
