import { join } from 'node:path';
import type { TranslationStatus } from '@simoncodes-ca/domain';
import { describe, expect, it } from 'vitest';
import type { Collection } from '../config/open-collection';
import {
  type SeedResource,
  seedResources,
  testCollection,
  useTempDir,
  writeFolderFiles,
} from '../../testing/temp-dir.spec-helpers';
import { validateResources } from './validate-resources';

describe('validateResources (real fs)', () => {
  const root = useTempDir('validate-resources-');

  /** A collection in its own subfolder of the temp dir; targets `es` and `fr` unless told otherwise. */
  function collection(name = 'main', overrides: Partial<Collection> = {}): Collection {
    return testCollection(join(root(), name), { name, locales: ['en', 'es', 'fr'], ...overrides });
  }

  /** A resource whose translations all have the given status. */
  function withStatus(source: string, statuses: Record<string, TranslationStatus>): SeedResource {
    return {
      source,
      translations: Object.fromEntries(
        Object.entries(statuses).map(([locale, status]) => [locale, { value: `${source} (${locale})`, status }]),
      ),
    };
  }

  describe('status', () => {
    it('passes when every resource is verified in every target locale', () => {
      const main = collection();
      seedResources(main, {
        'common.ok': withStatus('OK', { es: 'verified', fr: 'verified' }),
        'common.cancel': withStatus('Cancel', { es: 'verified', fr: 'verified' }),
      });

      const result = validateResources([main], { allowTranslated: false });

      expect(result.passed).toBe(true);
      expect(result.successes).toHaveLength(4);
      expect(result.failures).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.totalResourcesValidated).toBe(4);
      expect(result.totalUniqueKeys).toBe(2);
      expect(result.localesValidated).toBe(2);
      expect(result.collectionsValidated).toBe(1);
      expect(result.statusCounts).toEqual({ new: 0, translated: 0, stale: 0, verified: 4 });
      expect(result.unreadableFolders).toEqual([]);
    });

    it('passes for a collection without resources', () => {
      const result = validateResources([collection()], { allowTranslated: false });

      expect(result.passed).toBe(true);
      expect(result.totalResourcesValidated).toBe(0);
      expect(result.totalUniqueKeys).toBe(0);
    });

    it('fails new and stale translations', () => {
      const main = collection();
      seedResources(main, { 'common.ok': withStatus('OK', { es: 'new', fr: 'stale' }) });

      const result = validateResources([main], { allowTranslated: false });

      expect(result.passed).toBe(false);
      expect(result.failures).toEqual([
        { key: 'common.ok', locale: 'es', collection: 'main', status: 'new' },
        { key: 'common.ok', locale: 'fr', collection: 'main', status: 'stale' },
      ]);
      expect(result.statusCounts).toEqual({ new: 1, translated: 0, stale: 1, verified: 0 });
    });

    it('treats a locale without a status as new, including an entry without metadata', () => {
      const main = collection();
      seedResources(main, { 'common.ok': withStatus('OK', { es: 'verified' }) });
      writeFolderFiles(main.translationsFolder, 'loose', { entries: { orphan: { source: 'Orphan' } } });

      const result = validateResources([main], { allowTranslated: false });

      expect(result.failures.map((failure) => `${failure.key}/${failure.locale}/${failure.status}`)).toEqual([
        'common.ok/fr/new',
        'loose.orphan/es/new',
        'loose.orphan/fr/new',
      ]);
    });

    it('fails translated resources by default and warns with allowTranslated', () => {
      const main = collection();
      seedResources(main, { 'common.ok': withStatus('OK', { es: 'translated', fr: 'verified' }) });

      const strict = validateResources([main], { allowTranslated: false });
      const relaxed = validateResources([main], { allowTranslated: true });

      expect(strict.passed).toBe(false);
      expect(strict.failures).toEqual([{ key: 'common.ok', locale: 'es', collection: 'main', status: 'translated' }]);
      expect(relaxed.passed).toBe(true);
      expect(relaxed.warnings).toEqual([{ key: 'common.ok', locale: 'es', collection: 'main', status: 'translated' }]);
      expect(relaxed.successes).toHaveLength(1);
    });

    it('collects every failure without stopping early', () => {
      const main = collection('main', { locales: ['en', 'es', 'fr', 'de'] });
      seedResources(
        main,
        Object.fromEntries(
          Array.from({ length: 20 }, (_, index) => [`ns.key${index}`, withStatus(`V${index}`, { es: 'new' })]),
        ),
      );

      const result = validateResources([main], { allowTranslated: false });

      // es is new; fr and de have no status at all
      expect(result.failures).toHaveLength(60);
      expect(result.statusCounts.new).toBe(60);
    });
  });

  describe('per collection', () => {
    it('validates each collection against its own target locales and counts distinct locales', () => {
      const common = collection('common');
      const admin = collection('admin', { locales: ['en', 'de'] });
      seedResources(common, { ok: withStatus('OK', { es: 'verified', fr: 'verified' }) });
      seedResources(admin, { users: withStatus('Users', { de: 'new' }) });

      const result = validateResources([common, admin], { allowTranslated: false });

      expect(result.successes.map((detail) => `${detail.collection}/${detail.locale}`)).toEqual([
        'common/es',
        'common/fr',
      ]);
      expect(result.failures).toEqual([{ key: 'users', locale: 'de', collection: 'admin', status: 'new' }]);
      expect(result.totalResourcesValidated).toBe(3);
      expect(result.localesValidated).toBe(3);
      expect(result.collectionsValidated).toBe(2);
    });

    it('validates a key present in two collections in both', () => {
      const first = collection('first');
      const second = collection('second');
      seedResources(first, { 'shared.title': withStatus('Title', { es: 'verified', fr: 'verified' }) });
      seedResources(second, { 'shared.title': withStatus('Title', { es: 'new', fr: 'verified' }) });

      const result = validateResources([first, second], { allowTranslated: false });

      expect(result.totalUniqueKeys).toBe(2);
      expect(result.totalResourcesValidated).toBe(4);
      expect(result.failures).toEqual([{ key: 'shared.title', locale: 'es', collection: 'second', status: 'new' }]);
    });

    it('treats the base locale of a collection as its source, not as a target', () => {
      const french = collection('french', { baseLocale: 'fr', locales: ['fr', 'en'] });
      seedResources(french, { ok: withStatus('Bien', { en: 'verified' }) });

      const result = validateResources([french], { allowTranslated: false });

      expect(result.passed).toBe(true);
      expect(result.successes).toEqual([{ key: 'ok', locale: 'en', collection: 'french', status: 'verified' }]);
    });

    it('leaves skipped locales out of every collection', () => {
      const main = collection();
      seedResources(main, { ok: withStatus('OK', { es: 'verified', fr: 'new' }) });

      const result = validateResources([main], { allowTranslated: false, skippedLocales: ['fr'] });

      expect(result.passed).toBe(true);
      expect(result.localesValidated).toBe(1);
      expect(result.totalResourcesValidated).toBe(1);
    });

    it('validates nothing for a collection whose target locales are all skipped', () => {
      const main = collection('main', { locales: ['en', 'es'] });
      seedResources(main, { ok: withStatus('OK', { es: 'new' }) });

      const result = validateResources([main], { allowTranslated: false, skippedLocales: ['es'] });

      expect(result.passed).toBe(true);
      expect(result.totalResourcesValidated).toBe(0);
      expect(result.localesValidated).toBe(0);
    });
  });

  describe('unreadable folders', () => {
    it('fails validation and names the folder and file', () => {
      const main = collection();
      seedResources(main, { 'good.ok': withStatus('OK', { es: 'verified', fr: 'verified' }) });
      writeFolderFiles(main.translationsFolder, 'bad', { entries: { x: { source: 'X' } }, meta: '{ broken' });

      const result = validateResources([main], { allowTranslated: false });

      expect(result.passed).toBe(false);
      expect(result.failures).toHaveLength(0);
      expect(result.successes).toHaveLength(2);
      expect(result.unreadableFolders).toHaveLength(1);
      expect(result.unreadableFolders?.[0]).toMatchObject({ collection: 'main', folderPath: 'bad' });
      expect(result.unreadableFolders?.[0]?.message).toContain('tracker_meta.json');
    });
  });

  describe('ICU and placeholders', () => {
    it("compiles each collection's base values under its own base locale", () => {
      const main = collection('main', { locales: ['en', 'es'] });
      const japanese = collection('japanese', { baseLocale: 'ja', locales: ['ja', 'en'] });
      const plural = '{count, plural, one {# item} other {# items}}';
      seedResources(main, { count: { source: plural, translations: { es: { value: plural, status: 'verified' } } } });
      seedResources(japanese, {
        count: { source: plural, translations: { en: { value: plural, status: 'verified' } } },
      });

      const result = validateResources([main, japanese], {
        allowTranslated: false,
        icu: { compileValues: true, requirePortablePlurals: true },
      });

      expect(result.icu?.valuesChecked).toBe(4);
      // The portability rule reads base values only, each under its own collection's base locale.
      expect(result.icu?.warnings.map((warning) => `${warning.collection}/${warning.locale}`)).toEqual([
        'main/en',
        'japanese/ja',
      ]);
    });

    it("compares each translation with its collection's base value", () => {
      const french = collection('french', { baseLocale: 'fr', locales: ['fr', 'en'] });
      seedResources(french, {
        greeting: { source: 'Bonjour {name}', translations: { en: { value: 'Hello {nom}', status: 'verified' } } },
      });

      const result = validateResources([french], { allowTranslated: false, placeholders: true });

      expect(result.passed).toBe(false);
      expect(result.placeholders?.valuesChecked).toBe(1);
      expect(result.placeholders?.failures).toMatchObject([
        { key: 'greeting', locale: 'en', collection: 'french', missing: ['name'], unexpected: ['nom'] },
      ]);
    });

    it('leaves the ICU and placeholder results undefined when not requested', () => {
      const result = validateResources([collection()], { allowTranslated: false });

      expect(result.icu).toBeUndefined();
      expect(result.placeholders).toBeUndefined();
    });
  });

  describe('preferred terminology', () => {
    const rules = [{ discouraged: 'Expenditure', preferred: 'Investment' }];
    const budget: SeedResource = withStatus('Capital expenditure', { es: 'verified', fr: 'verified' });

    it('reports a finding once across every target locale and still passes', () => {
      const main = collection();
      seedResources(main, { 'budget.title': budget });

      const result = validateResources([main], { allowTranslated: false, terminology: { rules } });

      expect(result.passed).toBe(true);
      expect(result.terminology?.warnings).toHaveLength(1);
      expect(result.terminology?.warnings[0]).toMatchObject({ key: 'budget.title', locale: 'en' });
      expect(result.terminology?.valuesChecked).toBe(1);
    });

    it('reports each collection under its own base locale', () => {
      const main = collection();
      const legacy = collection('legacy', { baseLocale: 'en-GB', locales: ['en-GB', 'es', 'fr'] });
      seedResources(main, { 'budget.title': budget });
      seedResources(legacy, { 'legacy.title': budget });

      const result = validateResources([main, legacy], { allowTranslated: false, terminology: { rules } });

      expect(result.terminology?.warnings.map((warning) => `${warning.collection}:${warning.locale}`)).toEqual([
        'main:en',
        'legacy:en-GB',
      ]);
    });

    it('fails when the rule file could not be loaded', () => {
      const main = collection();
      seedResources(main, { 'budget.title': budget });

      const result = validateResources([main], {
        allowTranslated: false,
        terminology: { rules: [], loadError: 'broken' },
      });

      expect(result.passed).toBe(false);
      expect(result.terminology?.configError).toBe('broken');
      expect(result.failures).toHaveLength(0);
    });

    it('leaves the terminology result undefined when not requested', () => {
      expect(validateResources([collection()], { allowTranslated: false }).terminology).toBeUndefined();
    });
  });
});
