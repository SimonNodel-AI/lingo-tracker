import type { GenerateBundleResult } from './generate-bundle';

/** Complete warning list, in generation, config, then type order; no result mutation. */
export function bundleResultWarnings(
  result: Pick<GenerateBundleResult, 'warnings' | 'configWarning' | 'typeWarning'>,
): string[] {
  return [
    ...result.warnings,
    ...(result.configWarning ? [result.configWarning] : []),
    ...(result.typeWarning ? [result.typeWarning] : []),
  ];
}
