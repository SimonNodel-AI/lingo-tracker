import { describe, expect, it } from 'vitest';
import { bundleFindings } from './bundle-findings';
import type { BundleTypeOutcome, BundleWarning } from './generate-bundle';

describe('bundleFindings', () => {
  it('preserves order, origins and repeated messages without mutating warnings', () => {
    const warnings: readonly BundleWarning[] = Object.freeze([
      { origin: 'generation', message: 'same' },
      { origin: 'config', message: 'advisory' },
      { origin: 'generation', message: 'same' },
      { origin: 'type', message: 'type warning' },
    ]);
    const findings = bundleFindings({ warnings });
    expect(findings.messages).toEqual(['same', 'advisory', 'same', 'type warning']);
    expect(findings.byOrigin).toEqual({
      generation: ['same', 'same'],
      config: ['advisory'],
      type: ['type warning'],
    });
    findings.messages.push('extra');
    findings.byOrigin.config.push('extra');
    expect(warnings).toHaveLength(4);
    expect(warnings[1]?.message).toBe('advisory');
  });

  it('classifies prepared advisories without inventing a type outcome', () => {
    expect(bundleFindings({ warnings: [{ origin: 'config', message: 'deprecation' }] })).toEqual({
      messages: ['deprecation'],
      byOrigin: { generation: [], config: ['deprecation'], type: [] },
      types: {},
    });
  });

  const cases: { outcome: BundleTypeOutcome; expected: object }[] = [
    {
      outcome: { status: 'written', path: '../types.ts', keysCount: 0 },
      expected: { written: { path: '../types.ts', keysCount: 0 } },
    },
    { outcome: { status: 'failed', reason: '' }, expected: { failure: '' } },
    { outcome: { status: 'skipped', reason: 'empty-bundle' }, expected: { skipped: 'bundle is empty' } },
    { outcome: { status: 'not-configured' }, expected: { skipped: 'no typeDistFile configured' } },
  ];
  it.each(cases)('summarises $outcome.status without adding warnings or type metadata', ({ outcome, expected }) => {
    const findings = bundleFindings({ warnings: [], typeOutcome: outcome });
    expect(findings.types).toEqual(expected);
    expect(findings.messages).toEqual([]);
    expect(findings.byOrigin).toEqual({ generation: [], config: [], type: [] });
  });
});
