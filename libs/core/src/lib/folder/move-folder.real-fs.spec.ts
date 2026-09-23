import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moveFolder } from './move-folder';

/**
 * Regression: a folder that could not be read (malformed tracker_meta.json) was silently skipped
 * while enumerating keys, so moveFolder deleted the source tree with that folder's entries never copied.
 */
describe('moveFolder with an unreadable folder (real fs)', () => {
  let root: string;

  const entries = JSON.stringify({ ok: { source: 'OK' } });

  function writeFolder(meta: string, ...segments: string[]): void {
    const folder = join(root, ...segments);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'resource_entries.json'), entries);
    writeFileSync(join(folder, 'tracker_meta.json'), meta);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'move-folder-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reports an error and moves or deletes nothing when one child folder has malformed metadata', async () => {
    writeFolder(JSON.stringify({ ok: { en: { checksum: 'x' } } }), 'apps', 'good');
    writeFolder('{ not json', 'apps', 'bad');

    const result = await moveFolder(root, { sourceFolderPath: 'apps', destinationFolderPath: 'shared' });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('apps.bad');
    expect(result.movedCount).toBe(0);
    expect(result.foldersDeleted).toBe(0);
    expect(existsSync(join(root, 'shared'))).toBe(false);
    expect(readFileSync(join(root, 'apps', 'good', 'resource_entries.json'), 'utf8')).toBe(entries);
    expect(readFileSync(join(root, 'apps', 'bad', 'resource_entries.json'), 'utf8')).toBe(entries);
  });

  it('does not delete a source folder whose only resources are unreadable', async () => {
    writeFolder('{ not json', 'apps', 'bad');

    const result = await moveFolder(root, { sourceFolderPath: 'apps.bad', destinationFolderPath: 'shared' });

    expect(result.errors).toHaveLength(1);
    expect(result.foldersDeleted).toBe(0);
    expect(readFileSync(join(root, 'apps', 'bad', 'resource_entries.json'), 'utf8')).toBe(entries);
  });
});
