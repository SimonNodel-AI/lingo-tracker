import { describe, expect, it } from 'vitest';
import type { BundleDefinition } from '@simoncodes-ca/domain';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { resolveBundleSettings } from './resolve-bundle-settings';

const base: LingoTrackerConfig = {
  exportFolder: 'export',
  importFolder: 'import',
  baseLocale: 'en',
  locales: ['en'],
  collections: {},
};
const definition: BundleDefinition = { bundleName: '{locale}', dist: 'dist', collections: 'All' };

describe('resolveBundleSettings', () => {
  it.each([
    ['defaults', {}, {}, {}, 'upperCase', true],
    ['global', { tokenCasing: 'camelCase', transformICUToTransloco: false }, {}, {}, 'camelCase', false],
    [
      'definition',
      { tokenCasing: 'upperCase', transformICUToTransloco: true },
      { tokenCasing: 'camelCase', transformICUToTransloco: false },
      {},
      'camelCase',
      false,
    ],
    [
      'overrides',
      { tokenCasing: 'upperCase', transformICUToTransloco: true },
      { tokenCasing: 'upperCase', transformICUToTransloco: true },
      { tokenCasing: 'camelCase', transformICUToTransloco: false },
      'camelCase',
      false,
    ],
  ] as const)('%s wins in precedence', (_label, global, bundle, overrides, tokenCasing, transformICUToTransloco) => {
    expect(resolveBundleSettings({ ...base, ...global }, { ...definition, ...bundle }, overrides)).toEqual({
      tokenCasing,
      transformICUToTransloco,
    });
  });
});
