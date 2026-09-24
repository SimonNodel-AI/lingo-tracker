import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateChecksum } from '../../resource/checksum';
import { type Collection, openCollection } from '../config/open-collection';
import { openResourceFolder } from '../resource/resource-folder';
import { importResources } from './import-resources';
import { parseJsonImport } from './parse-json-import';
import { parseXliffImport } from './parse-xliff-import';

const xliff = (units: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
<file source-language="en" target-language="es" datatype="plaintext" original="messages"><body>${units}</body></file>
</xliff>`;

describe('importResources pipeline', () => {
  let dir: string;
  let collection: Collection;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lingo-import-pipeline-'));
    collection = openCollection(
      {
        baseLocale: 'en',
        locales: ['en', 'es'],
        exportFolder: 'dist/export',
        importFolder: 'dist/import',
        collections: { main: { translationsFolder: 'translations' } },
      },
      'main',
      { cwd: dir },
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const source = (name: string, content: string): string => {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  };
  const folder = (key: string) =>
    openResourceFolder(join(collection.translationsFolder, ...key.split('.')), { baseLocale: 'en' });
  const seed = (
    folderKey: string,
    entries: Record<string, { source: string; es?: string; status?: 'translated' | 'verified' }>,
  ): void => {
    const resourceFolder = folder(folderKey);
    for (const [key, value] of Object.entries(entries)) {
      resourceFolder.setBase(key, value.source);
      if (value.es !== undefined) resourceFolder.setTranslation(key, 'es', value.es, value.status ?? 'translated');
    }
    resourceFolder.save();
  };

  it('imports a flat JSON file and recalculates real checksums', () => {
    seed('common.buttons', { ok: { source: 'OK', es: 'Bien' }, cancel: { source: 'Cancel' } });
    const path = source(
      'es.json',
      JSON.stringify({ 'common.buttons.ok': 'Aceptar', 'common.buttons.cancel': 'Cancelar' }),
    );
    const result = importResources(collection, parseJsonImport(path), { locale: 'es' });
    expect(result.resourcesUpdated).toBe(2);
    expect(folder('common.buttons').get('ok')?.meta?.['es']).toMatchObject({
      checksum: calculateChecksum('Aceptar'),
      baseChecksum: calculateChecksum('OK'),
    });
  });

  it('imports hierarchical and deeply nested JSON files', () => {
    seed('common.buttons', { ok: { source: 'OK' } });
    seed('level.one.two', { deep: { source: 'Deep' } });
    const path = source(
      'es.json',
      JSON.stringify({ common: { buttons: { ok: 'Aceptar' } }, level: { one: { two: { deep: 'Profundo' } } } }),
    );
    expect(importResources(collection, parseJsonImport(path), { locale: 'es' }).resourcesUpdated).toBe(2);
    expect(folder('level.one.two').get('deep')?.entry['es']).toBe('Profundo');
  });

  it('skips missing resources with the default strategy', () => {
    const result = importResources(collection, [{ key: 'common.missing', value: 'Falta' }], { locale: 'es' });
    expect(result.changes[0]).toMatchObject({
      type: 'skipped',
      reason: expect.stringContaining('does not allow creation'),
    });
  });

  it('creates multiple resources and folders during migration', () => {
    const result = importResources(
      collection,
      [
        { key: 'common.one', value: 'Uno', baseValue: 'One' },
        { key: 'new.deep.two', value: 'Dos', baseValue: 'Two' },
      ],
      { locale: 'es', strategy: 'migration' },
    );
    expect(result.resourcesCreated).toBe(2);
    expect(existsSync(join(collection.translationsFolder, 'new', 'deep', 'resource_entries.json'))).toBe(true);
  });

  it('fails creation without a baseValue and continues valid siblings', () => {
    seed('common', { ok: { source: 'OK' } });
    const result = importResources(
      collection,
      [
        { key: 'new.missing', value: 'Falta' },
        { key: 'common.ok', value: 'Aceptar' },
      ],
      { locale: 'es', strategy: 'migration' },
    );
    expect(result.resourcesFailed).toBe(1);
    expect(result.resourcesUpdated).toBe(1);
  });

  it('detects duplicates, conflicts, invalid keys, long keys and empty values together', () => {
    const longKey = `common.${'x'.repeat(260)}`;
    const result = importResources(
      collection,
      [
        { key: 'common.ok', value: 'One', baseValue: 'OK' },
        { key: 'common.ok', value: 'Two', baseValue: 'OK' },
        { key: 'common', value: 'Conflict', baseValue: 'Conflict' },
        { key: 'bad..key', value: 'Bad', baseValue: 'Bad' },
        { key: longKey, value: 'Long', baseValue: 'Long' },
        { key: 'other.empty', value: '   ', baseValue: 'Empty' },
      ],
      { locale: 'es', strategy: 'migration' },
    );

    expect(result.warnings).toContain(
      'Duplicate key in import file: "common.ok" (used last occurrence, appeared 2 times)',
    );
    expect(result.warnings).toContain(`Very long key: "${longKey}" (${longKey.length} characters)`);
    expect(result.warnings).toContain('Empty value skipped: "other.empty"');
    expect(result.errors).toContain('Hierarchical conflict: "common" (has value and child keys)');
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('Invalid key format: "bad..key"')]));
    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'common', type: 'failed' }),
        expect.objectContaining({ key: 'bad..key', type: 'failed' }),
        expect.objectContaining({ key: 'other.empty', type: 'skipped', reason: 'Empty value' }),
      ]),
    );
    // Validation never stops the run: the valid resources are still written (the last duplicate wins).
    expect(folder('common').get('ok')?.entry['es']).toBe('Two');
    expect(folder('common').get(longKey.slice('common.'.length))?.entry['es']).toBe('Long');
  });

  it('warns for a base value mismatch only when validateBase is enabled', () => {
    seed('common', { ok: { source: 'OK' } });
    const resource = [{ key: 'common.ok', value: 'Aceptar', baseValue: 'Okay' }];
    expect(importResources(collection, resource, { locale: 'es', validateBase: true }).warnings.join()).toContain(
      'Base value mismatch',
    );
    expect(importResources(collection, resource, { locale: 'es', validateBase: false }).warnings).toEqual([]);
  });

  it('does not write in dry-run mode', () => {
    seed('common', { ok: { source: 'OK' } });
    const path = join(collection.translationsFolder, 'common', 'resource_entries.json');
    const before = readFileSync(path, 'utf8');
    const result = importResources(collection, [{ key: 'common.ok', value: 'Aceptar' }], {
      locale: 'es',
      dryRun: true,
    });
    expect(result.filesModified).toEqual([]);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('reports adapter and verbose pipeline progress', () => {
    seed('common', { title: { source: 'Title' }, description: { source: 'Description' } });
    const path = source('es.json', JSON.stringify({ 'common.title': 'Título', 'common.description': 'Descripción' }));
    const onProgress = vi.fn();
    const resources = parseJsonImport(path, { onProgress });
    importResources(collection, resources, { locale: 'es', verbose: true, onProgress });
    const messages = onProgress.mock.calls.map(([message]) => message);
    expect(messages).toContain(`Reading JSON file: ${path}`);
    expect(messages).toContain('Processing: common.title');
    expect(messages.at(-1)).toBe('Import complete: 2 resources imported');
  });

  it.each([
    ['translation-service', 'translated'],
    ['verification', 'verified'],
    ['update', 'translated'],
  ] as const)('applies %s status behavior', (strategy, status) => {
    seed('common', { ok: { source: 'OK', es: 'Bien' } });
    const result = importResources(collection, [{ key: 'common.ok', value: 'Aceptar' }], { locale: 'es', strategy });
    expect(result.changes[0]?.newStatus).toBe(status);
  });

  it.each([
    ['changed', 'Aceptar'],
    ['unchanged', 'Bien'],
  ])('preserves a verified status with the update strategy when the value is %s', (_case, value) => {
    seed('common', { ok: { source: 'OK', es: 'Bien', status: 'verified' } });
    const result = importResources(collection, [{ key: 'common.ok', value }], { locale: 'es', strategy: 'update' });
    expect(result.changes[0]?.newStatus).toBe('verified');
    expect(folder('common').get('ok')?.meta?.['es']?.status).toBe('verified');
    expect(folder('common').get('ok')?.entry['es']).toBe(value);
  });

  it('tracks status transitions across updated resources', () => {
    seed('common', { one: { source: 'One', es: 'Uno' }, two: { source: 'Two', es: 'Dos', status: 'verified' } });
    const result = importResources(
      collection,
      [
        { key: 'common.one', value: 'Primero' },
        { key: 'common.two', value: 'Segundo' },
      ],
      { locale: 'es', strategy: 'verification' },
    );
    expect(result.statusTransitions).toEqual(
      expect.arrayContaining([
        { from: 'translated', to: 'verified', count: 1 },
        { from: 'verified', to: 'verified', count: 1 },
      ]),
    );
  });

  it('resolves simple, t() and nested Transloco references during migration', () => {
    seed('common', { one: { source: 'One' }, two: { source: 'Two' }, three: { source: 'Three' } });
    importResources(
      collection,
      [
        { key: 'common.one', value: 'Uno' },
        { key: 'common.two', value: '{{common.one}} dos' },
        { key: 'common.three', value: "{{t('common.two')}} tres" },
      ],
      { locale: 'es', strategy: 'migration' },
    );
    expect(folder('common').get('three')?.entry['es']).toBe('Uno dos tres');
  });

  it('warns for circular and missing references and keeps them as placeholders', () => {
    seed('common', { one: { source: 'One' }, two: { source: 'Two' }, missing: { source: 'Missing' } });
    const result = importResources(
      collection,
      [
        { key: 'common.one', value: '{{common.two}}' },
        { key: 'common.two', value: '{{common.one}}' },
        { key: 'common.missing', value: 'Hello {{unknown}} World' },
      ],
      { locale: 'es', strategy: 'migration' },
    );

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Circular reference'),
        'Missing reference target: "unknown" - preserving literal',
      ]),
    );
    // The unresolved references survive; Transloco-to-ICU normalization then turns them into ICU placeholders.
    expect(folder('common').get('one')?.entry['es']).toBe('{common.two}');
    expect(folder('common').get('missing')?.entry['es']).toBe('Hello {unknown} World');
  });

  it('does not resolve references outside migration', () => {
    seed('common', { one: { source: 'One' }, two: { source: 'Two' } });
    importResources(
      collection,
      [
        { key: 'common.one', value: 'Uno' },
        { key: 'common.two', value: '{{common.one}}' },
      ],
      { locale: 'es' },
    );
    // Reference resolution is migration-only, but shared Transloco-to-ICU normalization still applies.
    expect(folder('common').get('two')?.entry['es']).toBe('{common.one}');
  });

  it('normalizes Transloco interpolation when creating and updating JSON resources', () => {
    seed('common', { existing: { source: 'Hello {name}' } });
    importResources(
      collection,
      [
        { key: 'common.existing', value: 'Hola {{ name }}' },
        { key: 'common.new', value: 'Adiós {{name}}', baseValue: 'Bye {name}' },
      ],
      { locale: 'es', strategy: 'migration' },
    );
    expect(folder('common').get('existing')?.entry['es']).toBe('Hola {name}');
    expect(folder('common').get('new')?.entry['es']).toBe('Adiós {name}');
  });

  it('imports XLIFF, validates its base value and updates comments', async () => {
    seed('common', { ok: { source: 'OK' } });
    const path = source(
      'es.xliff',
      xliff('<trans-unit id="common.ok"><source>Okay</source><target>Aceptar</target><note>Button</note></trans-unit>'),
    );
    const result = importResources(collection, await parseXliffImport(path), {
      locale: 'es',
      validateBase: true,
      updateComments: true,
    });
    expect(result.warnings.join()).toContain('Base value mismatch');
    expect(folder('common').get('ok')?.entry).toMatchObject({ es: 'Aceptar', comment: 'Button' });
  });

  it('creates resources from XLIFF in migration and applies shared normalization', async () => {
    const path = source(
      'es.xliff',
      xliff(
        '<trans-unit id="common.greeting"><source>Hello {name}</source><target>Hola {{ name }}</target></trans-unit>',
      ),
    );
    const result = importResources(collection, await parseXliffImport(path), { locale: 'es', strategy: 'migration' });
    expect(result.resourcesCreated).toBe(1);
    expect(folder('common').get('greeting')?.entry['es']).toBe('Hola {name}');
  });

  it('uses verification strategy for XLIFF updates', async () => {
    seed('common', { ok: { source: 'OK', es: 'Bien' } });
    const path = source(
      'es.xliff',
      xliff('<trans-unit id="common.ok"><source>OK</source><target>Aceptar</target></trans-unit>'),
    );
    const result = importResources(collection, await parseXliffImport(path), {
      locale: 'es',
      strategy: 'verification',
    });
    expect(result.changes[0]?.newStatus).toBe('verified');
  });

  it('refuses JSON and XLIFF resources imported into the base locale without migration', async () => {
    const json = parseJsonImport(source('en.json', JSON.stringify({ 'common.ok': 'OK' })));
    const xlf = await parseXliffImport(
      source('en.xliff', xliff('<trans-unit id="common.ok"><source>OK</source><target>OK</target></trans-unit>')),
    );
    expect(() => importResources(collection, json, { locale: 'en' })).toThrow('Cannot import into base locale');
    expect(() => importResources(collection, xlf, { locale: 'en' })).toThrow('Cannot import into base locale');
  });
});
