import type { BundleDefinition, BundlePlan, GenerateBundleResult } from '@simoncodes-ca/core';
import type { BundleDefinitionDto } from '@simoncodes-ca/data-transfer';
import {
  MAX_CONFLICT_KEYS,
  mapBundleDefinitionToDto,
  mapBundlePlanToDto,
  mapDtoToBundleDefinition,
  mapGenerateBundleResultToJobResult,
} from './bundle.mapper';

describe('bundle.mapper', () => {
  const fullDefinition: BundleDefinition = {
    bundleName: 'main.{locale}',
    dist: './dist/i18n',
    collections: [
      {
        name: 'app',
        bundledKeyPrefix: 'app',
        entriesSelectionRules: [{ matchingPattern: 'apps.*', matchingTags: ['ui'], matchingTagOperator: 'All' }],
        mergeStrategy: 'override',
      },
    ],
    typeDistFile: './dist/i18n-types/main.ts',
    tokenCasing: 'camelCase',
    tokenConstantName: 'MAIN_KEYS',
    transformICUToTransloco: false,
  };

  describe('mapBundleDefinitionToDto', () => {
    it('maps every field and copies nested arrays', () => {
      const dto = mapBundleDefinitionToDto(fullDefinition);

      expect(dto).toEqual(fullDefinition);
      expect(dto.collections).not.toBe(fullDefinition.collections);
      const [collection] = dto.collections as Exclude<typeof dto.collections, 'All'>;
      const [sourceCollection] = fullDefinition.collections as Exclude<typeof fullDefinition.collections, 'All'>;
      expect(collection.entriesSelectionRules).not.toBe(sourceCollection.entriesSelectionRules);
    });

    it("passes 'All' through and omits absent optionals", () => {
      const dto = mapBundleDefinitionToDto({ bundleName: '{locale}', dist: './dist', collections: 'All' });

      expect(dto).toEqual({ bundleName: '{locale}', dist: './dist', collections: 'All' });
      expect('typeDistFile' in dto).toBe(false);
      expect('transformICUToTransloco' in dto).toBe(false);
    });
  });

  describe('mapDtoToBundleDefinition', () => {
    it('trims strings and drops empty optionals', () => {
      const dto: BundleDefinitionDto = {
        bundleName: '  main.{locale} ',
        dist: ' ./dist ',
        collections: [
          {
            name: ' app ',
            bundledKeyPrefix: '   ',
            entriesSelectionRules: [{ matchingPattern: ' apps.* ', matchingTags: [' ui ', ''] }],
          },
        ],
        typeDistFile: '',
        tokenConstantName: '  ',
      };

      const definition = mapDtoToBundleDefinition(dto);

      expect(definition).toEqual({
        bundleName: 'main.{locale}',
        dist: './dist',
        collections: [{ name: 'app', entriesSelectionRules: [{ matchingPattern: 'apps.*', matchingTags: ['ui'] }] }],
      });
      expect('typeDistFile' in definition).toBe(false);
      expect('tokenConstantName' in definition).toBe(false);
    });

    it('keeps explicit false for transformICUToTransloco and passes All through', () => {
      const definition = mapDtoToBundleDefinition({
        bundleName: '{locale}',
        dist: './dist',
        collections: 'All',
        transformICUToTransloco: false,
        tokenCasing: 'upperCase',
      });

      expect(definition.transformICUToTransloco).toBe(false);
      expect(definition.tokenCasing).toBe('upperCase');
      expect(definition.collections).toBe('All');
    });

    it('does not alias arrays from the DTO', () => {
      const tags = ['ui'];
      const dto: BundleDefinitionDto = {
        bundleName: '{locale}',
        dist: './dist',
        collections: [{ name: 'app', entriesSelectionRules: [{ matchingPattern: '*', matchingTags: tags }] }],
      };

      const definition = mapDtoToBundleDefinition(dto);
      const [collection] = definition.collections as Exclude<BundleDefinition['collections'], 'All'>;
      const [rule] = collection.entriesSelectionRules as Exclude<typeof collection.entriesSelectionRules, 'All'>;

      expect(rule.matchingTags).toEqual(['ui']);
      expect(rule.matchingTags).not.toBe(tags);
    });

    it('round-trips a full definition', () => {
      expect(mapDtoToBundleDefinition(mapBundleDefinitionToDto(fullDefinition))).toEqual(fullDefinition);
    });
  });

  describe('mapBundlePlanToDto', () => {
    const plan: BundlePlan = {
      bundleKey: 'main',
      locales: ['en', 'fr'],
      files: [
        {
          path: 'dist/en.json',
          absolutePath: '/w/dist/en.json',
          kind: 'bundle',
          locale: 'en',
          exists: true,
          keysCount: 3,
        },
        { path: 'dist/main.ts', absolutePath: '/w/dist/main.ts', kind: 'types', exists: false, keysCount: 3 },
      ],
      keysPerLocale: { en: 3, fr: 2 },
      conflictsCount: 60,
      conflictKeys: Array.from({ length: 60 }, (_, index) => `key.${index}`),
      hierarchicalConflicts: Array.from({ length: 60 }, (_, index) => `parent.${index}`),
      exampleKey: { collectionName: 'app', sourceKey: 'a.b', bundledKey: 'a.b', tokenPath: 'MAIN_TOKENS.A.B' },
      warnings: ['w'],
    };

    it('drops absolutePath and keeps locale only on bundle files', () => {
      const dto = mapBundlePlanToDto(plan);

      expect(dto.files[0]).toEqual({ path: 'dist/en.json', kind: 'bundle', locale: 'en', exists: true, keysCount: 3 });
      expect(dto.files[1]).toEqual({ path: 'dist/main.ts', kind: 'types', exists: false, keysCount: 3 });
      expect('absolutePath' in dto.files[0]).toBe(false);
      expect('locale' in dto.files[1]).toBe(false);
    });

    it('caps conflictKeys but reports the full conflictsCount', () => {
      const dto = mapBundlePlanToDto(plan);

      expect(dto.conflictKeys).toHaveLength(MAX_CONFLICT_KEYS);
      expect(dto.conflictsCount).toBe(60);
    });

    it('caps hierarchicalConflicts the same way as conflictKeys', () => {
      const dto = mapBundlePlanToDto(plan);

      expect(dto.hierarchicalConflicts).toHaveLength(MAX_CONFLICT_KEYS);
      expect(dto.hierarchicalConflicts[0]).toBe('parent.0');
    });

    it('maps name, locales, exampleKey and warnings', () => {
      const dto = mapBundlePlanToDto(plan);

      expect(dto.name).toBe('main');
      expect(dto.locales).toEqual(['en', 'fr']);
      expect(dto.exampleKey).toEqual(plan.exampleKey);
      expect(dto.warnings).toEqual(['w']);
      expect(dto.keysPerLocale).toEqual({ en: 3, fr: 2 });
    });

    it('omits exampleKey when the plan has none', () => {
      const dto = mapBundlePlanToDto({ ...plan, exampleKey: undefined });

      expect('exampleKey' in dto).toBe(false);
    });
  });

  describe('mapGenerateBundleResultToJobResult', () => {
    const definition: BundleDefinition = {
      bundleName: 'main.{locale}',
      dist: './dist/i18n',
      collections: 'All',
      typeDistFile: './dist/types/main.ts',
    };

    const result: GenerateBundleResult = {
      bundleKey: 'main',
      filesGenerated: 2,
      warnings: ['Bundle empty for de'],
      localesProcessed: ['en', 'fr'],
      keysPerLocale: { en: 4, fr: 4 },
      typeGenerationResult: {
        bundleKey: 'main',
        typeDistFile: './dist/types/main.ts',
        keysCount: 4,
        fileGenerated: true,
      },
    };

    it('rebuilds written paths from processed locales and appends the types file', () => {
      const dto = mapGenerateBundleResultToJobResult(result, definition, '/workspace');

      expect(dto.filesGenerated).toEqual(['dist/i18n/main.en.json', 'dist/i18n/main.fr.json', 'dist/types/main.ts']);
      expect(dto.typeDistFile).toBe('dist/types/main.ts');
      expect(dto.typesKeysCount).toBe(4);
      expect(dto.localesProcessed).toEqual(['en', 'fr']);
      expect(dto.keysPerLocale).toEqual({ en: 4, fr: 4 });
      expect(dto.warnings).toEqual(['Bundle empty for de']);
    });

    it('makes an absolute types path relative to cwd', () => {
      const dto = mapGenerateBundleResultToJobResult(
        {
          ...result,
          typeGenerationResult: {
            ...result.typeGenerationResult,
            typeDistFile: '/workspace/dist/types/main.ts',
          } as never,
        },
        definition,
        '/workspace',
      );

      expect(dto.typeDistFile).toBe('dist/types/main.ts');
      expect(dto.filesGenerated).toContain('dist/types/main.ts');
    });

    it('leaves paths outside cwd untouched', () => {
      const dto = mapGenerateBundleResultToJobResult(
        {
          ...result,
          typeGenerationResult: { ...result.typeGenerationResult, typeDistFile: '/elsewhere/types/main.ts' } as never,
        },
        definition,
        '/workspace',
      );

      expect(dto.typeDistFile).toBe('/elsewhere/types/main.ts');
    });

    it('omits type fields when no types file was written', () => {
      const dto = mapGenerateBundleResultToJobResult(
        { ...result, typeGenerationResult: { ...result.typeGenerationResult, fileGenerated: false } as never },
        definition,
      );

      expect(dto.filesGenerated).toHaveLength(2);
      expect('typeDistFile' in dto).toBe(false);
      expect('typesKeysCount' in dto).toBe(false);
    });

    it('omits type fields when type generation did not run', () => {
      const dto = mapGenerateBundleResultToJobResult({ ...result, typeGenerationResult: undefined }, definition);

      expect(dto.filesGenerated).toHaveLength(2);
      expect(dto.typeDistFile).toBeUndefined();
    });
  });
});
