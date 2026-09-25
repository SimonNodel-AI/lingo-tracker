import { describe, expect, it } from 'vitest';
import type { TranslationStatus } from './translation-status';
import { countByStatus, STATUS_PRECEDENCE, type StatusCounts, worstStatus } from './translation-status-summary';

const ZERO: StatusCounts = { stale: 0, new: 0, translated: 0, verified: 0 };

describe('STATUS_PRECEDENCE', () => {
  it('lists every status once, worst first', () => {
    expect(STATUS_PRECEDENCE).toEqual(['stale', 'new', 'translated', 'verified']);
  });
});

describe('countByStatus', () => {
  it.each<[string, (TranslationStatus | undefined)[], StatusCounts]>([
    ['no statuses', [], ZERO],
    ['one of each', ['stale', 'new', 'translated', 'verified'], { stale: 1, new: 1, translated: 1, verified: 1 }],
    ['repeated statuses', ['verified', 'verified', 'stale'], { ...ZERO, verified: 2, stale: 1 }],
    ['undefined (e.g. the base locale) is not counted', [undefined, 'new', undefined], { ...ZERO, new: 1 }],
  ])('%s', (_name, statuses, expected) => {
    expect(countByStatus(statuses)).toEqual(expected);
  });

  it('ignores values that are not a known status', () => {
    const fromTheWire = ['missing', 'toString', 'new'] as unknown as TranslationStatus[];
    expect(countByStatus(fromTheWire)).toEqual({ ...ZERO, new: 1 });
  });

  it('accepts the values of a status-by-locale map', () => {
    const statusByLocale: Record<string, TranslationStatus | undefined> = {
      en: undefined,
      es: 'translated',
      fr: 'verified',
    };
    expect(countByStatus(Object.values(statusByLocale))).toEqual({ ...ZERO, translated: 1, verified: 1 });
  });
});

describe('worstStatus', () => {
  it('is undefined when every count is zero', () => {
    expect(worstStatus(ZERO)).toBeUndefined();
  });

  it.each(STATUS_PRECEDENCE)('is %s when it is the only status', (status) => {
    expect(worstStatus({ ...ZERO, [status]: 3 })).toBe(status);
  });

  // Every pair (a, b) where a is worse than b: a wins regardless of the counts.
  const pairs = STATUS_PRECEDENCE.flatMap((worse, i) =>
    STATUS_PRECEDENCE.slice(i + 1).map((better) => [worse, better]),
  );

  it.each(pairs)('%s beats %s', (worse, better) => {
    expect(worstStatus({ ...ZERO, [worse]: 1, [better]: 5 })).toBe(worse);
  });

  it('reports the worst status of a real entry', () => {
    expect(worstStatus(countByStatus(['verified', 'translated', 'stale']))).toBe('stale');
    expect(worstStatus(countByStatus(['verified', 'verified']))).toBe('verified');
  });
});
