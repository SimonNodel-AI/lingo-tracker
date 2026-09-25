import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { calculateChecksum } from '../../resource/checksum';
import { type Collection, openCollection } from '../config/open-collection';
import { openResourceFolder } from '../resource/resource-folder';
import { importResources } from './import-resources';
import type { ImportedResource } from './types';

describe('importResources', () => {
  let projectDir: string;
  let collection: Collection;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'lingo-import-resources-'));
    collection = openCollection(
      {
        baseLocale: 'en',
        locales: ['en', 'es', 'fr'],
        exportFolder: 'dist/export',
        importFolder: 'dist/import',
        collections: { main: { translationsFolder: 'translations' } },
      },
      'main',
      { cwd: projectDir },
    );
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  /** Absolute folder path of a dot-delimited folder key, e.g. 'common.buttons'. */
  const folderOf = (folderKey: string): string => join(collection.translationsFolder, ...folderKey.split('.'));

  /** Writes a folder's two files as given (use for metadata that `ResourceFolder` would never produce). */
  const writeFolder = (folderKey: string, entries: object, meta: object): void => {
    const folder = folderOf(folderKey);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'resource_entries.json'), JSON.stringify(entries));
    writeFileSync(join(folder, 'tracker_meta.json'), JSON.stringify(meta));
  };

  /** Seeds entries through `ResourceFolder`, so checksums and statuses are consistent. */
  const seed = (
    folderKey: string,
    entries: Record<string, { source: string; es?: string; esStatus?: 'translated' | 'verified' }>,
  ): void => {
    const folder = openResourceFolder(folderOf(folderKey), { baseLocale: 'en' });
    for (const [key, { source, es, esStatus }] of Object.entries(entries)) {
      folder.setBase(key, source);
      if (es !== undefined) folder.setTranslation(key, 'es', es, esStatus ?? 'translated');
    }
    folder.save();
  };

  const stored = (folderKey: string, key: string) =>
    openResourceFolder(folderOf(folderKey), { baseLocale: 'en' }).get(key);

  describe('target-locale import', () => {
    it('writes the translation, sets its status and base checksum, and reports the change', () => {
      seed('common.buttons', { ok: { source: 'OK' }, cancel: { source: 'Cancel', es: 'Cancelar' } });

      const result = importResources(
        collection,
        [
          { key: 'common.buttons.ok', value: 'Aceptar' },
          { key: 'common.buttons.cancel', value: 'Cancelar ya' },
        ],
        { locale: 'es' },
      );

      expect(result).toMatchObject({
        strategy: 'translation-service',
        locale: 'es',
        collection: 'main',
        resourcesImported: 2,
        resourcesUpdated: 2,
        resourcesCreated: 0,
        resourcesSkipped: 0,
        resourcesFailed: 0,
        dryRun: false,
        errors: [],
      });
      expect(result.statusTransitions).toEqual(
        expect.arrayContaining([
          { from: undefined, to: 'translated', count: 1 },
          { from: 'translated', to: 'translated', count: 1 },
        ]),
      );
      expect(result.filesModified.sort()).toEqual(
        [
          join(folderOf('common.buttons'), 'resource_entries.json'),
          join(folderOf('common.buttons'), 'tracker_meta.json'),
        ].sort(),
      );

      const ok = stored('common.buttons', 'ok');
      expect(ok?.entry['es']).toBe('Aceptar');
      expect(ok?.meta?.['es']).toEqual({
        checksum: calculateChecksum('Aceptar'),
        baseChecksum: calculateChecksum('OK'),
        status: 'translated',
      });
      expect(stored('common.buttons', 'cancel')?.entry['es']).toBe('Cancelar ya');
    });

    it('skips a resource that does not exist unless createMissing is set', () => {
      seed('common', { ok: { source: 'OK' } });

      const result = importResources(collection, [{ key: 'common.missing', value: 'Falta', baseValue: 'Missing' }], {
        locale: 'es',
      });

      expect(result.resourcesSkipped).toBe(1);
      expect(result.changes[0]).toMatchObject({ key: 'common.missing', type: 'skipped' });
      expect(stored('common', 'missing')).toBeUndefined();
    });

    it('creates a missing resource from its baseValue when createMissing is set', () => {
      const result = importResources(collection, [{ key: 'common.greeting', value: 'Hola', baseValue: 'Hello' }], {
        locale: 'es',
        createMissing: true,
      });

      expect(result.resourcesCreated).toBe(1);
      expect(stored('common', 'greeting')?.entry).toMatchObject({ source: 'Hello', es: 'Hola' });
    });

    it('refreshes a stale base checksum when a translation-service import re-confirms the value', () => {
      writeFolder(
        'common',
        { ok: { source: 'OK', es: 'Aceptar' } },
        {
          ok: {
            en: { checksum: calculateChecksum('OK') },
            es: { checksum: calculateChecksum('Aceptar'), baseChecksum: 'old', status: 'stale' },
          },
        },
      );

      const result = importResources(collection, [{ key: 'common.ok', value: 'Aceptar' }], { locale: 'es' });

      expect(result.changes[0]).toMatchObject({ type: 'updated', oldStatus: 'stale', newStatus: 'translated' });
      expect(stored('common', 'ok')?.meta?.['es']).toMatchObject({
        baseChecksum: calculateChecksum('OK'),
        status: 'translated',
      });
    });
  });

  describe('dry run', () => {
    it('reports the changes without writing anything', () => {
      seed('common', { ok: { source: 'OK' } });
      const before = readFileSync(join(folderOf('common'), 'resource_entries.json'), 'utf8');

      const result = importResources(
        collection,
        [
          { key: 'common.ok', value: 'Aceptar' },
          { key: 'fresh.key', value: 'Nuevo', baseValue: 'New' },
        ],
        { locale: 'es', dryRun: true, createMissing: true },
      );

      expect(result.dryRun).toBe(true);
      expect(result.resourcesUpdated).toBe(1);
      expect(result.resourcesCreated).toBe(1);
      expect(result.filesModified).toEqual([]);
      expect(readFileSync(join(folderOf('common'), 'resource_entries.json'), 'utf8')).toBe(before);
      expect(existsSync(folderOf('fresh'))).toBe(false);
    });
  });

  describe('base-locale import', () => {
    it('refuses the base locale unless the strategy is migration', () => {
      expect(() => importResources(collection, [], { locale: 'en' })).toThrow(
        'Cannot import into base locale "en" with strategy "translation-service"',
      );
      expect(() => importResources(collection, [], { locale: 'en', strategy: 'verification' })).toThrow(
        'Only "migration" strategy supports base locale imports.',
      );
    });

    it("uses the collection's own base locale", () => {
      const french = openCollection(
        {
          baseLocale: 'en',
          locales: ['en', 'fr'],
          exportFolder: 'dist/export',
          importFolder: 'dist/import',
          collections: { fr: { translationsFolder: 'translations', baseLocale: 'fr' } },
        },
        'fr',
        { cwd: projectDir },
      );

      expect(() => importResources(french, [], { locale: 'fr' })).toThrow('Cannot import into base locale "fr"');
      expect(importResources(french, [], { locale: 'en' }).errors).toEqual([]);
    });

    it('writes base values with migration and marks changed translations stale', () => {
      seed('common', { ok: { source: 'OK', es: 'Aceptar' } });

      const result = importResources(collection, [{ key: 'common.ok', value: 'Okay' }], {
        locale: 'en',
        strategy: 'migration',
      });

      expect(result.changes[0]).toMatchObject({ type: 'value-changed', oldValue: 'OK', newValue: 'Okay' });
      const ok = stored('common', 'ok');
      expect(ok?.entry.source).toBe('Okay');
      expect(ok?.meta?.['es']).toMatchObject({ status: 'stale', baseChecksum: calculateChecksum('Okay') });
    });
  });

  describe('strategy defaults', () => {
    it('lets migration create resources and update comments and tags by default', () => {
      seed('common', { ok: { source: 'OK', es: 'Vale' } });

      const result = importResources(
        collection,
        [
          { key: 'common.ok', value: 'Aceptar', comment: 'Button', tags: ['ui'] },
          { key: 'common.new', value: 'Nuevo', baseValue: 'New' },
        ],
        { locale: 'es', strategy: 'migration' },
      );

      expect(result.resourcesCreated).toBe(1);
      expect(stored('common', 'ok')?.entry).toMatchObject({ comment: 'Button', tags: ['ui'] });
    });

    it('lets explicit flags override the strategy defaults', () => {
      seed('common', { ok: { source: 'OK', es: 'Vale' } });

      const result = importResources(
        collection,
        [
          { key: 'common.ok', value: 'Aceptar', comment: 'Button' },
          { key: 'common.new', value: 'Nuevo', baseValue: 'New' },
        ],
        { locale: 'es', strategy: 'migration', createMissing: false, updateComments: false },
      );

      expect(result.resourcesCreated).toBe(0);
      expect(result.resourcesSkipped).toBe(1);
      expect(stored('common', 'ok')?.entry.comment).toBeUndefined();
    });
  });

  describe('preparation before writing', () => {
    it('resolves Transloco references between the imported resources for migration only', () => {
      seed('common', { ok: { source: 'OK' }, confirm: { source: 'Press OK' } });
      const resources: ImportedResource[] = [
        { key: 'common.ok', value: 'Aceptar' },
        { key: 'common.confirm', value: "Pulsa {{t('common.ok')}}" },
      ];

      importResources(collection, resources, { locale: 'es', strategy: 'migration' });
      expect(stored('common', 'confirm')?.entry['es']).toBe('Pulsa Aceptar');

      importResources(collection, resources, { locale: 'fr' });
      expect(stored('common', 'confirm')?.entry['fr']).toBe("Pulsa {{t('common.ok')}}");
    });

    it('converts Transloco {{ name }} placeholders to ICU before writing (JSON and XLIFF alike)', () => {
      seed('common', { greeting: { source: 'Hello {name}' } });

      importResources(collection, [{ key: 'common.greeting', value: 'Hola {{ name }}' }], { locale: 'es' });

      expect(stored('common', 'greeting')?.entry['es']).toBe('Hola {name}');
    });

    it('auto-fixes placeholders that differ from the stored base value and reports the fix', () => {
      seed('common', { greeting: { source: 'Hello {name}' } });

      const result = importResources(collection, [{ key: 'common.greeting', value: 'Hola {nombre}' }], {
        locale: 'es',
      });

      expect(result.icuAutoFixes).toEqual([
        expect.objectContaining({ key: 'common.greeting', originalValue: 'Hola {nombre}', fixedValue: 'Hola {name}' }),
      ]);
      expect(stored('common', 'greeting')?.entry['es']).toBe('Hola {name}');
    });

    it('fails invalid keys and skips empty values without stopping the run', () => {
      seed('common', { ok: { source: 'OK' } });

      const result = importResources(
        collection,
        [
          { key: 'invalid key!', value: 'x' },
          { key: 'common.empty', value: '   ' },
          { key: 'common.ok', value: 'Aceptar' },
        ],
        { locale: 'es' },
      );

      expect(result.resourcesFailed).toBe(1);
      expect(result.resourcesSkipped).toBe(1);
      expect(result.resourcesUpdated).toBe(1);
      expect(result.errors).toEqual([expect.stringContaining('Invalid key format: "invalid key!"')]);
      expect(result.warnings).toContain('Empty value skipped: "common.empty"');
    });
  });

  describe('protected terms', () => {
    it('fails an entry whose translation altered a protected term and keeps its siblings', () => {
      seed('common', { brand: { source: 'Open Acme' }, ok: { source: 'OK' } });

      const result = importResources(
        collection,
        [
          { key: 'common.brand', value: 'Abrir Akme' },
          { key: 'common.ok', value: 'Aceptar' },
        ],
        { locale: 'es', protectedTerms: ['Acme'] },
      );

      expect(result.errors).toEqual(['"common.brand" Protected term(s) altered: Acme']);
      expect(result.changes.find((c) => c.key === 'common.brand')).toMatchObject({ type: 'failed' });
      expect(stored('common', 'brand')?.entry['es']).toBeUndefined();
      expect(stored('common', 'ok')?.entry['es']).toBe('Aceptar');
    });
  });

  describe('progress', () => {
    it('reports each resource and the completion when verbose', () => {
      seed('common', { ok: { source: 'OK' } });
      const messages: string[] = [];

      importResources(collection, [{ key: 'common.ok', value: 'Aceptar' }], {
        locale: 'es',
        verbose: true,
        onProgress: (message) => messages.push(message),
      });

      expect(messages).toContain('Processing: common.ok');
      expect(messages.at(-1)).toBe('Import complete: 1 resources imported');
    });
  });
});
