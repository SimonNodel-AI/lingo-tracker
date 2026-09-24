import type { BundlePlan, GenerateBundleResult } from '@simoncodes-ca/core';
import type { BundleDefinition } from '@simoncodes-ca/domain';
import { MAX_CONFLICT_KEYS, mapBundlePlanToDto, mapGenerateBundleResultToJobResult } from './bundle.mapper';

describe('bundle.mapper', () => {
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
