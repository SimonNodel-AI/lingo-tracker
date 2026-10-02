import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_FILENAME, type LingoTrackerConfig } from '@simoncodes-ca/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveResourceCommand } from './move';

describe('moveResourceCommand (real core)', () => {
  let projectDir: string;
  const originalInitCwd = process.env.INIT_CWD;

  beforeEach(() => {
    vi.clearAllMocks();
    projectDir = mkdtempSync(join(tmpdir(), 'lingo-cli-move-'));
    process.env.INIT_CWD = projectDir;
    process.exitCode = undefined;
    const config: LingoTrackerConfig = {
      exportFolder: 'dist/export',
      importFolder: 'dist/import',
      baseLocale: 'en',
      locales: ['en'],
      collections: { main: { translationsFolder: 'translations/main' } },
    };
    writeFileSync(join(projectDir, CONFIG_FILENAME), JSON.stringify(config));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    if (originalInitCwd === undefined) delete process.env.INIT_CWD;
    else process.env.INIT_CWD = originalInitCwd;
    process.exitCode = undefined;
  });

  it('prints the typed missing destination and exits 1', async () => {
    await moveResourceCommand({ collection: 'main', source: 'a.ok', dest: 'b.ok', destCollection: 'missing' });

    expect(console.error).toHaveBeenCalledWith('❌ Destination collection "missing" not found');
    expect(process.exitCode).toBe(1);
  });
});
