import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TranslationConfig } from '../../config/translation-config';
import { RESOURCE_ENTRIES_FILENAME, TRACKER_META_FILENAME } from '../../constants';
import { seedResources, testCollection, useTempDir, writeFolderFiles } from '../../testing/temp-dir.spec-helpers';
import type { Collection } from '../config/open-collection';
import { openResourceFolder } from '../resource/resource-folder';
import { InMemoryTranslationProvider } from './in-memory-translation-provider';
import { type TranslateLocaleProgress, translateLocale } from './translate-locale';
import { TranslationError } from './translation-provider';

const AUTO: TranslationConfig = {
  enabled: true,
  provider: 'google-translate',
  apiKeyEnv: 'TRANSLATE_LOCALE_SPEC_KEY',
  delayMs: 0,
};

describe('translateLocale', () => {
  const dir = useTempDir('translate-locale-');

  function collection(overrides: Partial<Collection> = {}): Collection {
    return testCollection(dir(), { locales: ['en', 'fr'], translationConfig: AUTO, ...overrides });
  }

  function withBatchSize(batchSize: number): Collection {
    return collection({ translationConfig: { ...AUTO, batchSize } });
  }

  function read(file: string, ...segments: string[]) {
    return JSON.parse(readFileSync(join(dir(), ...segments, file), 'utf8'));
  }

  describe('when nothing needs translating', () => {
    it('returns zeros for an empty collection, without an API key', async () => {
      const result = await translateLocale(collection(), { targetLocale: 'fr' });

      expect(result).toEqual({
        totalResources: 0,
        translatedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        failures: [],
        skippedKeys: [],
        warnings: [],
      });
    });

    it('returns zeros when every resource is translated or verified', async () => {
      seedResources(collection(), {
        ok: { source: 'OK', translations: { fr: 'OK fr' } },
        cancel: { source: 'Cancel', translations: { fr: { value: 'Annuler', status: 'verified' } } },
      });

      const result = await translateLocale(collection(), { targetLocale: 'fr' });

      expect(result.totalResources).toBe(0);
    });
  });

  it('translates new, stale and metadata-less resources, and leaves translated and verified ones', async () => {
    const target = collection();
    seedResources(target, {
      fresh: { source: 'Fresh', translations: { fr: { value: 'Fresh', status: 'new' } } },
      done: { source: 'Done', translations: { fr: 'Fait' } },
      checked: { source: 'Checked', translations: { fr: { value: 'Vérifié', status: 'verified' } } },
      missing: { source: 'Missing' },
      old: { source: 'Old', translations: { fr: 'Vieux' } },
    });
    const folder = openResourceFolder(dir(), { baseLocale: 'en' });
    folder.setBase('old', 'Older');
    folder.save();
    const provider = new InMemoryTranslationProvider();

    const result = await translateLocale(target, { targetLocale: 'fr', provider });

    expect(result).toMatchObject({ totalResources: 3, translatedCount: 3, failedCount: 0, skippedCount: 0 });
    const entries = read(RESOURCE_ENTRIES_FILENAME);
    expect(entries.fresh.fr).toBe('[fr] Fresh');
    expect(entries.missing.fr).toBe('[fr] Missing');
    expect(entries.old.fr).toBe('[fr] Older');
    expect(entries.done.fr).toBe('Fait');
    expect(entries.checked.fr).toBe('Vérifié');
    const meta = read(TRACKER_META_FILENAME);
    expect(meta.fresh.fr.status).toBe('translated');
    expect(meta.old.fr.status).toBe('translated');
    expect(meta.checked.fr.status).toBe('verified');
  });

  it('writes each folder it translates into, with values normalised to ICU', async () => {
    const target = collection();
    seedResources(target, {
      'dialogs.greet': { source: 'Hello {{ name }}' },
      'buttons.ok': { source: 'OK' },
    });
    const provider = new InMemoryTranslationProvider(({ text }) => text.replace('Hello', 'Bonjour'));

    const result = await translateLocale(target, { targetLocale: 'fr', provider });

    expect(result.translatedCount).toBe(2);
    expect(read(RESOURCE_ENTRIES_FILENAME, 'dialogs').greet.fr).toBe('Bonjour {name}');
    expect(read(RESOURCE_ENTRIES_FILENAME, 'buttons').ok.fr).toBe('OK');
  });

  describe('batches', () => {
    it('sends one provider call per batch of batchSize, and reports progress after each', async () => {
      seedResources(collection(), { a: { source: 'A' }, b: { source: 'B' }, c: { source: 'C' } });
      const provider = new InMemoryTranslationProvider();
      const progress: TranslateLocaleProgress[] = [];

      await translateLocale(withBatchSize(2), {
        targetLocale: 'fr',
        provider,
        onProgress: (event) => progress.push(event),
      });

      expect(provider.calls.map((call) => call.map(({ text }) => text))).toEqual([['A', 'B'], ['C']]);
      expect(progress).toEqual([
        { totalResources: 3, translatedCount: 2, failedCount: 0, skippedCount: 0, currentBatch: 1, totalBatches: 2 },
        { totalResources: 3, translatedCount: 3, failedCount: 0, skippedCount: 0, currentBatch: 2, totalBatches: 2 },
      ]);
    });

    it('marks every resource of a failed batch as failed and continues with the next batch', async () => {
      seedResources(collection(), { a: { source: 'A' }, b: { source: 'B' }, c: { source: 'C' } });
      let calls = 0;
      const provider = new InMemoryTranslationProvider(({ text }) => {
        if (calls++ === 0) {
          throw new TranslationError('quota exceeded', 'RATE_LIMIT', true);
        }
        return `${text}-fr`;
      });

      const result = await translateLocale(withBatchSize(2), { targetLocale: 'fr', provider });

      expect(result.failedCount).toBe(2);
      expect(result.failures).toEqual([
        { key: 'a', error: 'quota exceeded' },
        { key: 'b', error: 'quota exceeded' },
      ]);
      expect(result.translatedCount).toBe(1);
      expect(read(RESOURCE_ENTRIES_FILENAME).c.fr).toBe('C-fr');
      expect(read(RESOURCE_ENTRIES_FILENAME).a.fr).toBeUndefined();
    });
  });

  describe('skips', () => {
    it('reports complex ICU resources in skippedKeys and leaves them untouched', async () => {
      const plural = '{count, plural, one {# item} other {# items}}';
      seedResources(collection(), { items: { source: plural }, ok: { source: 'OK' } });
      const provider = new InMemoryTranslationProvider();

      const result = await translateLocale(collection(), { targetLocale: 'fr', provider });

      expect(result).toMatchObject({ translatedCount: 1, skippedCount: 1, skippedKeys: ['items'] });
      expect(read(RESOURCE_ENTRIES_FILENAME).items.fr).toBeUndefined();
    });

    it('reports a translation that dropped a protected term in skippedKeys', async () => {
      const target = collection();
      seedResources(target, { buy: { source: 'Buy an iPhone' }, ok: { source: 'OK' } });
      const provider = new InMemoryTranslationProvider(({ text }) => text.replace('iPhone', 'téléphone'));

      const result = await translateLocale(target, { targetLocale: 'fr', provider, protectedTerms: ['iPhone'] });

      expect(result).toMatchObject({ translatedCount: 1, skippedCount: 1, skippedKeys: ['buy'] });
      expect(read(RESOURCE_ENTRIES_FILENAME).buy.fr).toBeUndefined();
    });

    it('skips a resource whose entry was removed from disk while it was being translated', async () => {
      seedResources(collection(), { ok: { source: 'OK' } });
      const provider = new InMemoryTranslationProvider(({ text }) => {
        const folder = openResourceFolder(dir(), { baseLocale: 'en' });
        folder.remove('ok');
        folder.save();
        return text;
      });

      const result = await translateLocale(collection(), { targetLocale: 'fr', provider });

      expect(result).toMatchObject({ translatedCount: 0, skippedCount: 1, skippedKeys: ['ok'] });
    });
  });

  it('does not translate a folder the Collection Reader cannot read, and reports it in warnings', async () => {
    writeFolderFiles(dir(), 'broken', { entries: '{ not json' });
    seedResources(collection(), { ok: { source: 'OK' } });

    const result = await translateLocale(collection(), {
      targetLocale: 'fr',
      provider: new InMemoryTranslationProvider(),
    });

    expect(result).toMatchObject({ totalResources: 1, translatedCount: 1 });
    expect(result.warnings).toEqual([expect.stringContaining("Folder 'broken' was not translated:")]);
    expect(result.warnings[0]).toContain(RESOURCE_ENTRIES_FILENAME);
  });

  it('reports unreadable folders in warnings even when nothing needs translating', async () => {
    writeFolderFiles(dir(), 'broken', { entries: '{ not json' });

    const result = await translateLocale(collection(), { targetLocale: 'fr' });

    expect(result.totalResources).toBe(0);
    expect(result.warnings).toHaveLength(1);
  });

  it('throws MISSING_API_KEY when there is work and no provider is injected', async () => {
    seedResources(collection(), { ok: { source: 'OK' } });

    await expect(translateLocale(collection(), { targetLocale: 'fr' })).rejects.toMatchObject({
      code: 'MISSING_API_KEY',
      retryable: false,
    });
  });
});
