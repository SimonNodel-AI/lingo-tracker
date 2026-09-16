import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BundleDefinition } from '../../config/bundle-definition';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { CONFIG_FILENAME } from '../../constants';
import { addBundleDefinition, deleteBundleDefinition, updateBundleDefinition } from './bundle-definition-operations';

const baseConfig = (overrides: Partial<LingoTrackerConfig> = {}): LingoTrackerConfig => ({
  exportFolder: 'dist/lingo-export',
  importFolder: 'dist/lingo-import',
  baseLocale: 'en',
  locales: ['en', 'fr'],
  collections: {
    common: { translationsFolder: './libs/common/i18n' },
    admin: { translationsFolder: './libs/admin/i18n' },
  },
  ...overrides,
});

const validDefinition = (overrides: Partial<BundleDefinition> = {}): BundleDefinition => ({
  bundleName: 'main.{locale}',
  dist: './dist/i18n',
  collections: 'All',
  ...overrides,
});

describe('bundle-definition-operations', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'lingo-bundle-ops-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  const writeConfig = (config: LingoTrackerConfig): void => {
    writeFileSync(join(cwd, CONFIG_FILENAME), JSON.stringify(config, null, 2), 'utf8');
  };

  const readConfig = (): LingoTrackerConfig => JSON.parse(readFileSync(join(cwd, CONFIG_FILENAME), 'utf8'));

  describe('addBundleDefinition', () => {
    it('adds a bundle to a config without any bundles', () => {
      writeConfig(baseConfig());

      const result = addBundleDefinition('main', validDefinition(), { cwd });

      expect(result.message).toBe('Bundle "main" added successfully');
      expect(readConfig().bundles).toEqual({ main: validDefinition() });
    });

    it('appends after existing bundles and keeps their order', () => {
      writeConfig(baseConfig({ bundles: { first: validDefinition(), second: validDefinition() } }));

      addBundleDefinition('third', validDefinition(), { cwd });

      expect(Object.keys(readConfig().bundles ?? {})).toEqual(['first', 'second', 'third']);
    });

    it('strips undefined optional fields recursively before writing', () => {
      writeConfig(baseConfig());

      addBundleDefinition(
        'main',
        {
          bundleName: 'main.{locale}',
          dist: './dist/i18n',
          typeDistFile: undefined,
          tokenCasing: undefined,
          collections: [
            {
              name: 'common',
              bundledKeyPrefix: undefined,
              mergeStrategy: undefined,
              entriesSelectionRules: [
                { matchingPattern: 'apps.*', matchingTags: undefined, matchingTagOperator: undefined },
              ],
            },
          ],
        },
        { cwd },
      );

      const raw = readFileSync(join(cwd, CONFIG_FILENAME), 'utf8');
      expect(raw).not.toContain('undefined');
      expect(readConfig().bundles?.['main']).toEqual({
        bundleName: 'main.{locale}',
        dist: './dist/i18n',
        collections: [{ name: 'common', entriesSelectionRules: [{ matchingPattern: 'apps.*' }] }],
      });
    });

    it('trims the key', () => {
      writeConfig(baseConfig());

      addBundleDefinition('  main  ', validDefinition(), { cwd });

      expect(Object.keys(readConfig().bundles ?? {})).toEqual(['main']);
    });

    it('rejects an existing key', () => {
      writeConfig(baseConfig({ bundles: { main: validDefinition() } }));

      expect(() => addBundleDefinition('main', validDefinition(), { cwd })).toThrow('Bundle "main" already exists');
    });

    it('rejects an invalid key without writing', () => {
      const config = baseConfig();
      writeConfig(config);

      expect(() => addBundleDefinition('my bundle', validDefinition(), { cwd })).toThrow(
        'Invalid bundle definition: Bundle name may only contain letters, numbers, hyphens and underscores.',
      );
      expect(readConfig()).toEqual(config);
    });

    it('rejects an invalid definition and reports every error', () => {
      const config = baseConfig();
      writeConfig(config);

      expect(() =>
        addBundleDefinition(
          'main',
          validDefinition({ bundleName: 'main', collections: [{ name: 'ghost', entriesSelectionRules: 'All' }] }),
          { cwd },
        ),
      ).toThrow(
        'Invalid bundle definition: bundleName must include the {locale} placeholder so each locale gets its own file.; ' +
          "Collection 'ghost' does not exist in the configuration.",
      );
      expect(readConfig()).toEqual(config);
    });
  });

  describe('updateBundleDefinition', () => {
    it('replaces the definition in place and keeps key order', () => {
      writeConfig(
        baseConfig({
          bundles: {
            first: validDefinition(),
            second: validDefinition(),
            third: validDefinition(),
          },
        }),
      );

      const updated = validDefinition({ dist: './out', typeDistFile: './src/tokens.ts' });
      const result = updateBundleDefinition('second', updated, { cwd });

      expect(result.message).toBe('Bundle "second" updated successfully');
      const bundles = readConfig().bundles ?? {};
      expect(Object.keys(bundles)).toEqual(['first', 'second', 'third']);
      expect(bundles['second']).toEqual(updated);
    });

    it('renames the bundle while keeping its position', () => {
      writeConfig(
        baseConfig({ bundles: { first: validDefinition(), second: validDefinition(), third: validDefinition() } }),
      );

      const result = updateBundleDefinition('second', validDefinition({ dist: './renamed' }), {
        cwd,
        newKey: 'middle',
      });

      expect(result.message).toBe('Bundle "second" renamed to "middle" and updated successfully');
      const bundles = readConfig().bundles ?? {};
      expect(Object.keys(bundles)).toEqual(['first', 'middle', 'third']);
      expect(bundles['middle']?.dist).toBe('./renamed');
      expect(bundles['second']).toBeUndefined();
    });

    it('treats newKey equal to key as a plain update', () => {
      writeConfig(baseConfig({ bundles: { main: validDefinition() } }));

      const result = updateBundleDefinition('main', validDefinition({ dist: './x' }), { cwd, newKey: 'main' });

      expect(result.message).toBe('Bundle "main" updated successfully');
      expect(readConfig().bundles?.['main']?.dist).toBe('./x');
    });

    it('throws when the bundle does not exist', () => {
      writeConfig(baseConfig({ bundles: { main: validDefinition() } }));

      expect(() => updateBundleDefinition('ghost', validDefinition(), { cwd })).toThrow('Bundle "ghost" not found');
    });

    it('throws when the bundles section is missing entirely', () => {
      writeConfig(baseConfig());

      expect(() => updateBundleDefinition('main', validDefinition(), { cwd })).toThrow('Bundle "main" not found');
    });

    it('refuses to rename onto an existing key', () => {
      const config = baseConfig({ bundles: { a: validDefinition(), b: validDefinition() } });
      writeConfig(config);

      expect(() => updateBundleDefinition('a', validDefinition(), { cwd, newKey: 'b' })).toThrow(
        'Bundle "b" already exists',
      );
      expect(readConfig()).toEqual(config);
    });

    it('validates the new key', () => {
      writeConfig(baseConfig({ bundles: { a: validDefinition() } }));

      expect(() => updateBundleDefinition('a', validDefinition(), { cwd, newKey: 'bad key' })).toThrow(
        'Invalid bundle definition:',
      );
    });

    it('validates the definition without writing on failure', () => {
      const config = baseConfig({ bundles: { main: validDefinition() } });
      writeConfig(config);

      expect(() => updateBundleDefinition('main', validDefinition({ typeDistFile: 'tokens.js' }), { cwd })).toThrow(
        'Invalid bundle definition: typeDistFile must end with a .ts extension, but got: tokens.js',
      );
      expect(readConfig()).toEqual(config);
    });
  });

  describe('deleteBundleDefinition', () => {
    it('removes the bundle and keeps the others in order', () => {
      writeConfig(baseConfig({ bundles: { a: validDefinition(), b: validDefinition(), c: validDefinition() } }));

      const result = deleteBundleDefinition('b', { cwd });

      expect(result.message).toBe('Bundle "b" deleted successfully');
      expect(Object.keys(readConfig().bundles ?? {})).toEqual(['a', 'c']);
    });

    it('drops the bundles section when the last bundle is removed', () => {
      writeConfig(baseConfig({ bundles: { only: validDefinition() } }));

      deleteBundleDefinition('only', { cwd });

      expect(readConfig()).not.toHaveProperty('bundles');
    });

    it('throws when the bundle does not exist', () => {
      const config = baseConfig({ bundles: { a: validDefinition() } });
      writeConfig(config);

      expect(() => deleteBundleDefinition('ghost', { cwd })).toThrow('Bundle "ghost" not found');
      expect(readConfig()).toEqual(config);
    });
  });
});
