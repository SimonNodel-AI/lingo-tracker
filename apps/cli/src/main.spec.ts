import { afterEach, describe, expect, it, vi } from 'vitest';

// main.ts parses process.argv when imported and lazy-imports each command module;
// the command modules are replaced so only the flag wiring is under test.
vi.mock('./commands/validate', () => ({ validateCommand: vi.fn() }));
vi.mock('./add-resource/add-resource', () => ({ addResourceCommand: vi.fn() }));
vi.mock('./delete-collection/delete-collection', () => ({ deleteCollectionCommand: vi.fn() }));
vi.mock('./commands/move', () => ({ moveResourceCommand: vi.fn() }));
vi.mock('./commands/find-similar', () => ({ findSimilarCommand: vi.fn() }));
vi.mock('./commands/import-cmd', () => ({ importCommand: vi.fn() }));

import { addResourceCommand } from './add-resource/add-resource';
import { findSimilarCommand } from './commands/find-similar';
import { importCommand } from './commands/import-cmd';
import { moveResourceCommand } from './commands/move';
import { validateCommand } from './commands/validate';
import { deleteCollectionCommand } from './delete-collection/delete-collection';

const originalArgv = process.argv;

/** Imports main.ts afresh with these arguments and waits for the lazy action to finish. */
async function runCli(...args: string[]): Promise<void> {
  process.argv = ['node', 'lingo-tracker', ...args];
  vi.resetModules();
  await import('./main');
  await vi.waitFor(() => {
    const calls = [
      validateCommand,
      addResourceCommand,
      deleteCollectionCommand,
      moveResourceCommand,
      findSimilarCommand,
      importCommand,
    ].map((command) => vi.mocked(command).mock.calls.length);
    if (calls.every((count) => count === 0)) {
      throw new Error('command not called yet');
    }
  });
}

describe('main.ts flag wiring', () => {
  afterEach(() => {
    process.argv = originalArgv;
    vi.clearAllMocks();
  });

  it('passes --skip-placeholders to validate', async () => {
    await runCli('validate', '--skip-placeholders', '--skip-locales', 'fr,de');

    expect(validateCommand).toHaveBeenCalledWith({
      allowTranslated: false,
      skipLocales: ['fr', 'de'],
      skipIcu: false,
      skipPlaceholders: true,
      requirePortablePlurals: false,
    });
  });

  it('passes the raw --translations string to add-resource (parsed inside the command)', async () => {
    await runCli('add-resource', '--key', 'a.b', '--value', 'OK', '--translations', '[{"locale":');

    expect(addResourceCommand).toHaveBeenCalledWith(expect.objectContaining({ translations: '[{"locale":' }));
  });

  it('passes --override to add-resource', async () => {
    await runCli('add-resource', '--key', 'a.b', '--value', 'OK', '--override');

    expect(addResourceCommand).toHaveBeenCalledWith(expect.objectContaining({ override: true }));
  });

  it('passes --yes to delete-collection', async () => {
    await runCli('delete-collection', '--collection-name', 'app', '--yes');

    expect(deleteCollectionCommand).toHaveBeenCalledWith({ collectionName: 'app', yes: true });
  });

  it('passes --dest-collection to move', async () => {
    await runCli('move', '--collection', 'main', '--source', 'a.ok', '--dest', 'b.ok', '--dest-collection', 'admin');

    expect(moveResourceCommand).toHaveBeenCalledWith({
      collection: 'main',
      source: 'a.ok',
      dest: 'b.ok',
      destCollection: 'admin',
    });
  });

  it('converts --max-results before calling find-similar', async () => {
    await runCli('find-similar', '--collection', 'main', '--value', 'Hello', '--max-results', '8');

    expect(findSimilarCommand).toHaveBeenCalledWith({ collection: 'main', value: 'Hello', maxResults: 8 });
  });

  it('keeps the default --max-results value passed to find-similar', async () => {
    await runCli('find-similar', '--value', 'Hello');

    expect(findSimilarCommand).toHaveBeenCalledWith({ value: 'Hello', maxResults: 5 });
  });

  it.each(['8.9', '8suffix', ' 8 '])('keeps parseInt conversion for --max-results %j', async (value) => {
    await runCli('find-similar', '--value', 'Hello', '--max-results', value);

    expect(findSimilarCommand).toHaveBeenCalledWith({ value: 'Hello', maxResults: 8 });
  });

  it.each(['invalid', '', 'NaN'])('rejects non-numeric --max-results %j before calling find-similar', async (value) => {
    await expect(runCli('find-similar', '--value', 'Hello', '--max-results', value)).rejects.toThrow(
      `--max-results must be a number, got "${value}"`,
    );

    expect(findSimilarCommand).not.toHaveBeenCalled();
  });

  it('leaves the import strategy and migration flags unset for command resolution', async () => {
    await runCli('import', '--source', 'file.json', '--locale', 'fr');

    expect(importCommand).toHaveBeenCalledWith({
      source: 'file.json',
      locale: 'fr',
      dryRun: false,
      verbose: false,
    });
  });

  it('passes --no-validate-base as false', async () => {
    await runCli('import', '--source', 'file.json', '--locale', 'fr', '--no-validate-base');

    expect(importCommand).toHaveBeenCalledWith(expect.objectContaining({ validateBase: false }));
  });
});
