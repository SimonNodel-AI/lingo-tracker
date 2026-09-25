import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LingoTrackerConfig } from '../config/lingo-tracker-config';
import type { TranslationConfig } from '../config/translation-config';
import { type Collection, openCollection } from '../lib/config/open-collection';
import { DEFAULT_PROTECTED_TERMS_FILENAME } from '../lib/config/protected-terms-file';
import { InvalidResourceKeyError, LocaleNotFoundError } from '../lib/errors/lingo-tracker-error';
import { InMemoryTranslationProvider } from '../lib/translation/in-memory-translation-provider';
import { TranslationError } from '../lib/translation/translation-provider';
import { addResource } from './add-resource';
import { calculateChecksum as md5 } from './checksum';

const AUTO: TranslationConfig = { enabled: true, provider: 'google-translate', apiKeyEnv: 'KEY' };

describe('addResource (real fs)', () => {
  let root: string;

  function collection(options: { translation?: TranslationConfig; locales?: string[]; baseLocale?: string } = {}) {
    const config: LingoTrackerConfig = {
      exportFolder: 'dist',
      importFolder: 'import',
      baseLocale: options.baseLocale ?? 'en',
      locales: options.locales ?? ['en', 'fr', 'de'],
      collections: { main: { translationsFolder: join(root, 'translations') } },
      ...(options.translation && { translation: options.translation }),
    };
    return openCollection(config, 'main', { cwd: root });
  }

  function read(file: 'resource_entries.json' | 'tracker_meta.json', ...segments: string[]) {
    return JSON.parse(readFileSync(join(root, 'translations', ...segments, file), 'utf8'));
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'add-resource-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('locale seeding', () => {
    it('copies the base value as `new` into every target locale when auto-translation is off', async () => {
      const provider = new InMemoryTranslationProvider();

      const result = await addResource(collection(), { key: 'common.ok', baseValue: 'OK' }, { provider });

      expect(read('resource_entries.json', 'common')).toEqual({ ok: { source: 'OK', fr: 'OK', de: 'OK' } });
      expect(read('tracker_meta.json', 'common').ok).toEqual({
        en: { checksum: md5('OK') },
        fr: { checksum: md5('OK'), baseChecksum: md5('OK'), status: 'new' },
        de: { checksum: md5('OK'), baseChecksum: md5('OK'), status: 'new' },
      });
      expect(result.translations.map(({ locale, status }) => [locale, status])).toEqual([
        ['fr', 'new'],
        ['de', 'new'],
      ]);
      expect(result.skippedLocales).toBeUndefined();
      expect(provider.calls).toEqual([]);
    });

    it('keeps supplied translations and seeds only the missing locales', async () => {
      await addResource(collection(), {
        key: 'common.save',
        baseValue: 'Save',
        translations: [{ locale: 'fr', value: 'Enregistrer', status: 'translated' }],
      });

      expect(read('resource_entries.json', 'common').save).toEqual({ source: 'Save', fr: 'Enregistrer', de: 'Save' });
      const meta = read('tracker_meta.json', 'common').save;
      expect(meta.fr.status).toBe('translated');
      expect(meta.de.status).toBe('new');
    });

    it('auto-translates the missing locales when the collection enables it', async () => {
      const provider = new InMemoryTranslationProvider(() => 'Speichern');

      const result = await addResource(
        collection({ translation: AUTO }),
        {
          key: 'common.save',
          baseValue: 'Save',
          translations: [{ locale: 'fr', value: 'Enregistrer', status: 'verified' }],
        },
        { provider },
      );

      expect(provider.calls).toEqual([[{ text: 'Save', sourceLocale: 'en', targetLocale: 'de' }]]);
      expect(read('resource_entries.json', 'common').save).toEqual({
        source: 'Save',
        fr: 'Enregistrer',
        de: 'Speichern',
      });
      const meta = read('tracker_meta.json', 'common').save;
      expect(meta.fr.status).toBe('verified');
      expect(meta.de.status).toBe('translated');
      expect(result.skippedLocales).toEqual([]);
    });

    it('stores auto-translations normalised to ICU', async () => {
      const provider = new InMemoryTranslationProvider(({ text }) => text.replace('Hello', 'Hallo'));

      await addResource(
        collection({ translation: AUTO }),
        { key: 'greet', baseValue: 'Hello {{ name }}' },
        { provider },
      );

      expect(read('resource_entries.json').greet).toEqual({
        source: 'Hello {name}',
        fr: 'Hallo {name}',
        de: 'Hallo {name}',
      });
    });

    it('copies the base value as `new` into every locale when the base value is complex ICU, and reports them', async () => {
      const provider = new InMemoryTranslationProvider();

      const result = await addResource(
        collection({ translation: AUTO }),
        { key: 'items', baseValue: '{count, plural, other {# items}}' },
        { provider },
      );

      const entry = read('resource_entries.json').items;
      expect(entry.fr).toBe('{count, plural, other {# items}}');
      expect(entry.de).toBe('{count, plural, other {# items}}');
      expect(read('tracker_meta.json').items.de.status).toBe('new');
      expect(result.skippedLocales).toEqual(['fr', 'de']);
      expect(provider.calls).toEqual([]);
    });

    it('copies the base value as `new` into a locale whose translation dropped a protected term', async () => {
      // The global terms file beside the config (root is the config directory).
      writeFileSync(join(root, DEFAULT_PROTECTED_TERMS_FILENAME), JSON.stringify(['iPhone']), 'utf8');
      const provider = new InMemoryTranslationProvider(({ targetLocale }) =>
        targetLocale === 'fr' ? 'Acheter un téléphone' : 'iPhone kaufen',
      );

      const result = await addResource(
        collection({ translation: AUTO }),
        { key: 'buy', baseValue: 'Buy an iPhone' },
        { provider },
      );

      expect(read('resource_entries.json').buy).toEqual({
        source: 'Buy an iPhone',
        fr: 'Buy an iPhone',
        de: 'iPhone kaufen',
      });
      expect(read('tracker_meta.json').buy.fr.status).toBe('new');
      expect(read('tracker_meta.json').buy.de.status).toBe('translated');
      expect(result.skippedLocales).toEqual(['fr']);
    });

    it('does not call the provider when every target locale was supplied', async () => {
      const provider = new InMemoryTranslationProvider();

      await addResource(
        collection({ translation: AUTO }),
        {
          key: 'ok',
          baseValue: 'OK',
          translations: [
            { locale: 'fr', value: "D'accord", status: 'translated' },
            { locale: 'de', value: 'Okay', status: 'translated' },
          ],
        },
        { provider },
      );

      expect(provider.calls).toEqual([]);
    });

    it('does not auto-translate when the collection translation config is disabled', async () => {
      const provider = new InMemoryTranslationProvider();

      await addResource(
        collection({ translation: { ...AUTO, enabled: false } }),
        { key: 'ok', baseValue: 'OK' },
        { provider },
      );

      expect(provider.calls).toEqual([]);
      expect(read('tracker_meta.json').ok.fr.status).toBe('new');
    });

    it('writes nothing when the provider fails', async () => {
      const provider = new InMemoryTranslationProvider(() => {
        throw new TranslationError('quota', 'RATE_LIMIT', true);
      });

      await expect(
        addResource(collection({ translation: AUTO }), { key: 'common.ok', baseValue: 'OK' }, { provider }),
      ).rejects.toThrow(TranslationError);
      expect(existsSync(join(root, 'translations', 'common', 'resource_entries.json'))).toBe(false);
    });

    it('writes nothing when the API key is not set', async () => {
      await expect(
        addResource(collection({ translation: { ...AUTO, apiKeyEnv: 'ADD_RESOURCE_SPEC_UNSET_KEY' } }), {
          key: 'common.ok',
          baseValue: 'OK',
        }),
      ).rejects.toMatchObject({ code: 'MISSING_API_KEY' });
      expect(existsSync(join(root, 'translations', 'common', 'resource_entries.json'))).toBe(false);
    });

    it('stores an untranslated copy of the base value as `new`, whatever status was requested', async () => {
      await addResource(collection(), {
        key: 'ok',
        baseValue: 'OK',
        translations: [{ locale: 'fr', value: 'OK', status: 'verified' }],
      });

      expect(read('tracker_meta.json').ok.fr.status).toBe('new');
    });

    it('takes base and target locales from the collection only', async () => {
      await addResource(collection({ baseLocale: 'fr', locales: ['fr', 'en'] }), {
        key: 'ok',
        baseValue: "D'accord",
        translations: [{ locale: 'fr', value: 'ignored: base locale', status: 'translated' }],
      });

      expect(read('resource_entries.json').ok).toEqual({ source: "D'accord", en: "D'accord" });
      expect(Object.keys(read('tracker_meta.json').ok)).toEqual(['fr', 'en']);
    });

    it('rejects a translation for a locale the collection does not have', async () => {
      await expect(
        addResource(collection(), {
          key: 'ok',
          baseValue: 'OK',
          translations: [{ locale: 'ja', value: 'OK', status: 'translated' }],
        }),
      ).rejects.toThrow(LocaleNotFoundError);
      expect(existsSync(join(root, 'translations'))).toBe(false);
    });
  });

  describe('entry', () => {
    it('stores comment and normalized tags', async () => {
      await addResource(collection({ locales: ['en'] }), {
        key: 'ok',
        baseValue: 'OK',
        comment: 'Button',
        tags: ['UI', 'ui', ' forms '],
      });

      expect(read('resource_entries.json').ok).toEqual({ source: 'OK', comment: 'Button', tags: ['ui', 'forms'] });
    });

    it('places the key under targetFolder', async () => {
      const result = await addResource(collection(), {
        key: 'buttons.ok',
        baseValue: 'OK',
        targetFolder: 'apps.common',
      });

      expect(result.resolvedKey).toBe('apps.common.buttons.ok');
      expect(read('resource_entries.json', 'apps', 'common', 'buttons').ok.source).toBe('OK');
    });

    it('normalizes Transloco placeholders to ICU in base and translations', async () => {
      await addResource(collection(), {
        key: 'hello',
        baseValue: 'Hello {{ name }}',
        translations: [{ locale: 'fr', value: 'Bonjour {{name}}', status: 'translated' }],
      });

      expect(read('resource_entries.json').hello).toEqual({
        source: 'Hello {name}',
        fr: 'Bonjour {name}',
        de: 'Hello {name}',
      });
    });

    it('replaces an existing entry, keeps its position, and reports created: false', async () => {
      const target = collection();
      await addResource(target, { key: 'a', baseValue: 'A', comment: 'old' });
      await addResource(target, { key: 'b', baseValue: 'B' });

      const result = await addResource(target, { key: 'a', baseValue: 'A2' });

      expect(result.created).toBe(false);
      expect(Object.keys(read('resource_entries.json'))).toEqual(['a', 'b']);
      expect(read('resource_entries.json').a).toEqual({ source: 'A2', fr: 'A2', de: 'A2' });
    });

    it('returns an upsert mutation for the stored entry', async () => {
      const target: Collection = collection();
      const result = await addResource(target, { key: 'common.ok', baseValue: 'OK' });

      expect(result.created).toBe(true);
      expect(result.mutations).toEqual([
        expect.objectContaining({ kind: 'upsert', translationsFolder: target.translationsFolder, key: 'common.ok' }),
      ]);
    });

    it.each([
      ['a key with path traversal', { key: '../evil', baseValue: 'x' }],
      ['a malformed targetFolder', { key: 'ok', baseValue: 'x', targetFolder: '../evil' }],
    ])('rejects %s and creates nothing', async (_label, params) => {
      await expect(addResource(collection(), params)).rejects.toThrow(InvalidResourceKeyError);
      expect(existsSync(join(root, 'translations'))).toBe(false);
    });
  });
});
