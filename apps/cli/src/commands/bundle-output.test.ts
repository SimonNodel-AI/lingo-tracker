import { afterEach, describe, expect, it } from 'vitest';
import { bundleCommand } from './bundle';
import { createCommandProject, type CommandProject } from '../testing/command-project';

const legacyWarning =
  "Warning: Bundle 'main': 'typeDist' is deprecated and will be removed in the next major version. Please rename to 'typeDistFile' in your .lingo-tracker.json config.";
const failure =
  "Type generation failed: typeDistFile must end with a .ts extension (e.g. './src/types/tokens.ts'), but got: types/invalid.txt";
const modes = [{}, { quiet: true }, { verbose: true }] as const;

describe('bundle type output with a real command project', () => {
  let project: CommandProject | undefined;
  afterEach(() => project?.cleanup());

  for (const status of ['written', 'skipped', 'failed', 'not-configured'] as const) {
    for (const legacy of [false, true]) {
      for (const mode of modes) {
        it(`preserves exact streams for ${status}, legacy=${legacy}, mode=${JSON.stringify(mode)}`, async () => {
          const typePath =
            status === 'not-configured' ? '' : status === 'failed' ? 'types/invalid.txt' : 'types/main.ts';
          project = createCommandProject({
            exportFolder: 'export',
            importFolder: 'import',
            baseLocale: 'en',
            locales: ['en'],
            collections: { main: { translationsFolder: 'resources' } },
            bundles: {
              main: {
                bundleName: '{locale}',
                dist: 'out',
                collections: 'All',
                ...(legacy ? { typeDist: typePath } : { typeDistFile: typePath }),
              },
            },
          });
          if (status !== 'skipped') await project.seed('hello', 'Hello');
          const result = await project.run(bundleCommand, { name: ['main'], ...mode });
          const quiet = 'quiet' in mode;
          const verbose = 'verbose' in mode;
          const display =
            status === 'written'
              ? '└─ Types: types/main.ts (1 keys)'
              : status === 'skipped'
                ? '└─ Types: Skipped (bundle is empty)'
                : '└─ Types: Skipped (no typeDistFile configured)';
          const stdout = quiet
            ? ''
            : '\n🔄 Generating bundle: main\n' +
              `  ✅ Files generated: ${status === 'skipped' ? 0 : 1}\n` +
              `  ✅ Locales: ${status === 'skipped' ? '' : 'en'}\n` +
              (status === 'failed' ? '' : `  ${display}\n`);
          const stderr =
            (legacy ? `${legacyWarning}\n` : '') +
            (status === 'failed' ? `❌ ${failure}\n` : '') +
            (status === 'skipped'
              ? `⚠️  Warnings: 1\n${verbose ? "  - Bundle 'main' for locale 'en' is empty\n" : ''}`
              : '');
          expect(result).toEqual({ stdout, stderr, exitCode: status === 'failed' ? 1 : 0 });
        });
      }
    }
  }

  for (const mode of modes) {
    it(`preserves multi-bundle warning totals, mode=${JSON.stringify(mode)}`, async () => {
      const legacy = {
        bundleName: '{locale}',
        dist: 'out',
        collections: 'All' as const,
        typeDist: 'types/invalid.txt',
      };
      project = createCommandProject({
        exportFolder: 'export',
        importFolder: 'import',
        baseLocale: 'en',
        locales: ['en'],
        collections: { main: { translationsFolder: 'resources' } },
        bundles: {
          main: legacy,
          second: { bundleName: '{locale}', dist: 'second', collections: 'All' },
        },
      });
      await project.seed('hello', 'Hello');
      const result = await project.run(bundleCommand, mode);
      const quiet = 'quiet' in mode;
      const stdout = quiet
        ? ''
        : '\n🔄 Generating bundle: main\n  ✅ Files generated: 1\n  ✅ Locales: en\n' +
          '\n🔄 Generating bundle: second\n  ✅ Files generated: 1\n  ✅ Locales: en\n' +
          '  └─ Types: Skipped (no typeDistFile configured)\n' +
          '\n📊 Summary (2 bundles)\n' +
          '─'.repeat(50) +
          '\n  Total files generated: 2\n';
      expect(result).toEqual({ stdout, stderr: `${legacyWarning}\n❌ ${failure}\n`, exitCode: 1 });
    });
  }
});
