import { describe, expect, it } from 'vitest';
import { bundleResultWarnings } from './result-warnings';

describe('bundleResultWarnings', () => {
  it('combines generation, config and type warnings once in the established API order', () => {
    const warnings = ['generation'];
    const result = bundleResultWarnings({ warnings, configWarning: 'config', typeWarning: 'type' });
    expect(result).toEqual(['generation', 'config', 'type']);
    result.push('extra');
    expect(warnings).toEqual(['generation']);
  });

  it('does not invent missing warnings', () => {
    expect(bundleResultWarnings({ warnings: [] })).toEqual([]);
  });
});
