import { normalizeBundleDefinition } from '@simoncodes-ca/domain';
import type { BundleDefinitionDto } from '@simoncodes-ca/data-transfer';
import { describe, expect, it } from 'vitest';
import {
  collectionsRequired,
  dryRunRequest,
  firstErrorSection,
  localTree,
  outputFiles,
  outputSummary,
  patternFiles,
  rulesRequired,
  toDefinition,
  toDraft,
  typeFileName,
  type BundleSection,
} from './bundle-draft';

const minimal: BundleDefinitionDto = {
  bundleName: '{locale}',
  dist: './dist',
  collections: [{ name: 'main', entriesSelectionRules: 'All' }],
};
const names = ['main', 'extra'];

describe('Bundle Draft mapping', () => {
  const cases: { name: string; definition: BundleDefinitionDto; expected?: BundleDefinitionDto }[] = [
    { name: 'minimal definition', definition: minimal },
    { name: 'All collections', definition: { ...minimal, collections: 'All' } },
    {
      name: 'explicit collections, rules, tags and override',
      definition: {
        ...minimal,
        collections: [
          {
            name: 'main',
            bundledKeyPrefix: ' app ',
            mergeStrategy: 'override',
            entriesSelectionRules: [{ matchingPattern: ' app.* ', matchingTags: ['ui'], matchingTagOperator: 'All' }],
          },
        ],
      },
    },
    { name: 'ICU on', definition: { ...minimal, transformICUToTransloco: true } },
    { name: 'ICU off', definition: { ...minimal, transformICUToTransloco: false } },
    { name: 'inherited casing with types on', definition: { ...minimal, typeDistFile: './types.ts' } },
    {
      name: 'explicit casing and constant name',
      definition: { ...minimal, typeDistFile: './types.ts', tokenCasing: 'camelCase', tokenConstantName: 'MAIN_KEYS' },
    },
    {
      name: 'merge strategy other than override is omitted',
      definition: { ...minimal, collections: [{ name: 'main', entriesSelectionRules: 'All', mergeStrategy: 'merge' }] },
      expected: minimal,
    },
    {
      name: 'empty prefix is omitted',
      definition: { ...minimal, collections: [{ name: 'main', entriesSelectionRules: 'All', bundledKeyPrefix: ' ' }] },
    },
    {
      name: 'types off drops type fields',
      definition: { ...minimal, tokenCasing: 'upperCase', tokenConstantName: 'MAIN_KEYS' },
      expected: minimal,
    },
    {
      name: 'legacy typeDist becomes typeDistFile',
      definition: { ...minimal, typeDist: './legacy.ts' } as BundleDefinitionDto,
    },
  ];

  it.each(cases)('$name', ({ definition, expected }) => {
    expect(toDefinition(toDraft(definition, names))).toEqual(expected ?? normalizeBundleDefinition(definition));
  });

  it('starts a new bundle with the first configured collection', () => {
    const firstCollection = [
      {
        name: 'main',
        bundledKeyPrefix: '',
        mergeStrategy: 'merge',
        allEntries: true,
        rules: [],
      },
    ];
    expect(toDraft(undefined, names).collections).toEqual(firstCollection);
    expect(toDraft({ ...minimal, collections: [] }, names).collections).toEqual(firstCollection);
    expect(toDraft(undefined, []).collections).toEqual([]);
    expect(toDraft({ ...minimal, collections: [] }, []).collections).toEqual([]);
  });

  it('preserves collection order and emits All despite hidden collection groups', () => {
    const definition: BundleDefinitionDto = {
      ...minimal,
      collections: [
        { name: 'extra', entriesSelectionRules: 'All' },
        { name: 'main', entriesSelectionRules: 'All' },
      ],
    };
    const draft = toDraft(definition, names);
    expect(draft.collections.map((collection) => collection.name)).toEqual(['extra', 'main']);
    expect(toDefinition(draft).collections).toEqual(definition.collections);
    expect(toDefinition({ ...draft, allCollections: true }).collections).toBe('All');
  });

  it('preserves hidden type choices in the draft but drops them when types are off', () => {
    const draft = toDraft({ ...minimal, typeDistFile: './types.ts', tokenCasing: 'camelCase' }, names);
    expect(draft.tokenCasing).toBe('camelCase');
    expect(toDefinition({ ...draft, typesEnabled: false })).toEqual(minimal);
  });

  it('keeps rule All and empty tag choices separate from emitted fields', () => {
    const draft = toDraft(minimal, names);
    const collection = draft.collections[0];
    expect(collection?.allEntries).toBe(true);
    const changed = {
      ...draft,
      collections: [
        {
          name: 'main',
          bundledKeyPrefix: '',
          mergeStrategy: 'merge' as const,
          allEntries: false,
          rules: [{ matchingPattern: ' * ', matchingTags: [], matchingTagOperator: 'All' as const }],
        },
      ],
    };
    expect(toDefinition(changed).collections).toEqual([
      { name: 'main', entriesSelectionRules: [{ matchingPattern: '*' }] },
    ]);
  });

  it('emits Any with tags and omits the operator for whitespace-only or empty tags', () => {
    const draft = toDraft(minimal, names);
    const rule = { matchingPattern: '*', matchingTags: ['ui'], matchingTagOperator: 'Any' as const };
    const collection = {
      ...draft.collections[0],
      name: 'main',
      bundledKeyPrefix: '',
      mergeStrategy: 'merge' as const,
      allEntries: false,
      rules: [rule],
    };
    expect(toDefinition({ ...draft, collections: [collection] }).collections).toEqual([
      {
        name: 'main',
        entriesSelectionRules: [{ matchingPattern: '*', matchingTags: ['ui'], matchingTagOperator: 'Any' }],
      },
    ]);
    expect(
      toDefinition({ ...draft, collections: [{ ...collection, rules: [{ ...rule, matchingTags: [] }] }] }).collections,
    ).toEqual([{ name: 'main', entriesSelectionRules: [{ matchingPattern: '*' }] }]);
    expect(
      toDefinition({ ...draft, collections: [{ ...collection, rules: [{ ...rule, matchingTags: ['  '] }] }] })
        .collections,
    ).toEqual([
      {
        name: 'main',
        entriesSelectionRules: [{ matchingPattern: '*', matchingTags: ['  '], matchingTagOperator: 'Any' }],
      },
    ]);
  });
});

describe('Bundle Draft preview and validation', () => {
  it.each(['name', 'dist', 'bundleName'] as const)('does not dry run without %s', (field) => {
    const draft = { ...toDraft(minimal, names), name: 'main' };
    expect(dryRunRequest({ ...draft, [field]: '  ' })).toBeUndefined();
  });

  it('uses the trimmed name and definition in a dry run', () => {
    const draft = { ...toDraft(minimal, names), name: ' main ' };
    expect(dryRunRequest(draft)).toEqual({ name: 'main', bundle: toDefinition(draft) });
  });

  it('derives the same output summary, files, type name and local tree', () => {
    const draft = {
      ...toDraft(minimal, names),
      bundleName: '{locale}/admin',
      dist: ' ./dist//i18n/ ',
      typesEnabled: true,
      typeDistFile: './dist/types/admin.ts',
    };
    expect(outputSummary(draft)).toBe('dist/i18n/{locale}/admin.json');
    expect(typeFileName(draft)).toBe('admin.ts');
    expect(patternFiles(draft, ['en', 'fr'])).toEqual(['en/admin.json', 'fr/admin.json']);
    expect(outputFiles(draft, ['en', 'fr'])).toEqual(['dist/i18n/en/admin.json', 'dist/i18n/fr/admin.json']);
    expect(
      localTree(draft, ['en', 'fr']).map((folder) => ({
        path: folder.path,
        files: folder.files.map((file) => [file.name, file.kind, file.exists]),
      })),
    ).toEqual([
      { path: 'dist/i18n/en', files: [['admin.json', 'bundle', undefined]] },
      { path: 'dist/i18n/fr', files: [['admin.json', 'bundle', undefined]] },
      { path: 'dist/types', files: [['admin.ts', 'types', undefined]] },
    ]);
  });

  it('delegates empty collection and rule choices to the domain rules', () => {
    expect(collectionsRequired(false, 0)).toBe(true);
    expect(collectionsRequired(true, 0)).toBe(false);
    expect(collectionsRequired(false, 1)).toBe(false);
    expect(rulesRequired(false, 0)).toBe(true);
    expect(rulesRequired(true, 0)).toBe(false);
    expect(rulesRequired(false, 1)).toBe(false);
    expect(collectionsRequired(true, 2)).toBe(false);
    expect(rulesRequired(true, 2)).toBe(false);
  });

  it.each([
    [['types', 'coll:1', 'output'], 'output'],
    [['types', 'coll:1', 'collections'], 'collections'],
    [['types', 'coll:1', 'coll:0'], 'coll:0'],
    [['types', 'coll:1'], 'coll:1'],
    [['types'], 'types'],
    [[], undefined],
  ] as [
    BundleSection[],
    BundleSection | undefined,
  ][])('reveals the first section in rail order', (errors, expected) => {
    expect(firstErrorSection(new Set(errors), 2)).toBe(expected);
  });
});
