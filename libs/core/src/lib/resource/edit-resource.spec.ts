import type { ResourceMutation } from './resource-mutation';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findPreferredTermFindings } from '@simoncodes-ca/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import type { TranslationConfig } from '../../config/translation-config';
import { type Collection, openCollection } from '../config/open-collection';
import {
  CoreOperationError,
  InvalidResourceKeyError,
  InvalidTranslationStatusError,
  LocaleNotFoundError,
  ResourceAlreadyExistsError,
  ResourceNotFoundError,
} from '../errors/lingo-tracker-error';
import { writeJsonFile } from '../file-io/json-file-operations';
import { InMemoryTranslationProvider } from '../translation/in-memory-translation-provider';
import { TranslationError } from '../translation/translation-provider';
import { calculateChecksum as md5 } from './checksum';
import { editResource } from './edit-resource';
import { openResourceFolder } from './resource-folder';

const collected: ResourceMutation[] = [];
const onMutation = (mutation: ResourceMutation): void => {
  collected.push(mutation);
};
beforeEach(() => {
  collected.length = 0;
});

vi.mock('../file-io/json-file-operations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../file-io/json-file-operations')>();
  return { ...actual, writeJsonFile: vi.fn(actual.writeJsonFile) };
});

// Wrapped, not replaced: the specs below check which value the terminology check is given.
vi.mock('@simoncodes-ca/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simoncodes-ca/domain')>();
  return { ...actual, findPreferredTermFindings: vi.fn(actual.findPreferredTermFindings) };
});

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
    return openCollection(config, 'main', { cwd: root });
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
    seedEntry();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('throws ResourceNotFoundError for a missing entry', async () => {
    await expect(editResource(collection(), 'common.missing', { comment: 'x' }, { onMutation })).rejects.toThrow(
      ResourceNotFoundError,
    );
    await expect(editResource(collection(), 'nowhere.save', { comment: 'x' }, { onMutation })).rejects.toThrow(
      ResourceNotFoundError,
    );
  });

  it('reports no changes and writes nothing when nothing differs', async () => {
    const result = await editResource(
      collection(),
      'common.save',
      { baseValue: 'Save', translations: {} },
      { onMutation },
    );

    expect(result).toEqual({
      resolvedKey: 'common.save',
      updated: false,
      message: 'No changes detected',
    });
    expect(collected).toEqual([]);
  });

  describe('base value change', () => {
    it('keeps real translations as `stale` and re-seeds copies and missing locales as `new`', async () => {
      const provider = new InMemoryTranslationProvider();

      const result = await editResource(
        collection(),
        'common.save',
        { baseValue: 'Save all' },
        { onMutation, provider },
      );

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
      expect(provider.calls).toEqual([]);
    });

    it('auto-translates every locale that needs work, except those supplied in the same edit', async () => {
      // es loses the placeholder marker, so the Translator skips it.
      const provider = new InMemoryTranslationProvider(({ text, targetLocale }) =>
        targetLocale === 'de' ? text.replace('Save all', 'Alles speichern') : 'Guardar todo',
      );

      const result = await editResource(
        collection(AUTO),
        'common.save',
        {
          baseValue: 'Save all {count}',
          translations: { fr: { value: 'Tout enregistrer {count}', status: 'translated' } },
        },
        { onMutation, provider },
      );

      expect(provider.calls.map((call) => call.map(({ targetLocale }) => targetLocale))).toEqual([['de'], ['es']]);
      expect(read('resource_entries.json', 'common').save).toEqual({
        source: 'Save all {count}',
        fr: 'Tout enregistrer {count}',
        de: 'Alles speichern {count}',
        es: 'Save all {count}',
      });
      const meta = read('tracker_meta.json', 'common').save;
      expect(meta.fr.status).toBe('translated');
      expect(meta.de).toEqual({
        checksum: md5('Alles speichern {count}'),
        baseChecksum: md5('Save all {count}'),
        status: 'translated',
      });
      expect(meta.es.status).toBe('new');
      expect(result.skippedLocales).toEqual(['es']);
    });

    it('keeps the saved edit when the provider fails', async () => {
      const provider = new InMemoryTranslationProvider(() => {
        throw new TranslationError('down', 'SERVICE_ERROR', true);
      });

      await expect(
        editResource(collection(AUTO), 'common.save', { baseValue: 'Save all' }, { onMutation, provider }),
      ).rejects.toThrow(TranslationError);

      expect(read('resource_entries.json', 'common').save.source).toBe('Save all');
      expect(read('tracker_meta.json', 'common').save.fr.status).toBe('stale');
      expect(collected).toEqual([expect.objectContaining({ kind: 'upsert', key: 'common.save' })]);
    });

    it('does not seed anything when only the comment changes', async () => {
      const provider = new InMemoryTranslationProvider();

      await editResource(collection(AUTO), 'common.save', { comment: 'Toolbar button' }, { onMutation, provider });

      expect(provider.calls).toEqual([]);
      expect(read('resource_entries.json', 'common').save.es).toBeUndefined();
    });

    it('normalizes a Transloco base value to ICU', async () => {
      await editResource(collection(), 'common.save', { baseValue: 'Save {{ count }}' }, { onMutation });

      expect(read('resource_entries.json', 'common').save.source).toBe('Save {count}');
    });
  });

  describe('details and translations', () => {
    it('does nothing when the value is unchanged and no status is requested', async () => {
      expect(
        (
          await editResource(
            collection(),
            'common.save',
            {
              translations: { de: { value: 'Save' }, fr: { value: 'Enregistrer' } },
            },
            { onMutation },
          )
        ).updated,
      ).toBe(false);
      expect(read('tracker_meta.json', 'common').save.de.status).toBe('new');
      expect(read('tracker_meta.json', 'common').save.fr.status).toBe('verified');
    });

    it('changes an identical copy to explicit translated without changing its value', async () => {
      await editResource(
        collection(),
        'common.save',
        {
          translations: { de: { value: 'Save', status: 'translated' } },
        },
        { onMutation },
      );
      expect(read('tracker_meta.json', 'common').save.de.status).toBe('translated');
    });

    it('infers new for a changed value that copies the base', async () => {
      await editResource(collection(), 'common.save', { translations: { fr: { value: 'Save' } } }, { onMutation });
      expect(read('tracker_meta.json', 'common').save.fr.status).toBe('new');
    });

    it('keeps explicit translated for a changed value that copies the base', async () => {
      await editResource(
        collection(),
        'common.save',
        {
          translations: { fr: { value: 'Save', status: 'translated' } },
        },
        { onMutation },
      );
      expect(read('tracker_meta.json', 'common').save.fr.status).toBe('translated');
    });

    it('changes only an explicitly requested status for an unchanged value', async () => {
      const metaPath = join(root, 'translations', 'common', 'tracker_meta.json');
      const metadata = read('tracker_meta.json', 'common');
      metadata.save.fr.baseChecksum = 'old-base';
      writeFileSync(metaPath, JSON.stringify(metadata));

      await editResource(
        collection(),
        'common.save',
        {
          translations: { fr: { value: 'Enregistrer', status: 'stale' } },
        },
        { onMutation },
      );

      expect(read('tracker_meta.json', 'common').save.fr).toEqual({
        checksum: md5('Enregistrer'),
        baseChecksum: 'old-base',
        status: 'stale',
      });
    });

    it('rejects an unknown status before changing the resource', async () => {
      await expect(
        editResource(
          collection(),
          'common.save',
          {
            translations: { fr: { value: 'Autre', status: 'verifed' as never } },
          },
          { onMutation },
        ),
      ).rejects.toThrow(InvalidTranslationStatusError);
      expect(read('resource_entries.json', 'common').save.fr).toBe('Enregistrer');
    });

    it('updates comment and normalized tags', async () => {
      await editResource(collection(), 'common.save', { comment: 'Button', tags: ['UI', 'forms'] }, { onMutation });

      const entry = read('resource_entries.json', 'common').save;
      expect(entry.comment).toBe('Button');
      expect(entry.tags).toEqual(['ui', 'forms']);
    });

    it('writes a translation with status `translated` by default, or the supplied status', async () => {
      await editResource(
        collection(),
        'common.save',
        {
          translations: { de: { value: 'Speichern' }, es: { value: 'Guardar', status: 'verified' } },
        },
        { onMutation },
      );

      const meta = read('tracker_meta.json', 'common').save;
      expect(meta.de.status).toBe('translated');
      expect(meta.es.status).toBe('verified');
      expect(read('resource_entries.json', 'common').save.de).toBe('Speichern');
    });

    it('changes only the status when the value is unchanged', async () => {
      await editResource(
        collection(),
        'common.save',
        {
          translations: { fr: { value: 'Enregistrer', status: 'stale' } },
        },
        { onMutation },
      );

      const meta = read('tracker_meta.json', 'common').save;
      expect(meta.fr).toEqual({ checksum: md5('Enregistrer'), baseChecksum: md5('Save'), status: 'stale' });
    });

    it('ignores a value for the base locale', async () => {
      const result = await editResource(
        collection(),
        'common.save',
        { translations: { en: { value: 'Nope' } } },
        { onMutation },
      );

      expect(result.updated).toBe(false);
      expect(read('resource_entries.json', 'common').save.source).toBe('Save');
    });

    it('rejects a locale the collection does not have', async () => {
      await expect(
        editResource(collection(), 'common.save', { translations: { ja: { value: '保存' } } }, { onMutation }),
      ).rejects.toThrow(LocaleNotFoundError);
    });
  });

  describe('moveTo', () => {
    it('delivers the saved edit and a reindex when the move write fails', async () => {
      const actual = await vi.importActual<typeof import('../file-io/json-file-operations')>(
        '../file-io/json-file-operations',
      );
      const writer = vi.mocked(writeJsonFile);
      writer.mockImplementation((options) => {
        if (options.filePath.endsWith(join('dialogs', 'resource_entries.json'))) {
          throw new Error('destination write failed');
        }
        return actual.writeJsonFile(options);
      });
      try {
        await expect(
          editResource(collection(), 'common.save', { comment: 'Edited', moveTo: 'dialogs' }, { onMutation }),
        ).rejects.toThrow(CoreOperationError);
      } finally {
        writer.mockImplementation(actual.writeJsonFile);
      }
      expect(collected).toEqual([
        expect.objectContaining({ kind: 'upsert', key: 'common.save' }),
        { kind: 'reindex', translationsFolder: collection().translationsFolder },
      ]);
    });

    it('moves the edited entry into another folder, keeping its entry key', async () => {
      const target = collection();
      const result = await editResource(
        target,
        'common.save',
        { comment: 'Moved', moveTo: 'dialogs.actions' },
        { onMutation },
      );

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
      expect(collected).toEqual([
        expect.objectContaining({ kind: 'upsert', key: 'common.save', translationsFolder: target.translationsFolder }),
        expect.objectContaining({ kind: 'remove', key: 'common.save', translationsFolder: target.translationsFolder }),
        expect.objectContaining({ kind: 'upsert', key: 'dialogs.actions.save' }),
      ]);
    });

    it('moves the entry to the collection root with an empty moveTo, even with no other change', async () => {
      const result = await editResource(collection(), 'common.save', { moveTo: '' }, { onMutation });

      expect(result.updated).toBe(true);
      expect(result.resolvedKey).toBe('save');
      expect(read('resource_entries.json').save.source).toBe('Save');
    });

    it('moves the entry to the collection root with a whitespace-only moveTo', async () => {
      const result = await editResource(collection(), 'common.save', { moveTo: '   ' }, { onMutation });

      expect(result.updated).toBe(true);
      expect(result.resolvedKey).toBe('save');
      expect(read('resource_entries.json').save.source).toBe('Save');
      expect(existsSync(join(root, 'translations', 'common', 'resource_entries.json'))).toBe(false);
    });

    it('edits in place when moveTo is the current folder', async () => {
      const result = await editResource(
        collection(),
        'common.save',
        { comment: 'Same', moveTo: 'common' },
        { onMutation },
      );

      expect(result.resolvedKey).toBe('common.save');
      expect(collected).toEqual([expect.objectContaining({ kind: 'upsert', key: 'common.save' })]);
      expect(read('resource_entries.json', 'common').save.comment).toBe('Same');
    });

    it('refuses to overwrite an entry at the destination and changes nothing', async () => {
      const other = openResourceFolder(join(root, 'translations', 'dialogs'), { baseLocale: 'en' });
      other.setBase('save', 'Other');
      other.save();

      await expect(
        editResource(collection(), 'common.save', { comment: 'Lost?', moveTo: 'dialogs' }, { onMutation }),
      ).rejects.toThrow(ResourceAlreadyExistsError);
      expect(read('resource_entries.json', 'common').save.comment).toBeUndefined();
      expect(read('resource_entries.json', 'dialogs').save.source).toBe('Other');
    });

    it('rejects a malformed destination folder', async () => {
      await expect(editResource(collection(), 'common.save', { moveTo: '../evil' }, { onMutation })).rejects.toThrow(
        InvalidResourceKeyError,
      );
    });

    describe('while auto-translation is awaited', () => {
      /** A provider that waits until `release()`; `called` resolves once the edit is awaiting it. */
      function holdProvider(): { provider: InMemoryTranslationProvider; called: Promise<void>; release: () => void } {
        let release = (): void => undefined;
        let markCalled = (): void => undefined;
        const called = new Promise<void>((resolve) => {
          markCalled = resolve;
        });
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        const provider = new InMemoryTranslationProvider();
        const translate = provider.translate.bind(provider);
        provider.translate = async (requests) => {
          markCalled();
          await held;
          return translate(requests);
        };
        return { provider, called, release: () => release() };
      }

      function writeDestinationEntry(key: string, value: string): void {
        const other = openResourceFolder(join(root, 'translations', 'dialogs'), { baseLocale: 'en' });
        other.setBase(key, value);
        other.save();
      }

      it('keeps an entry written to the destination folder meanwhile, and still moves the edited entry', async () => {
        const provider = holdProvider();

        const editing = editResource(
          collection(AUTO),
          'common.save',
          { baseValue: 'Save all', moveTo: 'dialogs' },
          { onMutation, provider: provider.provider },
        );
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

        const editing = editResource(
          collection(AUTO),
          'common.save',
          { baseValue: 'Save all', moveTo: 'dialogs' },
          { onMutation, provider: provider.provider },
        );
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

  describe('terminology (Project Terms)', () => {
    const rules = [{ discouraged: 'Expenditure', preferred: 'Investment' }];

    beforeEach(() => {
      writeFileSync(join(root, '.lingo-tracker-preferred-terminology.json'), JSON.stringify(rules), 'utf8');
    });

    it('checks a supplied base value and returns the findings under the key', async () => {
      const result = await editResource(
        collection(),
        'common.save',
        { baseValue: 'Save the expenditure' },
        { onMutation },
      );

      expect(result.terminology).toEqual({
        findings: [
          {
            key: 'common.save',
            discouraged: 'Expenditure',
            preferred: 'Investment',
            message: 'consider "Investment" instead of "Expenditure"',
          },
        ],
        problems: [],
      });
    });

    it('reports the findings under the destination key when the edit also moves the entry', async () => {
      const result = await editResource(
        collection(),
        'common.save',
        {
          baseValue: 'Save the expenditure',
          moveTo: 'dialogs',
        },
        { onMutation },
      );

      expect(result.terminology?.findings.map(({ key }) => key)).toEqual(['dialogs.save']);
    });

    it('checks the stored ICU value, not the Transloco input', async () => {
      vi.mocked(findPreferredTermFindings).mockClear();

      const result = await editResource(
        collection(),
        'common.save',
        { baseValue: 'Save {{ expenditure }}' },
        { onMutation },
      );

      expect(read('resource_entries.json', 'common').save.source).toBe('Save {expenditure}');
      expect(findPreferredTermFindings).toHaveBeenCalledWith('Save {expenditure}', rules);
      // The placeholder is an argument, not wording.
      expect(result.terminology).toEqual({ findings: [], problems: [] });
    });

    it('adds a named protected-terms file that does not exist to problems when auto-translation ran', async () => {
      const config: LingoTrackerConfig = {
        exportFolder: 'dist',
        importFolder: 'import',
        baseLocale: 'en',
        locales: ['en', 'fr', 'de', 'es'],
        protectedTermsFile: 'typo.json',
        translation: AUTO,
        collections: { main: { translationsFolder: join(root, 'translations') } },
      };
      const named = openCollection(config, 'main', { cwd: root });

      const result = await editResource(
        named,
        'common.save',
        { baseValue: 'Save now' },
        { onMutation, provider: new InMemoryTranslationProvider() },
      );

      expect(result.terminology?.problems).toEqual([
        `Protected terms file not found: ${join(root, 'typo.json')}. Treating as an empty list.`,
      ]);
    });

    it('leaves terminology out when the edit supplied no base value, or changed nothing', async () => {
      const comment = await editResource(collection(), 'common.save', { comment: 'Expenditure' }, { onMutation });
      const unchanged = await editResource(collection(), 'common.save', { baseValue: 'Save' }, { onMutation });

      expect(comment.updated).toBe(true);
      expect(comment.terminology).toBeUndefined();
      expect(unchanged.updated).toBe(false);
      expect(unchanged.terminology).toBeUndefined();
    });
  });
});
