import { describe, expect, it } from 'vitest';
import type { BundleDefinition } from '../../config/bundle-definition';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { validateBundleDefinition, validateBundleKey } from './validate-bundle-definition';

const config: LingoTrackerConfig = {
  exportFolder: 'dist/export',
  importFolder: 'dist/import',
  baseLocale: 'en',
  locales: ['en', 'fr'],
  collections: {
    common: { translationsFolder: 'libs/common/i18n' },
    admin: { translationsFolder: 'libs/admin/i18n' },
  },
};

const validDefinition = (overrides: Partial<BundleDefinition> = {}): BundleDefinition => ({
  bundleName: 'main.{locale}',
  dist: './dist/i18n',
  collections: 'All',
  ...overrides,
});

describe('validateBundleKey', () => {
  it('accepts letters, numbers, hyphens and underscores', () => {
    expect(validateBundleKey('main')).toEqual([]);
    expect(validateBundleKey('core-ui_2')).toEqual([]);
  });

  it('rejects an empty or whitespace-only key', () => {
    expect(validateBundleKey('')).toEqual(['Bundle name is required.']);
    expect(validateBundleKey('   ')).toEqual(['Bundle name is required.']);
  });

  it('rejects keys with other characters', () => {
    expect(validateBundleKey('my bundle')).toEqual([
      'Bundle name may only contain letters, numbers, hyphens and underscores.',
    ]);
    expect(validateBundleKey('a.b')).toHaveLength(1);
    expect(validateBundleKey('a/b')).toHaveLength(1);
  });
});

describe('validateBundleDefinition', () => {
  it('returns no errors for a valid "All" definition', () => {
    expect(validateBundleDefinition(validDefinition(), config)).toEqual([]);
  });

  it('returns no errors for a valid explicit collection list', () => {
    const definition = validDefinition({
      collections: [
        { name: 'common', entriesSelectionRules: 'All' },
        {
          name: 'admin',
          bundledKeyPrefix: 'admin',
          mergeStrategy: 'override',
          entriesSelectionRules: [{ matchingPattern: 'apps.*', matchingTags: ['ui'], matchingTagOperator: 'Any' }],
        },
      ],
      typeDistFile: './src/tokens.ts',
      tokenConstantName: 'MY_TOKENS',
    });

    expect(validateBundleDefinition(definition, config)).toEqual([]);
  });

  it('reports a missing bundleName', () => {
    const errors = validateBundleDefinition(validDefinition({ bundleName: '' }), config);
    expect(errors).toContain('bundleName is required.');
  });

  it('reports a bundleName without the {locale} placeholder', () => {
    const errors = validateBundleDefinition(validDefinition({ bundleName: 'main' }), config);
    expect(errors).toContain('bundleName must include the {locale} placeholder so each locale gets its own file.');
  });

  it('reports a missing dist', () => {
    const errors = validateBundleDefinition(validDefinition({ dist: '  ' }), config);
    expect(errors).toContain('dist (output folder) is required.');
  });

  it('reports collections that are neither "All" nor a non-empty array', () => {
    expect(validateBundleDefinition(validDefinition({ collections: [] }), config)).toContain(
      "collections must be 'All' or a non-empty array of collection definitions.",
    );
    expect(
      validateBundleDefinition(validDefinition({ collections: 'everything' as unknown as 'All' }), config),
    ).toContain("collections must be 'All' or a non-empty array of collection definitions.");
  });

  it('reports a typeDistFile that does not end in .ts', () => {
    const errors = validateBundleDefinition(validDefinition({ typeDistFile: './src/tokens.js' }), config);
    expect(errors).toEqual(['typeDistFile must end with a .ts extension, but got: ./src/tokens.js']);
  });

  it('reports an invalid tokenConstantName', () => {
    const errors = validateBundleDefinition(validDefinition({ tokenConstantName: '1bad' }), config);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^tokenConstantName is invalid: /);
    expect(errors[0]).toContain('must start with a letter');
  });

  it('reports a reserved word used as tokenConstantName', () => {
    const errors = validateBundleDefinition(validDefinition({ tokenConstantName: 'class' }), config);
    expect(errors[0]).toContain('reserved word');
  });

  it('reports a collection that does not exist in the configuration', () => {
    const errors = validateBundleDefinition(
      validDefinition({ collections: [{ name: 'ghost', entriesSelectionRules: 'All' }] }),
      config,
    );
    expect(errors).toEqual(["Collection 'ghost' does not exist in the configuration."]);
  });

  it('reports a collection without a name', () => {
    const errors = validateBundleDefinition(
      validDefinition({ collections: [{ name: '', entriesSelectionRules: 'All' }] }),
      config,
    );
    expect(errors).toEqual(['Collection at index 0 is missing a name.']);
  });

  it('reports an empty entriesSelectionRules array', () => {
    const errors = validateBundleDefinition(
      validDefinition({ collections: [{ name: 'common', entriesSelectionRules: [] }] }),
      config,
    );
    expect(errors).toEqual(["Collection 'common': entriesSelectionRules must be 'All' or a non-empty array of rules."]);
  });

  it('reports a rule without a matchingPattern', () => {
    const errors = validateBundleDefinition(
      validDefinition({
        collections: [{ name: 'common', entriesSelectionRules: [{ matchingPattern: '' }] }],
      }),
      config,
    );
    expect(errors).toEqual(["Collection 'common': rule at index 0 is missing a matchingPattern."]);
  });

  it('reports an invalid matchingTagOperator', () => {
    const errors = validateBundleDefinition(
      validDefinition({
        collections: [
          {
            name: 'common',
            entriesSelectionRules: [{ matchingPattern: '*', matchingTagOperator: 'Some' as unknown as 'All' }],
          },
        ],
      }),
      config,
    );
    expect(errors).toEqual([
      "Collection 'common': rule at index 0 has an invalid matchingTagOperator 'Some' (expected 'All' or 'Any').",
    ]);
  });

  it('reports an invalid mergeStrategy', () => {
    const errors = validateBundleDefinition(
      validDefinition({
        collections: [{ name: 'common', entriesSelectionRules: 'All', mergeStrategy: 'replace' as unknown as 'merge' }],
      }),
      config,
    );
    expect(errors).toEqual(["Collection 'common': mergeStrategy must be 'merge' or 'override', but got: replace"]);
  });

  it('reports the same collection included twice with the same prefix', () => {
    const errors = validateBundleDefinition(
      validDefinition({
        collections: [
          { name: 'common', entriesSelectionRules: 'All', bundledKeyPrefix: 'shared' },
          { name: 'common', entriesSelectionRules: [{ matchingPattern: 'x.*' }], bundledKeyPrefix: 'shared' },
        ],
      }),
      config,
    );
    expect(errors).toEqual(["Collection 'common' is included more than once with the same bundledKeyPrefix 'shared'."]);
  });

  it('reports the same collection included twice without a prefix', () => {
    const errors = validateBundleDefinition(
      validDefinition({
        collections: [
          { name: 'common', entriesSelectionRules: 'All' },
          { name: 'common', entriesSelectionRules: 'All' },
        ],
      }),
      config,
    );
    expect(errors).toEqual(["Collection 'common' is included more than once without a bundledKeyPrefix."]);
  });

  it('allows the same collection twice with different prefixes', () => {
    const errors = validateBundleDefinition(
      validDefinition({
        collections: [
          { name: 'common', entriesSelectionRules: 'All', bundledKeyPrefix: 'a' },
          { name: 'common', entriesSelectionRules: 'All', bundledKeyPrefix: 'b' },
        ],
      }),
      config,
    );
    expect(errors).toEqual([]);
  });

  it('accumulates every applicable message', () => {
    const errors = validateBundleDefinition(
      {
        bundleName: 'main',
        dist: '',
        collections: [{ name: 'ghost', entriesSelectionRules: [] }],
        typeDistFile: 'tokens.json',
        tokenConstantName: 'my-tokens',
      },
      config,
    );

    expect(errors).toHaveLength(6);
  });
});
