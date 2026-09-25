import { describe, expect, it } from 'vitest';
import { displayStatus } from './display-status';

describe('displayStatus', () => {
  it('is the stored status when there is one', () => {
    expect(displayStatus({ locale: 'es', status: 'stale', needsWork: true, sameAsBase: false })).toBe('stale');
    expect(displayStatus({ locale: 'es', status: 'verified', needsWork: false, sameAsBase: false })).toBe('verified');
  });

  it('is new for a target that needs work and has no stored status (no metadata)', () => {
    expect(displayStatus({ locale: 'es', needsWork: true, sameAsBase: false })).toBe('new');
  });

  it('is undefined for no target, or a target with no status that needs no work', () => {
    expect(displayStatus(undefined)).toBeUndefined();
    expect(displayStatus({ locale: 'es', needsWork: false, sameAsBase: false })).toBeUndefined();
  });
});
