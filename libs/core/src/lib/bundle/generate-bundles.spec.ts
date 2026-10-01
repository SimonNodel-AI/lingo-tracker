import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BundleDefinition } from '@simoncodes-ca/domain';
import { describe, expect, it } from 'vitest';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { seedResources, testCollection, useTempDir } from '../../testing/temp-dir.spec-helpers';
import type { MultipleBundleConstantNameError } from '../errors';
import { BundleNotFoundError } from '../errors';
import { generateBundles } from './generate-bundles';

describe('generateBundles', () => {
  const cwd = useTempDir('bundle-runs-');
  const config: LingoTrackerConfig = {
    exportFolder: 'export',
    importFolder: 'import',
    baseLocale: 'en',
    locales: ['en'],
    collections: {},
    bundles: {
      first: { bundleName: 'first-{locale}', dist: 'out', collections: 'All' },
      second: { bundleName: 'second-{locale}', dist: 'out', collections: 'All' },
    },
  };

  const populatedConfig = (): LingoTrackerConfig => {
    seedResources(testCollection(join(cwd(), 'resources'), { name: 'common', locales: ['en'] }), {
      hello: { source: 'Hello {name}' },
    });
    return { ...config, collections: { common: { translationsFolder: 'resources' } } };
  };

  it('runs all bundles and totals their outcomes', async () => {
    const result = await generateBundles(config, { cwd: cwd() });
    expect(result.outcomes.map(({ name }) => name)).toEqual(['first', 'second']);
    expect(result.outcome).toBe('succeeded');
    expect(result.outcomes.map((item) => item.outcome)).toEqual(['succeeded', 'succeeded']);
    expect(result.totals).toEqual({ bundlesProcessed: 2, filesGenerated: 0, warningsCount: 2 });
  });

  it('runs named bundles in request order', async () => {
    const result = await generateBundles(config, { names: ['second'], cwd: cwd() });
    expect(result.outcomes.map(({ name }) => name)).toEqual(['second']);
    expect(result.totals.bundlesProcessed).toBe(1);
  });

  it('returns the existing typed error for an unknown name and continues', async () => {
    const result = await generateBundles(config, { names: ['missing', 'first'], cwd: cwd() });
    expect(result.outcomes[0]?.error).toBeInstanceOf(BundleNotFoundError);
    expect(result.outcome).toBe('failed');
    expect(result.outcomes.map((item) => item.outcome)).toEqual(['failed', 'succeeded']);
    expect((result.outcomes[0]?.error as BundleNotFoundError).message).toBe('Bundle "missing" not found');
    expect(result.totals.bundlesProcessed).toBe(1);
  });

  it('fails when every selected bundle fails', async () => {
    const result = await generateBundles(config, { names: ['missing'], cwd: cwd() });
    expect(result.outcome).toBe('failed');
    expect(result.outcomes[0]?.outcome).toBe('failed');
  });

  it('reports failed type generation on the bundle and whole run', async () => {
    const populated = populatedConfig();
    const result = await generateBundles(
      {
        ...populated,
        bundles: {
          first: { bundleName: 'first-{locale}', dist: 'out', collections: 'All', typeDistFile: 'types/invalid.txt' },
        },
      },
      { cwd: cwd() },
    );
    expect(result.outcomes[0]?.result?.typeOutcome.status).toBe('failed');
    expect(result.outcomes[0]?.outcome).toBe('failed');
    expect(result.outcome).toBe('failed');
  });

  it('keeps a saved bundle running when one named collection is gone', async () => {
    const populated = populatedConfig();
    const result = await generateBundles(
      {
        ...populated,
        bundles: {
          first: {
            bundleName: 'first-{locale}',
            dist: 'out',
            collections: [
              { name: 'deleted', entriesSelectionRules: 'All' },
              { name: 'common', entriesSelectionRules: 'All' },
            ],
          },
        },
      },
      { names: ['first'], cwd: cwd() },
    );

    expect(result.outcomes[0]?.error).toBeUndefined();
    expect(result.outcomes[0]?.result?.warnings).toEqual(["Collection 'deleted' not found in config"]);
    expect(result.outcomes[0]?.result?.writtenFiles).toEqual(['out/first-en.json']);
    expect(result.totals).toEqual({ bundlesProcessed: 1, filesGenerated: 1, warningsCount: 1 });
    expect(existsSync(join(cwd(), 'out/first-en.json'))).toBe(true);
  });

  it('refuses a constant-name override for more than one bundle before writing', async () => {
    await expect(
      generateBundles(config, { cwd: cwd(), overrides: { tokenConstantName: 'TOKENS' } }),
    ).rejects.toMatchObject({
      name: 'MultipleBundleConstantNameError',
      message: 'Cannot use --token-constant-name with multiple bundles. Please target a single bundle.',
    } satisfies Partial<MultipleBundleConstantNameError>);
  });

  it('continues after one bundle write fails and totals only successes', async () => {
    writeFileSync(join(cwd(), 'blocked'), 'a file');
    const populated = populatedConfig();
    const result = await generateBundles(
      {
        ...populated,
        bundles: {
          first: { bundleName: 'first-{locale}', dist: 'blocked', collections: 'All' },
          second: { bundleName: 'second-{locale}', dist: 'out', collections: 'All' },
        },
      },
      { cwd: cwd() },
    );

    expect(result.outcomes[0]?.error).toBeInstanceOf(Error);
    expect(result.outcome).toBe('failed');
    expect(result.outcomes[1]?.result?.filesGenerated).toBe(1);
    expect(result.totals).toEqual({ bundlesProcessed: 1, filesGenerated: 1, warningsCount: 0 });
    expect(existsSync(join(cwd(), 'out/second-en.json'))).toBe(true);
  });

  it('emits start, returned type warning, then result in order', async () => {
    const populated = populatedConfig();
    const legacy = {
      bundleName: 'first-{locale}',
      dist: 'out',
      collections: 'All' as const,
      typeDist: 'types/first.ts',
    };
    const events: string[] = [];

    await generateBundles(
      { ...populated, bundles: { first: legacy } },
      {
        names: ['first'],
        cwd: cwd(),
        onEvent: (event) => events.push(event.kind),
      },
    );

    expect(events).toEqual(['start', 'type-warning', 'result']);
  });

  it('emits the prepared type warning when a bundle write fails', async () => {
    writeFileSync(join(cwd(), 'blocked'), 'a file');
    const events: Array<{ kind: string; warning?: string }> = [];
    const legacy = {
      bundleName: 'first-{locale}',
      dist: 'blocked',
      collections: 'All',
      typeDist: 'types/first.ts',
    } as BundleDefinition;
    const result = await generateBundles(
      {
        ...populatedConfig(),
        bundles: { first: legacy },
      },
      {
        names: ['first'],
        cwd: cwd(),
        onEvent: (event) => events.push(event),
      },
    );

    expect(result.outcomes[0]?.error).toBeInstanceOf(Error);
    expect(events.map((event) => event.kind)).toEqual(['start', 'type-warning', 'result']);
    expect(events[1]?.warning).toContain("Bundle 'first': 'typeDist' is deprecated");
  });

  it('forwards overrides and allows a constant name for one named bundle', async () => {
    const populated = populatedConfig();
    const result = await generateBundles(
      {
        ...populated,
        bundles: {
          first: { bundleName: 'first-{locale}', dist: 'out', collections: 'All', typeDistFile: 'types/first.ts' },
        },
      },
      {
        names: ['first'],
        cwd: cwd(),
        locales: ['en'],
        overrides: { tokenCasing: 'camelCase', transformICUToTransloco: false, tokenConstantName: 'MY_TOKENS' },
      },
    );

    expect(result.totals.filesGenerated).toBe(1);
    expect(readFileSync(join(cwd(), 'out/first-en.json'), 'utf8')).toContain('Hello {name}');
    expect(readFileSync(join(cwd(), 'types/first.ts'), 'utf8')).toContain('export const MY_TOKENS');
    expect(readFileSync(join(cwd(), 'types/first.ts'), 'utf8')).toContain("hello: 'hello'");
  });

  it('totals files from every non-empty bundle', async () => {
    const result = await generateBundles(populatedConfig(), { cwd: cwd() });
    expect(result.totals).toEqual({ bundlesProcessed: 2, filesGenerated: 2, warningsCount: 0 });
  });

  it('propagates a start event callback error', async () => {
    await expect(
      generateBundles(config, {
        cwd: cwd(),
        onEvent: () => {
          throw new Error('printer failed');
        },
      }),
    ).rejects.toThrow('printer failed');
  });
});
