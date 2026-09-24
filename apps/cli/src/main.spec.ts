import { afterEach, describe, expect, it, vi } from 'vitest';

// main.ts parses process.argv when imported and lazy-imports each command module;
// the command modules are replaced so only the flag wiring is under test.
vi.mock('./commands/validate', () => ({ validateCommand: vi.fn() }));
vi.mock('./add-resource/add-resource', () => ({ addResourceCommand: vi.fn() }));
vi.mock('./delete-collection/delete-collection', () => ({ deleteCollectionCommand: vi.fn() }));
vi.mock('./commands/move', () => ({ moveResourceCommand: vi.fn() }));

import { addResourceCommand } from './add-resource/add-resource';
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
    const calls = [validateCommand, addResourceCommand, deleteCollectionCommand, moveResourceCommand].map(
      (command) => vi.mocked(command).mock.calls.length,
    );
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
});
