import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BundleDefinition } from '@simoncodes-ca/domain';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import type { Collection } from '../config/open-collection';
import { type SeedResource, seedResources, testCollection, useTempDir } from '../../testing/temp-dir.spec-helpers';
import { type BundleProgressEvent, generateBundle } from './generate-bundle';

describe('generateBundle (real fs)', () => {
  const root = useTempDir('bundle-generate-');

  afterEach(() => vi.restoreAllMocks());

  function seed(name: string, resources: Record<string, SeedResource>, overrides: Partial<Collection> = {}): string {
    const folder = join(root(), name);
    seedResources(testCollection(folder, { name, ...overrides }), resources);
    return folder;
  }

  function config(
    collections: Record<string, string>,
    overrides: Partial<LingoTrackerConfig> = {},
  ): LingoTrackerConfig {
    return {
      exportFolder: 'dist/export',
      importFolder: 'dist/import',
      baseLocale: 'en',
      locales: ['en', 'fr', 'es'],
      collections: Object.fromEntries(
        Object.entries(collections).map(([name, translationsFolder]) => [name, { translationsFolder }]),
      ),
      ...overrides,
    };
  }

  function definition(overrides: Partial<BundleDefinition> = {}): BundleDefinition {
    return { bundleName: '{locale}', dist: 'dist/bundles', collections: 'All', ...overrides };
  }

  function readJson(path: string): Record<string, unknown> {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  }

  it('generates every configured locale by default', async () => {
    const common = seed('common', {
      welcome: { source: 'Welcome', translations: { fr: 'Bienvenue', es: 'Bienvenido' } },
    });

    const result = await generateBundle({
      bundleKey: 'main',
      bundleDefinition: definition(),
      config: config({ common }),
      cwd: root(),
    });

    expect(result.filesGenerated).toBe(3);
    expect(result.localesProcessed).toEqual(['en', 'fr', 'es']);
    expect(result.warnings).toEqual([]);
  });

  it('generates only the requested locale subset', async () => {
    const common = seed('common', {
      welcome: { source: 'Welcome', translations: { fr: 'Bienvenue', es: 'Bienvenido' } },
    });
    const result = await generateBundle({
      bundleKey: 'main',
      bundleDefinition: definition(),
      config: config({ common }),
      locales: ['en', 'fr'],
      cwd: root(),
    });

    expect(result.filesGenerated).toBe(2);
    expect(result.localesProcessed).toEqual(['en', 'fr']);
    expect(existsSync(join(root(), 'dist/bundles/es.json'))).toBe(false);
  });

  it('warns for every empty locale and generates no files', async () => {
    const result = await generateBundle({
      bundleKey: 'main',
      bundleDefinition: definition(),
      config: config({}),
      cwd: root(),
    });

    expect(result.filesGenerated).toBe(0);
    expect(result.warnings).toContain("Bundle 'main' for locale 'en' is empty");
    expect(result.warnings).toContain("Bundle 'main' for locale 'fr' is empty");
    expect(result.warnings).toContain("Bundle 'main' for locale 'es' is empty");
  });

  it('warns for a missing collection once per run rather than once per locale', async () => {
    const common = seed('common', {
      welcome: { source: 'Welcome', translations: { fr: 'Bienvenue' } },
    });
    const result = await generateBundle({
      bundleKey: 'main',
      bundleDefinition: definition({
        collections: [
          { name: 'nonexistent', entriesSelectionRules: 'All' },
          { name: 'common', entriesSelectionRules: 'All' },
        ],
      }),
      config: config({ common }, { locales: ['en', 'fr'] }),
      cwd: root(),
    });

    expect(
      result.warnings.filter((warning) => warning === "Collection 'nonexistent' not found in config"),
    ).toHaveLength(1);
  });

  it('uses {locale} in a filename', async () => {
    const common = seed('common', { welcome: { source: 'Welcome' } });
    await generateBundle({
      bundleKey: 'main',
      bundleDefinition: definition({ bundleName: 'main.{locale}' }),
      config: config({ common }),
      locales: ['en'],
      cwd: root(),
    });

    expect(existsSync(join(root(), 'dist/bundles/main.en.json'))).toBe(true);
  });

  it('uses {locale} in a subdirectory and creates missing output directories', async () => {
    const common = seed('common', { welcome: { source: 'Welcome' } });
    await generateBundle({
      bundleKey: 'main',
      bundleDefinition: definition({ bundleName: '{locale}/main' }),
      config: config({ common }),
      locales: ['en'],
      cwd: root(),
    });

    expect(existsSync(join(root(), 'dist/bundles/en/main.json'))).toBe(true);
  });

  it('writes two-space-formatted JSON with nested dot-key hierarchy', async () => {
    const common = seed('common', {
      'buttons.ok': { source: 'OK' },
      'buttons.cancel': { source: 'Cancel' },
    });
    await generateBundle({
      bundleKey: 'main',
      bundleDefinition: definition(),
      config: config({ common }),
      locales: ['en'],
      cwd: root(),
    });

    const expected = { buttons: { ok: 'OK', cancel: 'Cancel' } };
    expect(readFileSync(join(root(), 'dist/bundles/en.json'), 'utf8')).toBe(JSON.stringify(expected, null, 2));
  });

  it('resolves relative dist and typeDistFile paths against cwd', async () => {
    const common = seed('common', { welcome: { source: 'Welcome' } });
    const result = await generateBundle({
      bundleKey: 'main',
      bundleDefinition: definition({ typeDistFile: 'types/tokens.ts' }),
      config: config({ common }),
      locales: ['en'],
      cwd: root(),
    });

    expect(existsSync(join(root(), 'dist/bundles/en.json'))).toBe(true);
    expect(existsSync(join(root(), 'types/tokens.ts'))).toBe(true);
    expect(result.typeGenerationResult?.typeDistFile).toBe(join(root(), 'types/tokens.ts'));
  });

  it('uses cwd to resolve a relative collection translationsFolder', async () => {
    seed('translations/common', { welcome: { source: 'Welcome' } });
    const result = await generateBundle({
      bundleKey: 'main',
      bundleDefinition: definition(),
      config: config({ common: 'translations/common' }),
      locales: ['en'],
      cwd: root(),
    });

    expect(result.filesGenerated).toBe(1);
    expect(readJson(join(root(), 'dist/bundles/en.json'))).toEqual({ welcome: 'Welcome' });
  });

  describe('type generation', () => {
    it('writes types and reports the generated file and key count when configured', async () => {
      const common = seed('common', { 'buttons.ok': { source: 'OK' }, 'buttons.cancel': { source: 'Cancel' } });
      const result = await generateBundle({
        bundleKey: 'main',
        bundleDefinition: definition({ typeDistFile: 'types/main.ts' }),
        config: config({ common }),
        locales: ['en'],
        cwd: root(),
      });

      expect(result.typeGenerationResult).toBeDefined();
      expect(result.typeGenerationResult).toMatchObject({ fileGenerated: true, keysCount: 2 });
      expect(result.typeGenerationResult?.typeDistFile).toBe(join(root(), 'types/main.ts'));
      expect(existsSync(join(root(), 'types/main.ts'))).toBe(true);
    });

    it('does not run type generation when no type output is configured', async () => {
      const common = seed('common', { welcome: { source: 'Welcome' } });
      const result = await generateBundle({
        bundleKey: 'main',
        bundleDefinition: definition(),
        config: config({ common }),
        locales: ['en'],
        cwd: root(),
      });

      expect(result.typeGenerationResult).toBeUndefined();
    });

    it('supports deprecated typeDist and emits its deprecation warning', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const common = seed('common', { welcome: { source: 'Welcome' } });
      const legacy = { ...definition(), typeDist: 'types/legacy.ts' } as unknown as BundleDefinition;
      const result = await generateBundle({
        bundleKey: 'main',
        bundleDefinition: legacy,
        config: config({ common }),
        locales: ['en'],
        cwd: root(),
      });

      expect(result.typeGenerationResult?.fileGenerated).toBe(true);
      expect(existsSync(join(root(), 'types/legacy.ts'))).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("'typeDist' is deprecated"));
    });

    it('uses typeDistFile without warning when current and deprecated keys are both present', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const common = seed('common', { welcome: { source: 'Welcome' } });
      const withBoth = {
        ...definition({ typeDistFile: 'types/current.ts' }),
        typeDist: 'types/legacy.ts',
      } as unknown as BundleDefinition;
      await generateBundle({
        bundleKey: 'main',
        bundleDefinition: withBoth,
        config: config({ common }),
        locales: ['en'],
        cwd: root(),
      });

      expect(existsSync(join(root(), 'types/current.ts'))).toBe(true);
      expect(existsSync(join(root(), 'types/legacy.ts'))).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    });

    it('passes tokenConstantName to the generated file', async () => {
      const common = seed('common', { welcome: { source: 'Welcome' } });
      await generateBundle({
        bundleKey: 'main',
        bundleDefinition: definition({ typeDistFile: 'types/main.ts' }),
        config: config({ common }),
        locales: ['en'],
        tokenConstantName: 'CUSTOM_TOKENS',
        cwd: root(),
      });

      expect(readFileSync(join(root(), 'types/main.ts'), 'utf8')).toContain('export const CUSTOM_TOKENS');
    });

    it('captures thrown type generation errors as warnings', async () => {
      const common = seed('common', { welcome: { source: 'Welcome' } });
      writeFileSync(join(root(), 'blocked'), 'not a directory');
      const result = await generateBundle({
        bundleKey: 'main',
        bundleDefinition: definition({ typeDistFile: 'blocked/tokens.ts' }),
        config: config({ common }),
        locales: ['en'],
        cwd: root(),
      });

      expect(result.typeGenerationResult).toBeUndefined();
      expect(result.warnings.some((warning) => warning.startsWith("Type generation failed for 'main':"))).toBe(true);
    });

    it('reports an empty type key set as a bundle warning', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const empty = join(root(), 'empty');
      const result = await generateBundle({
        bundleKey: 'main',
        bundleDefinition: definition({ typeDistFile: 'types/main.ts' }),
        config: config({ empty }, { locales: [] }),
        cwd: root(),
      });

      expect(result.typeGenerationResult?.skippedReason).toBe('empty-bundle');
      expect(result.warnings).toContain("Type generation skipped for 'main': Bundle is empty");
      expect(existsSync(join(root(), 'types/main.ts'))).toBe(false);
    });

    it.each([
      {
        name: 'CLI parameter over bundle and global config',
        parameter: 'camelCase' as const,
        bundle: 'upperCase' as const,
        global: 'upperCase' as const,
        expected: 'buttons: {',
      },
      {
        name: 'bundle config over global config',
        parameter: undefined,
        bundle: 'camelCase' as const,
        global: 'upperCase' as const,
        expected: 'buttons: {',
      },
      {
        name: 'global config when no higher override exists',
        parameter: undefined,
        bundle: undefined,
        global: 'camelCase' as const,
        expected: 'buttons: {',
      },
      {
        name: 'upperCase by default',
        parameter: undefined,
        bundle: undefined,
        global: undefined,
        expected: 'BUTTONS: {',
      },
    ])('uses $name for token casing', async ({ parameter, bundle, global, expected }) => {
      const common = seed('common', { 'buttons.ok': { source: 'OK' } });
      await generateBundle({
        bundleKey: 'main',
        bundleDefinition: definition({ typeDistFile: 'types/main.ts', tokenCasing: bundle }),
        config: config({ common }, { tokenCasing: global }),
        locales: ['en'],
        tokenCasing: parameter,
        cwd: root(),
      });

      expect(readFileSync(join(root(), 'types/main.ts'), 'utf8')).toContain(expected);
    });
  });

  describe('progress and key counts', () => {
    it('emits ordered 1-based progress events with configured output paths', async () => {
      const common = seed('common', {
        welcome: { source: 'Welcome', translations: { fr: 'Bienvenue' } },
      });
      const events: BundleProgressEvent[] = [];
      const bundleDefinition = definition({ bundleName: 'main.{locale}' });
      await generateBundle({
        bundleKey: 'main',
        bundleDefinition,
        config: config({ common }),
        locales: ['en', 'fr'],
        onProgress: (event) => events.push(event),
        cwd: root(),
      });

      expect(events).toEqual([
        { locale: 'en', index: 1, total: 2, file: 'dist/bundles/main.en.json' },
        { locale: 'fr', index: 2, total: 2, file: 'dist/bundles/main.fr.json' },
      ]);
    });

    it('counts the debug locale in progress and emits it last', async () => {
      const common = seed('common', { welcome: { source: 'Welcome' } });
      const events: BundleProgressEvent[] = [];
      const bundleDefinition = definition();
      await generateBundle({
        bundleKey: 'main',
        bundleDefinition,
        config: config({ common }),
        locales: ['en'],
        debugKeysLocale: '99',
        onProgress: (event) => events.push(event),
        cwd: root(),
      });

      expect(events).toEqual([
        { locale: 'en', index: 1, total: 2, file: 'dist/bundles/en.json' },
        { locale: '99', index: 2, total: 2, file: 'dist/bundles/99.json' },
      ]);
    });

    it('emits progress for a locale that turns out empty', async () => {
      const events: BundleProgressEvent[] = [];
      await generateBundle({
        bundleKey: 'main',
        bundleDefinition: definition(),
        config: config({}),
        locales: ['en'],
        onProgress: (event) => events.push(event),
        cwd: root(),
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ locale: 'en', index: 1, total: 1 });
    });

    it('reports key counts for each processed locale', async () => {
      const common = seed('common', {
        one: { source: 'One', translations: { fr: 'Un' } },
        two: { source: 'Two', translations: { fr: 'Deux' } },
      });
      const result = await generateBundle({
        bundleKey: 'main',
        bundleDefinition: definition(),
        config: config({ common }),
        locales: ['en', 'fr'],
        cwd: root(),
      });

      expect(result.keysPerLocale).toEqual({ en: 2, fr: 2 });
    });

    it('omits empty locales from key counts and includes the debug locale', async () => {
      const common = seed('common', { one: { source: 'One' } });
      const result = await generateBundle({
        bundleKey: 'main',
        bundleDefinition: definition(),
        config: config({ common }),
        locales: ['en', 'fr'],
        debugKeysLocale: '99',
        cwd: root(),
      });

      expect(result.keysPerLocale).toEqual({ en: 1, '99': 1 });
    });
  });

  describe('debugKeysLocale', () => {
    it('emits one extra file whose values equal their keys', async () => {
      const common = seed('common', {
        'buttons.ok': { source: 'OK' },
        'buttons.cancel': { source: 'Cancel' },
      });
      const result = await generateBundle({
        bundleKey: 'main',
        bundleDefinition: definition(),
        config: config({ common }),
        locales: ['en'],
        debugKeysLocale: '99',
        cwd: root(),
      });

      expect(result.filesGenerated).toBe(2);
      expect(readJson(join(root(), 'dist/bundles/99.json'))).toEqual({
        buttons: { ok: 'buttons.ok', cancel: 'buttons.cancel' },
      });
    });

    it('uses prefixed bundled keys as debug values', async () => {
      const common = seed('common', { 'buttons.ok': { source: 'OK' } });
      await generateBundle({
        bundleKey: 'main',
        bundleDefinition: definition({
          collections: [{ name: 'common', entriesSelectionRules: 'All', bundledKeyPrefix: 'shared' }],
        }),
        config: config({ common }),
        locales: [],
        debugKeysLocale: 'debug',
        cwd: root(),
      });

      expect(readJson(join(root(), 'dist/bundles/debug.json'))).toEqual({
        shared: { buttons: { ok: 'shared.buttons.ok' } },
      });
    });

    it('uses a custom locale code in the filename', async () => {
      const common = seed('common', { welcome: { source: 'Welcome' } });
      await generateBundle({
        bundleKey: 'main',
        bundleDefinition: definition({ bundleName: 'main.{locale}' }),
        config: config({ common }),
        locales: [],
        debugKeysLocale: 'keys',
        cwd: root(),
      });

      expect(existsSync(join(root(), 'dist/bundles/main.keys.json'))).toBe(true);
    });

    it('warns and writes no debug file for an empty bundle', async () => {
      const result = await generateBundle({
        bundleKey: 'main',
        bundleDefinition: definition(),
        config: config({}),
        locales: [],
        debugKeysLocale: '99',
        cwd: root(),
      });

      expect(result.warnings).toContain("Bundle 'main' debug bundle is empty");
      expect(result.filesGenerated).toBe(0);
      expect(existsSync(join(root(), 'dist/bundles/99.json'))).toBe(false);
    });

    it('does not produce ICU warnings during the debug-only pass', async () => {
      const common = seed('common', { greeting: { source: 'Hello {name' } });
      const result = await generateBundle({
        bundleKey: 'main',
        bundleDefinition: definition(),
        config: config({ common }),
        locales: [],
        debugKeysLocale: '99',
        transformICUToTransloco: true,
        cwd: root(),
      });

      expect(readJson(join(root(), 'dist/bundles/99.json'))).toEqual({ greeting: 'greeting' });
      expect(result.warnings.some((warning) => warning.includes("Key 'greeting'"))).toBe(false);
    });
  });

  describe('transformICUToTransloco precedence', () => {
    it.each([
      { name: 'true parameter', parameter: true, bundle: undefined, global: undefined, expected: 'Hello {{ name }}' },
      { name: 'false parameter', parameter: false, bundle: undefined, global: undefined, expected: 'Hello {name}' },
      { name: 'default', parameter: undefined, bundle: undefined, global: undefined, expected: 'Hello {{ name }}' },
      { name: 'bundle setting', parameter: undefined, bundle: false, global: undefined, expected: 'Hello {name}' },
      { name: 'global setting', parameter: undefined, bundle: undefined, global: false, expected: 'Hello {name}' },
      {
        name: 'parameter over bundle and global',
        parameter: true,
        bundle: false,
        global: false,
        expected: 'Hello {{ name }}',
      },
    ])('uses the $name', async ({ parameter, bundle, global, expected }) => {
      const common = seed('common', { greeting: { source: 'Hello {name}' } });
      await generateBundle({
        bundleKey: 'main',
        bundleDefinition: definition({ transformICUToTransloco: bundle }),
        config: config({ common }, { transformICUToTransloco: global }),
        locales: ['en'],
        transformICUToTransloco: parameter,
        cwd: root(),
      });

      expect(readJson(join(root(), 'dist/bundles/en.json'))).toEqual({ greeting: expected });
    });
  });

  describe('branch bodies the bundler cannot rewrite', () => {
    const UNBUNDLABLE_VALUE = '{count, plural, =1 {{n, number}} other {# items}}';
    const UNRESOLVABLE_NAME_VALUE = '{a, plural, one {{some text}} other {z}}';
    const EXPANDED_VALUE =
      'This will delete {nameExists, select, hasName {{name}} other {this item}} and cannot be undone.';
    const EXPANDED_OUTPUT =
      'This will delete {nameExists, select, hasName {{{name}}} other {this item}} and cannot be undone.';
    const SELECTORDINAL_CASES: readonly { description: string; stored: string; emitted: string }[] = [
      {
        description: 'a selectordinal group with its branches intact',
        stored: '{rank, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}',
        emitted: '{rank, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}',
      },
      {
        description: 'a bare-argument selectordinal branch body as the triple',
        stored: '{rank, selectordinal, one {{itemName}} other {#th}}',
        emitted: '{rank, selectordinal, one {{{itemName}}} other {#th}}',
      },
    ];
    const SAFE_VALUES: readonly string[] = [
      'x {{name} extra}',
      'x {pre {name}}',
      'x {{b, plural, one {p} other {q}}}',
      '{a, plural, one {{b, plural, one {p} other {q}}} other {z}}',
    ];

    function branchBodyWarnings(warnings: readonly string[]): string[] {
      return warnings.filter((warning) => warning.includes('cannot be carried to a Transloco runtime'));
    }

    async function bundleValue(
      key: string,
      source: string,
      options: { translations?: Record<string, string>; locales?: string[]; transform?: boolean } = {},
    ): Promise<Awaited<ReturnType<typeof generateBundle>>> {
      const common = seed('common', {
        [key]: { source, ...(options.translations && { translations: options.translations }) },
      });
      return generateBundle({
        bundleKey: 'main',
        bundleDefinition: definition(),
        config: config({ common }, { locales: options.locales ?? ['en'] }),
        locales: options.locales ?? ['en'],
        transformICUToTransloco: options.transform ?? true,
        cwd: root(),
      });
    }

    it('warns once for a format-carrying branch body', async () => {
      const result = await bundleValue('itemCount', UNBUNDLABLE_VALUE);
      const reported = branchBodyWarnings(result.warnings);

      expect(reported).toHaveLength(1);
      expect(reported[0]).toContain("Key 'itemCount':");
      expect(reported[0]).toContain('does not render as written');
      expect(reported[0]).toContain('an argument carrying a format');
      expect(reported[0]).toContain(`value: ${UNBUNDLABLE_VALUE}`);
      expect(reported[0]).not.toContain('malformed');
    });

    it('warns for a double-brace branch run that is not a parameter name', async () => {
      const result = await bundleValue('choice', UNRESOLVABLE_NAME_VALUE);
      const reported = branchBodyWarnings(result.warnings);

      expect(reported).toHaveLength(1);
      expect(reported[0]).toContain("Key 'choice':");
      expect(reported[0]).toContain('a run that is no parameter name');
      expect(reported[0]).toContain(`value: ${UNRESOLVABLE_NAME_VALUE}`);
    });

    it('warns once per key per locale and once across each locale', async () => {
      const result = await bundleValue('itemCount', UNBUNDLABLE_VALUE, {
        translations: { fr: UNBUNDLABLE_VALUE },
        locales: ['en', 'fr'],
      });

      expect(branchBodyWarnings(result.warnings)).toHaveLength(2);
    });

    it('bundles the emitted value and still generates the file', async () => {
      const result = await bundleValue('itemCount', UNBUNDLABLE_VALUE);

      expect(result.filesGenerated).toBe(1);
      expect(readJson(join(root(), 'dist/bundles/en.json'))).toEqual({ itemCount: UNBUNDLABLE_VALUE });
    });

    it('does not warn when ICU transformation is disabled', async () => {
      const result = await bundleValue('itemCount', UNBUNDLABLE_VALUE, { transform: false });
      expect(branchBodyWarnings(result.warnings)).toHaveLength(0);
    });

    it('bundles a bare-argument branch body as the triple', async () => {
      const result = await bundleValue('deleteConfirm', EXPANDED_VALUE);

      expect(branchBodyWarnings(result.warnings)).toHaveLength(0);
      expect(readJson(join(root(), 'dist/bundles/en.json'))).toEqual({ deleteConfirm: EXPANDED_OUTPUT });
    });

    for (const { description, stored, emitted } of SELECTORDINAL_CASES) {
      it(`bundles ${description}`, async () => {
        const result = await bundleValue('rank', stored);

        expect(branchBodyWarnings(result.warnings)).toHaveLength(0);
        expect(readJson(join(root(), 'dist/bundles/en.json'))).toEqual({ rank: emitted });
      });
    }

    for (const value of SAFE_VALUES) {
      it(`does not warn for ${value}`, async () => {
        const result = await bundleValue('safe', value);
        expect(branchBodyWarnings(result.warnings)).toHaveLength(0);
      });
    }
  });

  describe('the icu-edge-cases fixture collection', () => {
    const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
    const FIXTURE_COLLECTION = 'icuEdgeCases';
    const EXPECTED_FIXTURE_LOCALES: readonly string[] = ['en', 'fr-ca', 'ja'];
    const FORMAT_CARRYING_KEY = 'status.syncedRecordCount';

    interface FixtureConfigFile {
      readonly baseLocale: string;
      readonly locales?: string[];
      readonly collections: Record<string, { readonly translationsFolder: string; readonly locales?: string[] }>;
    }

    function fixture(): { config: LingoTrackerConfig; locales: string[] } {
      const raw = JSON.parse(readFileSync(join(REPO_ROOT, '.lingo-tracker.json'), 'utf8')) as FixtureConfigFile;
      const collection = raw.collections[FIXTURE_COLLECTION];
      expect(collection).toBeDefined();
      const locales = collection?.locales ?? raw.locales ?? [];
      return {
        locales,
        config: {
          exportFolder: 'dist/export',
          importFolder: 'dist/import',
          baseLocale: raw.baseLocale,
          locales,
          collections: collection
            ? {
                [FIXTURE_COLLECTION]: {
                  ...collection,
                  translationsFolder: resolve(REPO_ROOT, collection.translationsFolder),
                },
              }
            : {},
        },
      };
    }

    function flattenBundle(data: Record<string, unknown>, prefix = ''): Record<string, string> {
      const flat: Record<string, string> = {};
      for (const [key, value] of Object.entries(data)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') flat[fullKey] = value;
        else if (value && typeof value === 'object') {
          Object.assign(flat, flattenBundle(value as Record<string, unknown>, fullKey));
        }
      }
      return flat;
    }

    async function bundleFixtureLocale(
      locale: string,
    ): Promise<{ emitted: Record<string, string>; warnings: string[] }> {
      const fixtureData = fixture();
      const result = await generateBundle({
        bundleKey: 'icu-edge-cases',
        bundleDefinition: { bundleName: '{locale}', dist: join(root(), 'fixture-bundles'), collections: 'All' },
        config: fixtureData.config,
        locales: [locale],
        transformICUToTransloco: true,
        cwd: root(),
      });
      expect(result.filesGenerated).toBe(1);
      return {
        emitted: flattenBundle(readJson(join(root(), 'fixture-bundles', `${locale}.json`))),
        warnings: result.warnings,
      };
    }

    it('produces one file per configured locale, including ja', async () => {
      const fixtureData = fixture();
      expect(fixtureData.locales).toEqual(EXPECTED_FIXTURE_LOCALES);

      const result = await generateBundle({
        bundleKey: 'icu-edge-cases',
        bundleDefinition: { bundleName: '{locale}', dist: join(root(), 'fixture-bundles'), collections: 'All' },
        config: fixtureData.config,
        locales: fixtureData.locales,
        transformICUToTransloco: true,
        cwd: root(),
      });

      expect(result.filesGenerated).toBe(fixtureData.locales.length);
      expect(result.localesProcessed).toEqual(fixtureData.locales);
      for (const locale of fixtureData.locales) {
        expect(existsSync(join(root(), 'fixture-bundles', `${locale}.json`))).toBe(true);
      }
    });

    it('carries both branch-body shapes based on position rather than key', async () => {
      const base = await bundleFixtureLocale('en');
      const japanese = await bundleFixtureLocale('ja');

      expect(base.emitted['errors.restrictedChildren']).toContain('=1 {{itemName} contains}');
      expect(japanese.emitted['errors.restrictedChildren']).toContain('=1 {{{itemName}}}');
    });

    it('bundles every value and warns once per locale only for the format-carrying key', async () => {
      const { locales } = fixture();
      const warned: string[] = [];

      for (const locale of locales) {
        const { emitted, warnings } = await bundleFixtureLocale(locale);
        expect(Object.keys(emitted).length).toBeGreaterThan(0);
        for (const warning of warnings) warned.push(`${locale}:${warning}`);
      }

      expect(warned).toHaveLength(locales.length);
      for (const warning of warned) {
        expect(warning).toContain(`Key '${FORMAT_CARRYING_KEY}'`);
        expect(warning).toContain('cannot be carried to a Transloco runtime');
      }
    });
  });
});
