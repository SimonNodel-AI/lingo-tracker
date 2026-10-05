import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { defineFlags, flagName } from './flag-record';
import { registerCommand } from './register-command';

const noRun = async () => undefined;

describe('command flag records', () => {
  it('maps several positional arguments and parsed flag values to one handler object', async () => {
    const calls: unknown[] = [];
    const flags = defineFlags<{ source: string; destination: string; tags?: string[]; limit?: number }>()({
      source: { argument: ['<source>', 'Source'] },
      destination: { argument: ['<destination>', 'Destination'] },
      tags: { flags: '--tags <tags>', list: 'optional' },
      limit: { flags: '--limit <n>', parse: Number, runtimeDefault: 5 },
    });
    const root = new Command();
    registerCommand(root, {
      name: 'copy',
      description: 'Copy',
      flags,
      load: async () => async (options) => {
        calls.push(options);
      },
    });
    await root.parseAsync(['copy', 'a', 'b', '--tags', ' x, , y '], { from: 'user' });
    expect(calls).toEqual([{ source: 'a', destination: 'b', tags: ['x', 'y'], limit: 5 }]);
  });

  it('maps renamed scalar, list and paired negated attributes without leaking Commander keys', async () => {
    const calls: unknown[] = [];
    const flags = defineFlags<{ resultLimit?: number; localeIDs?: string[]; transformICU?: boolean }>()({
      resultLimit: { flags: '--max-results <n>', parse: Number, runtimeDefault: 5 },
      localeIDs: { flags: '--locale-ids <ids>', list: 'optional', runtimeDefault: [] },
      transformICU: {
        flags: '--transform-icu',
        negative: { flags: '--no-transform-icu', description: 'Disable transformation' },
      },
    });
    const invoke = async (argv: string[]) => {
      const root = new Command();
      registerCommand(root, {
        name: 'convert',
        description: '',
        flags,
        load: async () => async (options) => {
          calls.push(options);
        },
      });
      await root.parseAsync(['convert', ...argv], { from: 'user' });
    };
    await invoke(['--max-results', '8', '--locale-ids', 'en,fr', '--transform-icu']);
    await invoke(['--no-transform-icu']);
    await invoke([]);
    expect(calls).toEqual([
      { resultLimit: 8, localeIDs: ['en', 'fr'], transformICU: true },
      { resultLimit: 5, localeIDs: [], transformICU: false },
      { resultLimit: 5, localeIDs: [] },
    ]);
  });

  it('creates fresh repeatable defaults for every registered command', async () => {
    const flags = defineFlags<{ tag?: string[] }>()({ tag: { flags: '--tag <tag>', list: 'repeatable' } });
    const root = new Command();
    const first = registerCommand(root, { name: 'first', description: '', flags, load: async () => noRun });
    const second = registerCommand(root, { name: 'second', description: '', flags, load: async () => noRun });
    first.parseOptions(['--tag', 'one']);
    expect(first.opts()).toEqual({ tag: ['one'] });
    expect(second.opts()).toEqual({ tag: [] });
  });

  it('derives the long spelling without aliases or placeholders', () => {
    expect(flagName({ flags: '-l, --locale-value <value>' })).toBe('--locale-value');
  });

  it('requires exactly the Options keys, including keys introduced by a spread', () => {
    const define = defineFlags<{ locale?: string }>();
    // @ts-expect-error Missing an Options key must fail compilation.
    define({});
    const extra = { unrelated: { flags: '--unrelated' } };
    // @ts-expect-error A record without an Options key must fail even through a spread.
    define({ locale: { flags: '--locale <locale>' }, ...extra });
    // @ts-expect-error List parsing and a custom parser cannot silently replace each other.
    define({ locale: { flags: '--locale <locale>', list: 'optional', parse: Number } });
    expect(define({ locale: { flags: '--locale <locale>' } }).locale.flags).toBe('--locale <locale>');
  });
});
