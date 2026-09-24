import { afterEach, describe, expect, it, vi } from 'vitest';

// main.ts parses process.argv when imported and lazy-imports each command module;
// the command modules are replaced so only the flag wiring is under test.
vi.mock('./commands/validate', () => ({ validateCommand: vi.fn() }));
vi.mock('./add-resource/add-resource', () => ({ addResourceCommand: vi.fn() }));

import { addResourceCommand } from './add-resource/add-resource';
import { validateCommand } from './commands/validate';

const originalArgv = process.argv;

/** Imports main.ts afresh with these arguments and waits for the lazy action to finish. */
async function runCli(...args: string[]): Promise<void> {
  process.argv = ['node', 'lingo-tracker', ...args];
  vi.resetModules();
  await import('./main');
  await vi.waitFor(() => {
    if (vi.mocked(validateCommand).mock.calls.length + vi.mocked(addResourceCommand).mock.calls.length === 0) {
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
});
