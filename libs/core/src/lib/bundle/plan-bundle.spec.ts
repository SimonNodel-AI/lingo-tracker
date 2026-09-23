import * as fs from 'fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BundleDefinition } from '../../config/bundle-definition';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { planBundle } from './plan-bundle';
import type { FlatResource } from './resource-loader';
import * as resourceLoader from './resource-loader';
import { generateBundleTypes } from './type-generation/generate-types';

vi.mock('fs');
vi.mock('./resource-loader');
vi.mock('./type-generation/generate-types');

describe('planBundle', () => {
  const cwd = '/project';
  let config: LingoTrackerConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    config = {
      exportFolder: 'dist/export',
      importFolder: 'dist/import',
      baseLocale: 'en',
      locales: ['en', 'fr'],
      collections: {
        common: { translationsFolder: '/translations/common' },
        admin: { translationsFolder: '/translations/admin' },
      },
    };

    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Returns resources keyed by translations folder so each collection has distinct content. */
  function mockResourcesByFolder(byFolder: Record<string, FlatResource[]>): void {
    vi.spyOn(resourceLoader, 'loadCollectionResources').mockImplementation(
      (collection) => byFolder[collection.translationsFolder] ?? [],
    );
  }

  const definition: BundleDefinition = {
    bundleName: 'main.{locale}',
    dist: './dist/i18n',
    collections: 'All',
  };

  it('lists one bundle file per locale with resolved paths and exists flags', () => {
    mockResourcesByFolder({ '/translations/common': [{ key: 'buttons.ok', value: 'OK' }] });
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).endsWith('main.en.json'));

    const plan = planBundle({ bundleKey: 'main', bundleDefinition: definition, config, cwd });

    expect(plan.bundleKey).toBe('main');
    expect(plan.locales).toEqual(['en', 'fr']);
    expect(plan.files).toEqual([
      {
        path: path.join('./dist/i18n', 'main.en.json'),
        absolutePath: path.resolve(cwd, 'dist/i18n/main.en.json'),
        kind: 'bundle',
        locale: 'en',
        exists: true,
        keysCount: 1,
      },
      {
        path: path.join('./dist/i18n', 'main.fr.json'),
        absolutePath: path.resolve(cwd, 'dist/i18n/main.fr.json'),
        kind: 'bundle',
        locale: 'fr',
        exists: false,
        keysCount: 1,
      },
    ]);
    expect(plan.keysPerLocale).toEqual({ en: 1, fr: 1 });
  });

  it('respects a locales subset', () => {
    mockResourcesByFolder({ '/translations/common': [{ key: 'a', value: 'A' }] });

    const plan = planBundle({ bundleKey: 'main', bundleDefinition: definition, config, cwd, locales: ['fr'] });

    expect(plan.locales).toEqual(['fr']);
    expect(plan.files.map((file) => file.locale)).toEqual(['fr']);
    expect(plan.keysPerLocale).toEqual({ fr: 1 });
    // The base locale is still consulted for the example key even when not planned.
    expect(plan.exampleKey).toEqual({ collectionName: 'common', sourceKey: 'a', bundledKey: 'a' });
  });

  it('never writes to disk and never calls type generation', () => {
    mockResourcesByFolder({ '/translations/common': [{ key: 'a', value: 'A' }] });

    planBundle({
      bundleKey: 'main',
      bundleDefinition: { ...definition, typeDistFile: './src/tokens.ts' },
      config,
      cwd,
    });

    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(generateBundleTypes).not.toHaveBeenCalled();
  });

  it('omits the types file when types are not configured', () => {
    mockResourcesByFolder({ '/translations/common': [{ key: 'a', value: 'A' }] });

    const plan = planBundle({ bundleKey: 'main', bundleDefinition: definition, config, cwd });

    expect(plan.files.filter((file) => file.kind === 'types')).toEqual([]);
    expect(plan.exampleKey?.tokenPath).toBeUndefined();
  });

  it('adds a types file with the base-locale key count when configured', () => {
    mockResourcesByFolder({
      '/translations/common': [
        { key: 'a', value: 'A' },
        { key: 'b', value: 'B' },
      ],
    });

    const plan = planBundle({
      bundleKey: 'main',
      bundleDefinition: { ...definition, typeDistFile: './src/tokens.ts' },
      config,
      cwd,
    });

    const typesFile = plan.files.find((file) => file.kind === 'types');
    expect(typesFile).toEqual({
      path: './src/tokens.ts',
      absolutePath: path.resolve(cwd, 'src/tokens.ts'),
      kind: 'types',
      exists: false,
      keysCount: 2,
    });
    expect(typesFile?.locale).toBeUndefined();
  });

  it('warns about empty locales and reports zero keys', () => {
    mockResourcesByFolder({});

    const plan = planBundle({ bundleKey: 'main', bundleDefinition: definition, config, cwd });

    expect(plan.keysPerLocale).toEqual({ en: 0, fr: 0 });
    expect(plan.warnings).toContain("Bundle 'main' for locale 'en' is empty");
    expect(plan.warnings).toContain("Bundle 'main' for locale 'fr' is empty");
    expect(plan.exampleKey).toBeUndefined();
  });

  describe('conflicts', () => {
    beforeEach(() => {
      mockResourcesByFolder({
        '/translations/common': [
          { key: 'shared.title', value: 'Common title' },
          { key: 'common.only', value: 'Only in common' },
        ],
        '/translations/admin': [{ key: 'shared.title', value: 'Admin title' }],
      });
    });

    it('records conflicting keys once, regardless of locale count', () => {
      const plan = planBundle({ bundleKey: 'main', bundleDefinition: definition, config, cwd });

      expect(plan.conflictsCount).toBe(1);
      expect(plan.conflictKeys).toEqual(['shared.title']);
      // Conflicting keys are still counted once per locale in the output.
      expect(plan.keysPerLocale).toEqual({ en: 2, fr: 2 });
    });

    it('attributes the example key to the first collection under merge', () => {
      const plan = planBundle({
        bundleKey: 'main',
        bundleDefinition: {
          ...definition,
          collections: [
            { name: 'common', entriesSelectionRules: 'All' },
            { name: 'admin', entriesSelectionRules: 'All', mergeStrategy: 'merge' },
          ],
        },
        config,
        cwd,
      });

      expect(plan.conflictKeys).toEqual(['shared.title']);
      expect(plan.exampleKey).toEqual({
        collectionName: 'common',
        sourceKey: 'shared.title',
        bundledKey: 'shared.title',
      });
    });

    it('attributes the example key to the overriding collection under override', () => {
      const plan = planBundle({
        bundleKey: 'main',
        bundleDefinition: {
          ...definition,
          collections: [
            { name: 'common', entriesSelectionRules: 'All' },
            { name: 'admin', entriesSelectionRules: 'All', mergeStrategy: 'override' },
          ],
        },
        config,
        cwd,
      });

      expect(plan.conflictKeys).toEqual(['shared.title']);
      expect(plan.exampleKey).toEqual({
        collectionName: 'admin',
        sourceKey: 'shared.title',
        bundledKey: 'shared.title',
      });
    });

    it('reports no conflicts when prefixes separate the collections', () => {
      const plan = planBundle({
        bundleKey: 'main',
        bundleDefinition: {
          ...definition,
          collections: [
            { name: 'common', entriesSelectionRules: 'All' },
            { name: 'admin', entriesSelectionRules: 'All', bundledKeyPrefix: 'admin' },
          ],
        },
        config,
        cwd,
      });

      expect(plan.conflictsCount).toBe(0);
      expect(plan.conflictKeys).toEqual([]);
      expect(plan.keysPerLocale.en).toBe(3);
    });
  });

  describe('hierarchical conflicts', () => {
    it('reports a key that is both a leaf and a parent, and warns about it', () => {
      mockResourcesByFolder({
        '/translations/common': [
          { key: 'buttons.ok', value: 'OK' },
          { key: 'buttons.ok.label', value: 'OK label' },
        ],
      });

      const plan = planBundle({ bundleKey: 'main', bundleDefinition: definition, config, cwd });

      expect(plan.hierarchicalConflicts).toEqual(['buttons.ok']);
      // It is not a cross-collection conflict, so the existing counter stays clear.
      expect(plan.conflictsCount).toBe(0);
      expect(plan.conflictKeys).toEqual([]);
      expect(
        plan.warnings.some((warning) => warning.includes('Hierarchical conflict') && warning.includes('buttons.ok')),
      ).toBe(true);
    });

    it('reports a collision introduced by a bundled key prefix', () => {
      mockResourcesByFolder({
        '/translations/common': [{ key: 'ok', value: 'OK' }],
        '/translations/admin': [{ key: 'ok.label', value: 'OK label' }],
      });

      const plan = planBundle({
        bundleKey: 'main',
        bundleDefinition: {
          ...definition,
          collections: [
            { name: 'common', entriesSelectionRules: 'All', bundledKeyPrefix: 'buttons' },
            { name: 'admin', entriesSelectionRules: 'All', bundledKeyPrefix: 'buttons' },
          ],
        },
        config,
        cwd,
      });

      expect(plan.hierarchicalConflicts).toEqual(['buttons.ok']);
    });

    it('is empty for a well-formed key set', () => {
      mockResourcesByFolder({
        '/translations/common': [
          { key: 'buttons.ok', value: 'OK' },
          { key: 'buttons.cancel', value: 'Cancel' },
        ],
      });

      const plan = planBundle({ bundleKey: 'main', bundleDefinition: definition, config, cwd });

      expect(plan.hierarchicalConflicts).toEqual([]);
      expect(plan.warnings).toEqual([]);
    });
  });

  describe('exampleKey', () => {
    beforeEach(() => {
      mockResourcesByFolder({ '/translations/common': [{ key: 'buttons.file-upload', value: 'Upload' }] });
    });

    const prefixed: BundleDefinition = {
      ...definition,
      collections: [{ name: 'common', entriesSelectionRules: 'All', bundledKeyPrefix: 'shared' }],
    };

    it('includes the prefix in bundledKey but not sourceKey', () => {
      const plan = planBundle({ bundleKey: 'main', bundleDefinition: prefixed, config, cwd });

      expect(plan.exampleKey).toEqual({
        collectionName: 'common',
        sourceKey: 'buttons.file-upload',
        bundledKey: 'shared.buttons.file-upload',
      });
    });

    it('builds an upperCase tokenPath from the derived constant name by default', () => {
      const plan = planBundle({
        bundleKey: 'core-ui',
        bundleDefinition: { ...prefixed, typeDistFile: './src/tokens.ts' },
        config,
        cwd,
      });

      expect(plan.exampleKey?.tokenPath).toBe('CORE_UI_TOKENS.SHARED.BUTTONS.FILE_UPLOAD');
    });

    it('honours the casing and constant-name precedence chain (param > definition > config)', () => {
      const withTypes: BundleDefinition = {
        ...prefixed,
        typeDistFile: './src/tokens.ts',
        tokenCasing: 'upperCase',
        tokenConstantName: 'DEF_TOKENS',
      };

      const fromDefinition = planBundle({
        bundleKey: 'main',
        bundleDefinition: withTypes,
        config: { ...config, tokenCasing: 'camelCase' },
        cwd,
      });
      expect(fromDefinition.exampleKey?.tokenPath).toBe('DEF_TOKENS.SHARED.BUTTONS.FILE_UPLOAD');

      const fromParams = planBundle({
        bundleKey: 'main',
        bundleDefinition: withTypes,
        config,
        cwd,
        tokenCasing: 'camelCase',
        tokenConstantName: 'paramTokens',
      });
      expect(fromParams.exampleKey?.tokenPath).toBe('paramTokens.shared.buttons.fileUpload');

      const fromConfig = planBundle({
        bundleKey: 'main',
        bundleDefinition: { ...prefixed, typeDistFile: './src/tokens.ts' },
        config: { ...config, tokenCasing: 'camelCase' },
        cwd,
      });
      expect(fromConfig.exampleKey?.tokenPath).toBe('MAIN_TOKENS.shared.buttons.fileUpload');
    });
  });

  it('warns about unknown collections in an explicit list', () => {
    mockResourcesByFolder({});

    const plan = planBundle({
      bundleKey: 'main',
      bundleDefinition: { ...definition, collections: [{ name: 'ghost', entriesSelectionRules: 'All' }] },
      config,
      cwd,
      locales: ['en'],
    });

    expect(plan.warnings).toContain("Collection 'ghost' not found in config");
  });

  it('defaults cwd to process.cwd() for exists checks', () => {
    mockResourcesByFolder({ '/translations/common': [{ key: 'a', value: 'A' }] });

    const plan = planBundle({ bundleKey: 'main', bundleDefinition: definition, config, locales: ['en'] });

    expect(plan.files[0]?.absolutePath).toBe(path.resolve(process.cwd(), 'dist/i18n/main.en.json'));
  });
});
