import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openResourceFolder, translationLocales } from './resource-folder';
import { calculateChecksum } from '../../resource/checksum';

const md5 = calculateChecksum;

describe('ResourceFolder', () => {
  let dir: string;
  let folderPath: string;

  const readEntries = () => JSON.parse(readFileSync(join(folderPath, 'resource_entries.json'), 'utf8'));
  const readMeta = () => JSON.parse(readFileSync(join(folderPath, 'tracker_meta.json'), 'utf8'));
  const writePair = (entries: unknown, meta: unknown) => {
    writeFileSync(join(folderPath, 'resource_entries.json'), JSON.stringify(entries));
    writeFileSync(join(folderPath, 'tracker_meta.json'), JSON.stringify(meta));
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'resource-folder-'));
    folderPath = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('open', () => {
    it('treats missing files as an empty folder', () => {
      const folder = openResourceFolder(join(dir, 'missing'));
      expect(folder.isEmpty()).toBe(true);
      expect(folder.keys()).toEqual([]);
      expect(folder.get('ok')).toBeUndefined();
    });

    it('loads both files', () => {
      writePair({ ok: { source: 'OK', fr: 'Oui' } }, { ok: { en: { checksum: md5('OK') } } });
      const folder = openResourceFolder(folderPath);
      expect(folder.keys()).toEqual(['ok']);
      expect(folder.get('ok')).toEqual({ entry: { source: 'OK', fr: 'Oui' }, meta: { en: { checksum: md5('OK') } } });
    });

    it('throws on malformed JSON', () => {
      writeFileSync(join(folderPath, 'resource_entries.json'), '{ not json');
      expect(() => openResourceFolder(folderPath)).toThrow();
    });

    it('does not treat prototype properties as keys', () => {
      writePair({}, {});
      expect(openResourceFolder(folderPath).has('constructor')).toBe(false);
    });
  });

  describe('setBase', () => {
    it('creates a new entry with its base checksum', () => {
      const folder = openResourceFolder(join(dir, 'a', 'b'));
      expect(folder.setBase('ok', 'OK')).toBe(true);
      folder.save();

      folderPath = join(dir, 'a', 'b');
      expect(readEntries()).toEqual({ ok: { source: 'OK' } });
      expect(readMeta()).toEqual({ ok: { en: { checksum: md5('OK') } } });
    });

    it('returns false when nothing changed', () => {
      writePair({ ok: { source: 'OK' } }, { ok: { en: { checksum: md5('OK') } } });
      expect(openResourceFolder(folderPath).setBase('ok', 'OK')).toBe(false);
    });

    it('applies the staleness rule when the base value changes', () => {
      writePair(
        { ok: { source: 'OK', fr: "D'accord", es: 'Okay' } },
        {
          ok: {
            en: { checksum: md5('OK') },
            fr: { checksum: md5("D'accord"), baseChecksum: md5('OK'), status: 'verified' },
            es: { checksum: md5('Okay'), baseChecksum: md5('OK'), status: 'translated' },
          },
        },
      );

      const folder = openResourceFolder(folderPath);
      folder.setBase('ok', 'Okay');

      expect(folder.get('ok')?.meta).toEqual({
        en: { checksum: md5('Okay') },
        fr: { checksum: md5("D'accord"), baseChecksum: md5('Okay'), status: 'stale' },
        // An untranslated copy of the new base stays 'new'
        es: { checksum: md5('Okay'), baseChecksum: md5('Okay'), status: 'new' },
      });
    });

    it('treats a stored checksum that disagrees with the stored value as a base change', () => {
      writePair(
        { ok: { source: 'Edited by hand', fr: 'Oui' } },
        {
          ok: {
            en: { checksum: md5('OK') },
            fr: { checksum: md5('Oui'), baseChecksum: md5('OK'), status: 'translated' },
          },
        },
      );

      const folder = openResourceFolder(folderPath);
      expect(folder.setBase('ok', 'Edited by hand')).toBe(true);
      expect(folder.get('ok')?.meta?.['fr'].status).toBe('stale');
    });

    it('records a missing base checksum without staling translations', () => {
      writePair(
        { ok: { source: 'OK', fr: 'Oui' } },
        { ok: { fr: { checksum: md5('Oui'), baseChecksum: md5('OK'), status: 'verified' } } },
      );

      const folder = openResourceFolder(folderPath);
      folder.setBase('ok', 'OK');
      expect(folder.get('ok')?.meta).toEqual({
        fr: { checksum: md5('Oui'), baseChecksum: md5('OK'), status: 'verified' },
        en: { checksum: md5('OK') },
      });
    });

    it('uses the configured base locale', () => {
      const folder = openResourceFolder(folderPath, { baseLocale: 'fr' });
      folder.setBase('ok', 'Oui');
      expect(folder.get('ok')?.meta).toEqual({ fr: { checksum: md5('Oui') } });
    });
  });

  describe('setTranslation / setStatus', () => {
    it('records checksum, current base checksum, and status', () => {
      const folder = openResourceFolder(folderPath);
      folder.setBase('ok', 'OK');
      folder.setTranslation('ok', 'fr', 'Oui', 'verified');

      expect(folder.get('ok')?.entry).toEqual({ source: 'OK', fr: 'Oui' });
      expect(folder.get('ok')?.meta?.['fr']).toEqual({
        checksum: md5('Oui'),
        baseChecksum: md5('OK'),
        status: 'verified',
      });
    });

    it('defaults status to translated', () => {
      const folder = openResourceFolder(folderPath);
      folder.setBase('ok', 'OK');
      folder.setTranslation('ok', 'fr', 'Oui');
      expect(folder.get('ok')?.meta?.['fr'].status).toBe('translated');
    });

    it('falls back to the checksum of the source when base metadata is missing', () => {
      writePair({ ok: { source: 'OK' } }, {});
      const folder = openResourceFolder(folderPath);
      folder.setTranslation('ok', 'fr', 'Oui');
      expect(folder.get('ok')?.meta?.['fr'].baseChecksum).toBe(md5('OK'));
    });

    it('rejects unknown keys and the base locale', () => {
      const folder = openResourceFolder(folderPath);
      expect(() => folder.setTranslation('missing', 'fr', 'Oui')).toThrow('Resource entry not found');
      folder.setBase('ok', 'OK');
      expect(() => folder.setTranslation('ok', 'en', 'OK')).toThrow('base locale');
    });

    it('setStatus changes only the status', () => {
      const folder = openResourceFolder(folderPath);
      folder.setBase('ok', 'OK');
      folder.setTranslation('ok', 'fr', 'Oui');
      folder.setStatus('ok', 'fr', 'verified');
      expect(folder.get('ok')?.meta?.['fr']).toEqual({
        checksum: md5('Oui'),
        baseChecksum: md5('OK'),
        status: 'verified',
      });
      expect(() => folder.setStatus('ok', 'de', 'verified')).toThrow();
    });
    it('setStatus can re-confirm against the current base checksum', () => {
      writePair(
        { ok: { source: 'Okay', fr: 'Oui' } },
        {
          ok: {
            en: { checksum: md5('Okay') },
            fr: { checksum: 'kept', baseChecksum: md5('OK'), status: 'stale' },
          },
        },
      );
      const folder = openResourceFolder(folderPath);
      folder.setStatus('ok', 'fr', 'translated', { refreshBaseChecksum: true });
      expect(folder.get('ok')?.meta?.['fr']).toEqual({
        checksum: 'kept',
        baseChecksum: md5('Okay'),
        status: 'translated',
      });
    });
  });

  describe('setDetails', () => {
    it('sets, keeps, and removes comment and tags', () => {
      const folder = openResourceFolder(folderPath);
      folder.setBase('ok', 'OK');

      expect(folder.setDetails('ok', { comment: 'Button', tags: ['ui'] })).toBe(true);
      expect(folder.setDetails('ok', { comment: 'Button', tags: ['ui'] })).toBe(false);
      expect(folder.setDetails('ok', {})).toBe(false);
      expect(folder.get('ok')?.entry).toEqual({ source: 'OK', comment: 'Button', tags: ['ui'] });

      expect(folder.setDetails('ok', { comment: null, tags: [] })).toBe(true);
      expect(folder.get('ok')?.entry).toEqual({ source: 'OK' });
    });
  });

  describe('setEntry', () => {
    it('stores entry and metadata losslessly, keeping key position', () => {
      writePair({ a: { source: 'A' }, b: { source: 'B' } }, {});
      const folder = openResourceFolder(folderPath);
      const meta = {
        en: { checksum: md5('A2') },
        fr: { checksum: md5('Un'), baseChecksum: md5('A1'), status: 'verified' as const },
      };

      folder.setEntry('a', { source: 'A2', fr: 'Un', comment: 'c' }, meta);

      expect(folder.keys()).toEqual(['a', 'b']);
      expect(folder.get('a')).toEqual({ entry: { source: 'A2', fr: 'Un', comment: 'c' }, meta });
    });
  });

  describe('seedLocale / dropLocale', () => {
    it('seeds missing locales as new copies of the base and drops them again', () => {
      writePair(
        { ok: { source: 'OK' }, no: { source: 'No', de: 'Nein' } },
        { ok: { en: { checksum: md5('OK') } }, no: { en: { checksum: md5('No') } } },
      );
      const folder = openResourceFolder(folderPath);

      expect(folder.seedLocale('de')).toBe(1);
      expect(folder.get('ok')?.entry['de']).toBe('OK');
      expect(folder.get('ok')?.meta?.['de']).toEqual({ checksum: md5('OK'), baseChecksum: md5('OK'), status: 'new' });
      expect(folder.get('no')?.entry['de']).toBe('Nein');

      expect(folder.dropLocale('de')).toBe(2);
      expect(folder.get('ok')).toEqual({ entry: { source: 'OK' }, meta: { en: { checksum: md5('OK') } } });
      expect(folder.dropLocale('de')).toBe(0);
    });
  });

  describe('treeEntry / translationLocales', () => {
    it('builds the tree entry and lists translation locales', () => {
      writePair({ ok: { source: 'OK', comment: 'c', tags: [], fr: 'Oui' } }, { ok: { en: { checksum: md5('OK') } } });
      const folder = openResourceFolder(folderPath);
      const stored = folder.get('ok');
      expect(stored).toBeDefined();
      expect(translationLocales(stored?.entry ?? { source: '' })).toEqual(['fr']);
      expect(folder.treeEntry('ok')).toEqual({
        key: 'ok',
        source: 'OK',
        translations: { fr: 'Oui' },
        metadata: { en: { checksum: md5('OK') } },
        comment: 'c',
      });
    });

    it('returns undefined when metadata is missing', () => {
      writePair({ ok: { source: 'OK' } }, {});
      expect(openResourceFolder(folderPath).treeEntry('ok')).toBeUndefined();
    });
  });

  describe('save', () => {
    it('writes both files and reports which were created', () => {
      const target = join(dir, 'nested');
      const folder = openResourceFolder(target);
      folder.setBase('ok', 'OK');

      const first = folder.save();
      expect(first.written).toEqual([join(target, 'resource_entries.json'), join(target, 'tracker_meta.json')]);
      expect(first.created).toEqual(first.written);

      const second = folder.save();
      expect(second.created).toEqual([]);
    });

    it('dryRun reports without writing', () => {
      const target = join(dir, 'dry');
      const folder = openResourceFolder(target);
      folder.setBase('ok', 'OK');

      const result = folder.save({ dryRun: true });
      expect(result.written).toHaveLength(2);
      expect(existsSync(target)).toBe(false);
    });

    it('removes both files when the folder becomes empty', () => {
      writePair({ ok: { source: 'OK' } }, { ok: { en: { checksum: md5('OK') } } });
      const folder = openResourceFolder(folderPath);
      expect(folder.remove('ok')).toBe(true);
      expect(folder.remove('ok')).toBe(false);

      const result = folder.save();
      expect(result.removed).toHaveLength(2);
      expect(existsSync(join(folderPath, 'resource_entries.json'))).toBe(false);
      expect(existsSync(join(folderPath, 'tracker_meta.json'))).toBe(false);
    });

    it('round-trips through disk', () => {
      const folder = openResourceFolder(folderPath);
      folder.setBase('ok', 'OK');
      folder.setTranslation('ok', 'fr', 'Oui');
      folder.save();

      const reopened = openResourceFolder(folderPath);
      expect(reopened.get('ok')).toEqual(folder.get('ok'));
    });
  });
});
