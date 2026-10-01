import { describe, expect, it } from 'vitest';
import { canImportLocale, DEFAULT_IMPORT_STRATEGY, importableLocales } from './import-rules';

describe('import rules', () => {
  it('shares the strategy default and locale choices with import prompts', () => {
    expect(DEFAULT_IMPORT_STRATEGY).toBe('translation-service');
    expect(importableLocales(['en', 'es'], 'en', DEFAULT_IMPORT_STRATEGY)).toEqual(['es']);
    expect(importableLocales(['en', 'es'], 'en', 'migration')).toEqual(['en', 'es']);
    expect(canImportLocale('en', 'en', DEFAULT_IMPORT_STRATEGY)).toBe(false);
    expect(canImportLocale('en', 'en', 'migration')).toBe(true);
  });
});
