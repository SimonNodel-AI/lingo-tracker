import type { BundleDefinition, TokenCasing } from '@simoncodes-ca/domain';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';

export interface BundleSettingsOverrides {
  readonly tokenCasing?: TokenCasing;
  readonly transformICUToTransloco?: boolean;
}

/** One precedence rule for generation and planning. */
export function resolveBundleSettings(
  config: LingoTrackerConfig,
  definition: BundleDefinition,
  overrides: BundleSettingsOverrides = {},
): { tokenCasing: TokenCasing; transformICUToTransloco: boolean } {
  return {
    tokenCasing: overrides.tokenCasing ?? definition.tokenCasing ?? config.tokenCasing ?? 'upperCase',
    transformICUToTransloco:
      overrides.transformICUToTransloco ?? definition.transformICUToTransloco ?? config.transformICUToTransloco ?? true,
  };
}
