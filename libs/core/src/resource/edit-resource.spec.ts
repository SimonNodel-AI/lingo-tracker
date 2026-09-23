import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LingoTrackerConfig } from '../config/lingo-tracker-config';
import type { TranslationConfig } from '../config/translation-config';
import { type Collection, openCollection } from '../lib/config/open-collection';
import {
  InvalidResourceKeyError,
  LocaleNotFoundError,
  ResourceAlreadyExistsError,
  ResourceNotFoundError,
} from '../lib/errors/lingo-tracker-error';
import { openResourceFolder } from '../lib/resource/resource-folder';
import { autoTranslateResource } from '../lib/translation/auto-translate-resources';
import { TranslationError } from '../lib/translation/translation-provider';
import { calculateChecksum as md5 } from './checksum';
import { editResource } from './edit-resource';

vi.mock('../lib/translation/auto-translate-resources');

const AUTO: TranslationConfig = { enabled: true, provider: 'google-translate', apiKeyEnv: 'KEY' };

describe('editResource (real fs)', () => {
  let root: string;

  function collection(translation?: TranslationConfig): Collection {
    const config: LingoTrackerConfig = {
      exportFolder: 'dist',
      importFolder: 'import',
      baseLocale: 'en',
      locales: ['en', 'fr', 'de', 'es'],
      collections: { main: { translationsFolder: join(root, 'translations') } },
      ...(translation && { translation }),
    };
    return openCollection(config, 'main');
  }

  /**
   * Writes `common.save` with base "Save": fr a real translation (verified), de an untranslated
   * copy (new), es missing.
   */
  function seedEntry(): void {
    const folder = openResourceFolder(join(root, 'translations', 'common'), { baseLocale: 'en' });
    folder.setBase('save', 'Save');
    folder.setTranslation('save', 'fr', 'Enregistrer', 'verified');
    folder.setTranslation('save', 'de', 'Save', 'new');
    folder.save();
  }

  function read(file: 'resource_entries.json' | 'tracker_meta.json', ...segments: string[]) {
    return JSON.parse(readFileSync(join(root, 'translations', ...segments, file), 'utf8'));
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'edit-resource-'));
    vi.mocked(autoTranslateResource).mockReset();
    seedEntry();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('throws ResourceNotFoundError for a missing entry', async () => {
    await expect(editResource(collection(), 'common.missing', { comment: 'x' })).rejects.toThrow(ResourceNotFoundError);
    await expect(editResource(collection(), 'nowhere.save', { comment: 'x' })).rejects.toThrow(ResourceNotFoundError);
  });

  it('reports no changes and writes nothing when nothing differs', async () => {
    const result = await editResource(collection(), 'common.save', { baseValue: 'Save', translations: {} });

    expect(result).toEqual({
      resolvedKey: 'common.save',
      updated: false,
      message: 'No changes detected',
      mutations: [],
    });
  });

  describe('base value change', () => {
    it('keeps real translations as `stale` and re-seeds copies and missing locales as `new`', async () => {
      const result = await editResource(collection(), 'common.save', { baseValue: 'Save all' });

      expect(read('resource_entries.json', 'common').save).toEqual({
        source: 'Save all',
        fr: 'Enregistrer',
        de: 'Save all',
        es: 'Save all',
      });
      const meta = read('tracker_meta.json', 'common').save;
      expect(meta.en).toEqual({ checksum: md5('Save all') });
      expect(meta.fr).toEqual({ checksum: md5('Enregistrer'), baseChecksum: md5('Save all'), status: 'stale' });
      expect(meta.de).toEqual({ checksum: md5('Save all'), baseChecksum: md5('Save all'), status: 'new' });
      expect(meta.es.status).toBe('new');
      expect(result.updated).toBe(true);
      expect(result.skippedLocales).toBeUndefined();
      expect(autoTranslateResource).not.toHaveBeenCalled();
    });

    it('auto-translates every locale that needs work, except those supplied in the same edit', async () => {
      vi.mocked(autoTranslateResource).mockResolvedValue({
        translations: [{ locale: 'de', value: 'Alles speichern', status: 'translated' }],
        skippedLocales: ['es'],
      });

      const result = await editResource(collection(AUTO), 'common.save', {
        baseValue: 'Save all',
        translations: { fr: { value: 'Tout enregistrer', status: 'translated' } },
      });

      expect(autoTranslateResource).toHaveBeenCalledWith({
        baseValue: 'Save all',
        baseLocale: 'en',
        targetLocales: ['de', 'es'],
        translationConfig: AUTO,
      });
      expect(read('resource_entries.json', 'common').save).toEqual({
        source: 'Save all',
        fr: 'Tout enregistrer',
        de: 'Alles speichern',
        es: 'Save all',
      });
      const meta = read('tracker_meta.json', 'common').save;
      expect(meta.fr.status).toBe('translated');
      expect(meta.de).toEqual({
        checksum: md5('Alles speichern'),
        baseChecksum: md5('Save all'),
        status: 'translated',
      });
      expect(meta.es.status).toBe('new');
      expect(result.skippedLocales).toEqual(['es']);
    });

    it('keeps the saved edit when the provider fails', async () => {
      vi.mocked(autoTranslateResource).mockRejectedValue(new TranslationError('down', 'SERVICE_ERROR', true));

      await expect(editResource(collection(AUTO), 'common.save', { baseValue: 'Save all' })).rejects.toThrow(
        TranslationError,
      );

      expect(read('resource_entries.json', 'common').save.source).toBe('Save all');
      expect(read('tracker_meta.json', 'common').save.fr.status).toBe('stale');
    });

    it('does not seed anything when only the comment changes', async () => {
      await editResource(collection(AUTO), 'common.save', { comment: 'Toolbar button' });

      expect(autoTranslateResource).not.toHaveBeenCalled();
      expect(read('resource_entries.json', 'common').save.es).toBeUndefined();
    });

    it('normalizes a Transloco base value to ICU', async () => {
      await editResource(collection(), 'common.save', { baseValue: 'Save {{ count }}' });

      expect(read('resource_entries.json', 'common').save.source).toBe('Save {count}');
    });
  });

  describe('details and translations', () => {
    it('updates comment and normalized tags', async () => {
      await editResource(collection(), 'common.save', { comment: 'Button', tags: ['UI', 'forms'] });

      const entry = read('resource_entries.json', 'common').save;
      expect(entry.comment).toBe('Button');
      expect(entry.tags).toEqual(['ui', 'forms']);
    });

    it('writes a translation with status `translated` by default, or the supplied status', async () => {
      await editResource(collection(), 'common.save', {
        translations: { de: { value: 'Speichern' }, es: { value: 'Guardar', status: 'verified' } },
      });

      const meta = read('tracker_meta.json', 'common').save;
      expect(meta.de.status).toBe('translated');
      expect(meta.es.status).toBe('verified');
      expect(read('resource_entries.json', 'common').save.de).toBe('Speichern');
    });

    it('changes only the status when the value is unchanged', async () => {
      await editResource(collection(), 'common.save', {
        translations: { fr: { value: 'Enregistrer', status: 'stale' } },
      });

      const meta = read('tracker_meta.json', 'common').save;
      expect(meta.fr).toEqual({ checksum: md5('Enregistrer'), baseChecksum: md5('Save'), status: 'stale' });
    });

    it('ignores a value for the base locale', async () => {
      const result = await editResource(collection(), 'common.save', { translations: { en: { value: 'Nope' } } });

      expect(result.updated).toBe(false);
      expect(read('resource_entries.json', 'common').save.source).toBe('Save');
    });

    it('rejects a locale the collection does not have', async () => {
      await expect(
        editResource(collection(), 'common.save', { translations: { ja: { value: '保存' } } }),
      ).rejects.toThrow(LocaleNotFoundError);
    });
  });

  describe('moveTo', () => {
    it('moves the edited entry into another folder, keeping its entry key', async () => {
      const target = collection();
      const result = await editResource(target, 'common.save', { comment: 'Moved', moveTo: 'dialogs.actions' });

      expect(result.resolvedKey).toBe('dialogs.actions.save');
      expect(result.entry?.comment).toBe('Moved');
      expect(read('resource_entries.json', 'dialogs', 'actions').save).toEqual({
        source: 'Save',
        comment: 'Moved',
        fr: 'Enregistrer',
        de: 'Save',
      });
      expect(read('tracker_meta.json', 'dialogs', 'actions').save.fr.status).toBe('verified');
      expect(existsSync(join(root, 'translations', 'common', 'resource_entries.json'))).toBe(false);
      expect(result.mutations).toEqual([
        expect.objectContaining({ kind: 'upsert', key: 'dialogs.actions.save' }),
        expect.objectContaining({ kind: 'remove', key: 'common.save', translationsFolder: target.translationsFolder }),
      ]);
    });

    it('moves the entry to the collection root with an empty moveTo, even with no other change', async () => {
      const result = await editResource(collection(), 'common.save', { moveTo: '' });

      expect(result.updated).toBe(true);
      expect(result.resolvedKey).toBe('save');
      expect(read('resource_entries.json').save.source).toBe('Save');
    });

    it('edits in place when moveTo is the current folder', async () => {
      const result = await editResource(collection(), 'common.save', { comment: 'Same', moveTo: 'common' });

      expect(result.resolvedKey).toBe('common.save');
      expect(result.mutations).toEqual([expect.objectContaining({ kind: 'upsert', key: 'common.save' })]);
      expect(read('resource_entries.json', 'common').save.comment).toBe('Same');
    });

    it('refuses to overwrite an entry at the destination and changes nothing', async () => {
      const other = openResourceFolder(join(root, 'translations', 'dialogs'), { baseLocale: 'en' });
      other.setBase('save', 'Other');
      other.save();

      await expect(editResource(collection(), 'common.save', { comment: 'Lost?', moveTo: 'dialogs' })).rejects.toThrow(
        ResourceAlreadyExistsError,
      );
      expect(read('resource_entries.json', 'common').save.comment).toBeUndefined();
      expect(read('resource_entries.json', 'dialogs').save.source).toBe('Other');
    });

    it('rejects a malformed destination folder', async () => {
      await expect(editResource(collection(), 'common.save', { moveTo: '../evil' })).rejects.toThrow(
        InvalidResourceKeyError,
      );
    });

    describe('while auto-translation is awaited', () => {
      /** Makes the provider wait until `release()`; `called` resolves once the edit is awaiting it. */
      function holdProvider(): { called: Promise<void>; release: () => void } {
        let release = (): void => undefined;
        let markCalled = (): void => undefined;
        const called = new Promise<void>((resolve) => {
          markCalled = resolve;
        });
        vi.mocked(autoTranslateResource).mockImplementation(() => {
          markCalled();
          return new Promise((resolve) => {
            release = () => resolve({ translations: [], skippedLocales: [] });
          });
        });
        return { called, release: () => release() };
      }

      function writeDestinationEntry(key: string, value: string): void {
        const other = openResourceFolder(join(root, 'translations', 'dialogs'), { baseLocale: 'en' });
        other.setBase(key, value);
        other.save();
      }

      it('keeps an entry written to the destination folder meanwhile, and still moves the edited entry', async () => {
        const provider = holdProvider();

        const editing = editResource(collection(AUTO), 'common.save', { baseValue: 'Save all', moveTo: 'dialogs' });
        await provider.called;
        writeDestinationEntry('cancel', 'Cancel');
        provider.release();
        const result = await editing;

        const destination = read('resource_entries.json', 'dialogs');
        expect(destination.cancel).toEqual({ source: 'Cancel' });
        expect(destination.save.source).toBe('Save all');
        expect(result.resolvedKey).toBe('dialogs.save');
      });

      it('throws ResourceAlreadyExistsError when the entry key was taken meanwhile, keeping both entries', async () => {
        const provider = holdProvider();

        const editing = editResource(collection(AUTO), 'common.save', { baseValue: 'Save all', moveTo: 'dialogs' });
        await provider.called;
        writeDestinationEntry('save', 'Other');
        provider.release();

        await expect(editing).rejects.toThrow(ResourceAlreadyExistsError);
        expect(read('resource_entries.json', 'dialogs').save).toEqual({ source: 'Other' });
        // The edit itself was saved before the move was attempted.
        expect(read('resource_entries.json', 'common').save.source).toBe('Save all');
      });
    });
  });
});
