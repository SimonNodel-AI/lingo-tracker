import { describe, it, expect } from 'vitest';
import {
  applyBaseChange,
  isUntranslatedCopy,
  needsTranslation,
  recordTranslation,
  resolveImportStatus,
  type EntryLocaleMetadata,
  type ResolveImportStatusParams,
} from './staleness';

describe('isUntranslatedCopy', () => {
  it('is true when the translation equals the base', () => {
    expect(isUntranslatedCopy('OK', 'OK')).toBe(true);
  });

  it('is false when the translation differs from the base', () => {
    expect(isUntranslatedCopy('Accepter', 'OK')).toBe(false);
  });
});

describe('applyBaseChange', () => {
  const entryMeta: EntryLocaleMetadata = {
    en: { checksum: 'base-old' },
    fr: { checksum: 'fr-sum', baseChecksum: 'base-old', status: 'verified' },
    es: { checksum: 'es-sum', baseChecksum: 'base-old', status: 'translated' },
    de: { checksum: 'base-new', baseChecksum: 'base-old', status: 'translated' },
  };

  it('updates the base checksum', () => {
    const result = applyBaseChange(entryMeta, 'en', 'base-new');
    expect(result['en']).toEqual({ checksum: 'base-new' });
  });

  it('marks every translated locale stale and points it at the new base, including verified ones', () => {
    const result = applyBaseChange(entryMeta, 'en', 'base-new');
    expect(result['fr']).toEqual({ checksum: 'fr-sum', baseChecksum: 'base-new', status: 'stale' });
    expect(result['es']).toEqual({ checksum: 'es-sum', baseChecksum: 'base-new', status: 'stale' });
  });

  it('marks a locale "new" when its value is an untranslated copy of the new base', () => {
    const result = applyBaseChange(entryMeta, 'en', 'base-new');
    expect(result['de']).toEqual({ checksum: 'base-new', baseChecksum: 'base-new', status: 'new' });
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(entryMeta);
    applyBaseChange(entryMeta, 'en', 'base-new');
    expect(JSON.stringify(entryMeta)).toBe(before);
  });

  it('creates base metadata when there was none', () => {
    expect(applyBaseChange({}, 'en', 'sum')).toEqual({ en: { checksum: 'sum' } });
  });

  it('keeps locale key order so files diff cleanly', () => {
    const result = applyBaseChange(entryMeta, 'en', 'base-new');
    expect(Object.keys(result)).toEqual(['en', 'fr', 'es', 'de']);
  });
});

describe('recordTranslation', () => {
  it('sets the locale metadata and leaves other locales alone', () => {
    const entryMeta: EntryLocaleMetadata = {
      en: { checksum: 'base' },
      es: { checksum: 'es', baseChecksum: 'base', status: 'verified' },
    };

    const result = recordTranslation(entryMeta, 'fr', 'fr-sum', 'base', 'translated');

    expect(result).toEqual({
      en: { checksum: 'base' },
      es: { checksum: 'es', baseChecksum: 'base', status: 'verified' },
      fr: { checksum: 'fr-sum', baseChecksum: 'base', status: 'translated' },
    });
    expect(entryMeta).not.toHaveProperty('fr');
  });

  it('replaces existing locale metadata', () => {
    const result = recordTranslation(
      { fr: { checksum: 'old', baseChecksum: 'old-base', status: 'stale' } },
      'fr',
      'new',
      'base',
      'verified',
    );
    expect(result['fr']).toEqual({ checksum: 'new', baseChecksum: 'base', status: 'verified' });
  });
});

describe('needsTranslation', () => {
  it('is true when there is no metadata', () => {
    expect(needsTranslation(undefined)).toBe(true);
  });

  it.each(['new', 'stale'] as const)('is true for %s', (status) => {
    expect(needsTranslation({ checksum: 'x', status })).toBe(true);
  });

  it.each(['translated', 'verified'] as const)('is false for %s', (status) => {
    expect(needsTranslation({ checksum: 'x', status })).toBe(false);
  });
});

describe('resolveImportStatus', () => {
  const base: ResolveImportStatusParams = {
    strategy: 'translation-service',
    oldStatus: undefined,
    incomingStatus: undefined,
    valueChanged: true,
    baseChecksumChanged: false,
  };

  it('uses an honoured incoming status over every strategy', () => {
    expect(resolveImportStatus({ ...base, strategy: 'verification', incomingStatus: 'stale' })).toBe('stale');
  });

  it('verification always verifies', () => {
    expect(resolveImportStatus({ ...base, strategy: 'verification', valueChanged: false, oldStatus: 'stale' })).toBe(
      'verified',
    );
  });

  it('update keeps the previous status, defaulting to translated', () => {
    expect(resolveImportStatus({ ...base, strategy: 'update', oldStatus: 'verified' })).toBe('verified');
    expect(resolveImportStatus({ ...base, strategy: 'update' })).toBe('translated');
  });

  it.each(['translation-service', 'migration'] as const)('%s marks a changed value translated', (strategy) => {
    expect(resolveImportStatus({ ...base, strategy, oldStatus: 'verified' })).toBe('translated');
  });

  describe('unchanged value', () => {
    const unchanged = { ...base, valueChanged: false };

    it('translation-service re-confirms a stale value as translated', () => {
      expect(resolveImportStatus({ ...unchanged, oldStatus: 'stale' })).toBe('translated');
    });

    it('translation-service re-confirms when the base checksum moved', () => {
      expect(resolveImportStatus({ ...unchanged, oldStatus: 'new', baseChecksumChanged: true })).toBe('translated');
    });

    it('translation-service keeps a verified status when nothing moved', () => {
      expect(resolveImportStatus({ ...unchanged, oldStatus: 'verified' })).toBe('verified');
    });

    it('migration keeps the previous status', () => {
      expect(resolveImportStatus({ ...unchanged, strategy: 'migration', oldStatus: 'stale' })).toBe('stale');
      expect(resolveImportStatus({ ...unchanged, strategy: 'migration' })).toBe('translated');
    });
  });
});
