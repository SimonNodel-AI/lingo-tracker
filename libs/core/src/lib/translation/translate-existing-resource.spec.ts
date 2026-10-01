import type { ResourceMutation } from '../resource/resource-mutation';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TranslationConfig } from '../../config/translation-config';
import { RESOURCE_ENTRIES_FILENAME, TRACKER_META_FILENAME } from '../../constants';
import { seedResources, testCollection, useTempDir } from '../../testing/temp-dir.spec-helpers';
import type { Collection } from '../config/open-collection';
import { AutoTranslationDisabledError, ResourceNotFoundError } from '../errors/lingo-tracker-error';
import { openResourceFolder } from '../resource/resource-folder';
import { InMemoryTranslationProvider } from './in-memory-translation-provider';
import { translateExistingResource } from './translate-existing-resource';
import { TranslationError } from './translation-provider';

const collected: ResourceMutation[] = [];
const onMutation = (mutation: ResourceMutation): void => {
  collected.push(mutation);
};
beforeEach(() => {
  collected.length = 0;
});

const AUTO: TranslationConfig = {
  enabled: true,
  provider: 'google-translate',
  apiKeyEnv: 'TRANSLATE_EXISTING_SPEC_KEY',
};

describe('translateExistingResource', () => {
  const dir = useTempDir('translate-existing-');

  function collection(overrides: Partial<Collection> = {}): Collection {
    return testCollection(dir(), { locales: ['en', 'fr', 'es', 'de'], translationConfig: AUTO, ...overrides });
  }

  function read(file: string, ...segments: string[]) {
    return JSON.parse(readFileSync(join(dir(), ...segments, file), 'utf8'));
  }

  /** `common.save`: fr translated, es new (copy), de missing. */
  function seedSave(target: Collection, source = 'Save'): void {
    seedResources(target, {
      'common.save': {
        source,
        translations: { fr: 'Sauvegarder', es: { value: source, status: 'new' } },
      },
    });
  }

  it('reports a named protected-terms file that does not exist in warnings', async () => {
    const missing = join(dir(), 'typo.json');
    const named = collection({
      termFiles: { ...collection().termFiles, protectedTerms: { path: missing, explicit: true } },
    });
    seedSave(named);

    const result = await translateExistingResource(named, 'common.save', {
      onMutation,
      provider: new InMemoryTranslationProvider(),
    });

    expect(result.translatedCount).toBe(2);
    expect(result.warnings).toEqual([`Protected terms file not found: ${missing}. Treating as an empty list.`]);
  });

  it('throws AutoTranslationDisabledError when auto-translation is disabled', async () => {
    const disabled = collection({ translationConfig: { ...AUTO, enabled: false } });
    seedSave(disabled);

    await expect(translateExistingResource(disabled, 'common.save', { onMutation })).rejects.toThrow(
      AutoTranslationDisabledError,
    );
  });

  it('throws MISSING_API_KEY when no provider is injected and the env var is unset', async () => {
    const target = collection();
    seedSave(target);

    await expect(translateExistingResource(target, 'common.save', { onMutation })).rejects.toThrow(TranslationError);
  });

  it('returns without an API key when no locale needs work', async () => {
    const target = collection({ locales: ['en', 'fr'] });
    seedResources(target, { 'common.save': { source: 'Save', translations: { fr: 'Sauvegarder' } } });

    const result = await translateExistingResource(target, 'common.save', { onMutation });

    expect(result).toMatchObject({ translatedCount: 0, skippedLocales: [] });
    expect(collected).toEqual([]);
  });

  it('throws ResourceNotFoundError when the folder or the entry does not exist', async () => {
    const target = collection();
    seedSave(target);
    const provider = new InMemoryTranslationProvider();

    await expect(translateExistingResource(target, 'nowhere.save', { onMutation, provider })).rejects.toThrow(
      ResourceNotFoundError,
    );
    await expect(translateExistingResource(target, 'common.missing', { onMutation, provider })).rejects.toThrow(
      ResourceNotFoundError,
    );
  });

  it('translates only the locales that need work (new, stale, or no metadata), with status translated', async () => {
    const target = collection();
    seedResources(target, {
      'common.save': {
        source: 'Save',
        translations: {
          fr: { value: 'Sauvegarder', status: 'verified' },
          es: { value: 'Save', status: 'new' },
        },
      },
    });
    const provider = new InMemoryTranslationProvider();

    const result = await translateExistingResource(target, 'common.save', { onMutation, provider });

    expect(provider.calls.map((call) => call.map(({ targetLocale }) => targetLocale))).toEqual([['es'], ['de']]);
    expect(result.translatedCount).toBe(2);
    expect(result.skippedLocales).toEqual([]);
    expect(read(RESOURCE_ENTRIES_FILENAME, 'common').save).toEqual({
      source: 'Save',
      fr: 'Sauvegarder',
      es: '[es] Save',
      de: '[de] Save',
    });
    const meta = read(TRACKER_META_FILENAME, 'common').save;
    expect(meta.fr.status).toBe('verified');
    expect(meta.es.status).toBe('translated');
    expect(meta.de.status).toBe('translated');
    expect(result.entry.translations).toMatchObject({ es: '[es] Save', de: '[de] Save' });
    expect(collected).toEqual([{ kind: 'upsert', translationsFolder: dir(), key: 'common.save', entry: result.entry }]);
  });

  it('translates a stale locale', async () => {
    const target = collection({ locales: ['en', 'fr'] });
    seedResources(target, { 'common.save': { source: 'Save', translations: { fr: 'Sauvegarder' } } });
    const folder = openResourceFolder(join(dir(), 'common'), { baseLocale: 'en' });
    folder.setBase('save', 'Save all');
    folder.save();
    expect(read(TRACKER_META_FILENAME, 'common').save.fr.status).toBe('stale');
    const provider = new InMemoryTranslationProvider(() => 'Tout sauvegarder');

    const result = await translateExistingResource(target, 'common.save', { onMutation, provider });

    expect(result.translatedCount).toBe(1);
    expect(read(RESOURCE_ENTRIES_FILENAME, 'common').save.fr).toBe('Tout sauvegarder');
    expect(read(TRACKER_META_FILENAME, 'common').save.fr.status).toBe('translated');
  });

  it('stores translated when the translator returns the base value and skips it on the next run', async () => {
    const target = collection({ locales: ['en', 'fr'] });
    seedResources(target, {
      'common.save': { source: 'Save', translations: { fr: { value: 'Save', status: 'new' } } },
    });

    const result = await translateExistingResource(target, 'common.save', {
      onMutation,
      provider: new InMemoryTranslationProvider(() => 'Save'),
    });

    expect(result.translatedCount).toBe(1);
    expect(read(TRACKER_META_FILENAME, 'common').save.fr.status).toBe('translated');
    expect((await translateExistingResource(target, 'common.save', { onMutation })).translatedCount).toBe(0);
  });

  it('returns the current entry and writes nothing when no locale needs work', async () => {
    const target = collection({ locales: ['en', 'fr'] });
    seedResources(target, { 'common.save': { source: 'Save', translations: { fr: 'Sauvegarder' } } });
    const before = readFileSync(join(dir(), 'common', TRACKER_META_FILENAME), 'utf8');
    const provider = new InMemoryTranslationProvider();

    const result = await translateExistingResource(target, 'common.save', { onMutation, provider });

    expect(result).toMatchObject({ translatedCount: 0, skippedLocales: [] });
    expect(collected).toEqual([]);
    expect(result.entry.source).toBe('Save');
    expect(provider.calls).toEqual([]);
    expect(readFileSync(join(dir(), 'common', TRACKER_META_FILENAME), 'utf8')).toBe(before);
  });

  it('reports complex ICU locales as skipped and leaves them untouched', async () => {
    const target = collection();
    const plural = '{count, plural, one {# file} other {# files}}';
    seedSave(target, plural);
    const provider = new InMemoryTranslationProvider();

    const result = await translateExistingResource(target, 'common.save', { onMutation, provider });

    expect(result.translatedCount).toBe(0);
    expect(result.skippedLocales).toEqual(['es', 'de']);
    expect(collected).toEqual([]);
    expect(read(RESOURCE_ENTRIES_FILENAME, 'common').save.es).toBe(plural);
  });

  it('skips a locale whose translation dropped a protected term', async () => {
    const target = collection({ locales: ['en', 'fr', 'es'] });
    seedResources(target, { 'common.buy': { source: 'Buy an iPhone' } });
    const provider = new InMemoryTranslationProvider(({ targetLocale }) =>
      targetLocale === 'fr' ? 'Acheter un téléphone' : 'Comprar un iPhone',
    );

    const result = await translateExistingResource(target, 'common.buy', {
      onMutation,
      provider,
      protectedTerms: ['iPhone'],
    });

    expect(result.skippedLocales).toEqual(['fr']);
    expect(read(RESOURCE_ENTRIES_FILENAME, 'common').buy).toEqual({ source: 'Buy an iPhone', es: 'Comprar un iPhone' });
  });

  it('stores values normalised to ICU, even when the stored base value is Transloco syntax', async () => {
    const target = collection({ locales: ['en', 'fr'] });
    seedResources(target, { 'common.greet': { source: 'Hello {{ name }}' } });
    const provider = new InMemoryTranslationProvider(({ text }) => text.replace('Hello', 'Bonjour'));

    await translateExistingResource(target, 'common.greet', { onMutation, provider });

    expect(read(RESOURCE_ENTRIES_FILENAME, 'common').greet.fr).toBe('Bonjour {name}');
  });
});
