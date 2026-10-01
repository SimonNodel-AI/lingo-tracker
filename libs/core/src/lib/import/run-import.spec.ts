import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openCollection, type Collection } from '../config/open-collection';
import { ImportSourceError, InvalidImportLocaleError } from '../errors';
import { seedResources, useTempDir } from '../../testing/temp-dir.spec-helpers';
import { runImport } from './run-import';

describe('runImport', () => {
  const root = useTempDir('run-import-');
  let directory: string;
  let collection: Collection;

  beforeEach(() => {
    directory = root();
    collection = openCollection(
      {
        baseLocale: 'en',
        locales: ['en', 'es'],
        exportFolder: 'dist/export',
        importFolder: 'dist/import',
        collections: { main: { translationsFolder: 'translations' } },
      },
      'main',
      { cwd: directory },
    );
  });

  const noWrites = (): void => {
    expect(existsSync(collection.translationsFolder)).toBe(false);
  };

  it('detects JSON and imports its resources with a summary', async () => {
    writeFileSync(join(directory, 'source.json'), JSON.stringify({ 'common.ok': 'Okay' }));
    const run = await runImport(collection, {
      source: 'source.json',
      cwd: directory,
      locale: 'en',
      strategy: 'migration',
    });
    expect(run.format).toBe('json');
    expect(run.outcome).toBe('succeeded');
    expect(run.result.resourcesCreated).toBe(1);
    expect(run.summary()).toContain('**Source File**: source.json');
    expect(readdirSync(collection.translationsFolder)).toContain('common');
  });

  it('detects XLIFF and imports its resources', async () => {
    writeFileSync(
      join(directory, 'source.xlf'),
      '<?xml version="1.0"?><xliff version="1.2"><file source-language="en" target-language="es" datatype="plaintext" original="main"><body><trans-unit id="common.ok"><source>OK</source><target>Bien</target></trans-unit></body></file></xliff>',
    );
    const run = await runImport(collection, {
      source: 'source.xlf',
      cwd: directory,
      locale: 'es',
      strategy: 'migration',
    });
    expect(run.format).toBe('xliff');
    expect(run.result.resourcesCreated).toBe(1);
    expect(run.summary()).toContain('**Format**: XLIFF');
  });

  it('honors an explicit format without relying on the extension', async () => {
    writeFileSync(join(directory, 'source.data'), JSON.stringify({ 'common.ok': 'Okay' }));
    const run = await runImport(collection, {
      source: 'source.data',
      cwd: directory,
      format: 'json',
      locale: 'en',
      strategy: 'migration',
      dryRun: true,
    });
    expect(run.format).toBe('json');
    expect(run.outcome).toBe('succeeded');
    noWrites();
  });

  it('emits a large-file warning before the run starts', async () => {
    writeFileSync(
      join(directory, 'large.json'),
      `${JSON.stringify({ 'common.ok': 'Okay' })}${' '.repeat(5 * 1024 * 1024)}`,
    );
    const emitted: string[] = [];
    const run = await runImport(collection, {
      source: 'large.json',
      cwd: directory,
      locale: 'en',
      strategy: 'migration',
      dryRun: true,
      onWarning: ({ message, details }) => emitted.push(message, ...(details ?? [])),
      onStart: () => emitted.push('started'),
    });
    expect(run.format).toBe('json');
    expect(emitted).toEqual(['Large import file detected: 5.00 MB', 'Import may take longer than usual.', 'started']);
    noWrites();
  });

  it('rejects an unreadable source with a typed error before writing', async () => {
    await expect(
      runImport(collection, { source: 'missing.json', cwd: directory, locale: 'es' }),
    ).rejects.toBeInstanceOf(ImportSourceError);
    noWrites();
  });

  it('reports failure in a dry run with or without successful resources', async () => {
    writeFileSync(join(directory, 'failed.json'), JSON.stringify({ 'new.missing': 'Falta' }));
    const failed = await runImport(collection, {
      source: 'failed.json',
      cwd: directory,
      locale: 'es',
      strategy: 'migration',
      dryRun: true,
    });
    expect(failed.result.resourcesFailed).toBe(1);
    expect(failed.outcome).toBe('failed');

    seedResources(collection, { 'common.ok': { source: 'OK' } });
    writeFileSync(join(directory, 'mixed.json'), JSON.stringify({ 'new.missing': 'Falta', 'common.ok': 'Aceptar' }));
    const mixed = await runImport(collection, {
      source: 'mixed.json',
      cwd: directory,
      locale: 'es',
      strategy: 'migration',
      dryRun: true,
    });
    expect(mixed.result.resourcesFailed).toBe(1);
    expect(mixed.result.resourcesImported).toBe(1);
    expect(mixed.outcome).toBe('failed');
  });

  it('rejects an unknown source format with a typed error before writing', async () => {
    writeFileSync(join(directory, 'source.data'), '{}');
    await expect(runImport(collection, { source: 'source.data', cwd: directory, locale: 'es' })).rejects.toMatchObject({
      stage: 'format',
      code: 'IMPORT_SOURCE_ERROR',
    });
    noWrites();
  });

  it('rejects malformed JSON with a typed error before writing', async () => {
    writeFileSync(join(directory, 'broken.json'), '{');
    await expect(runImport(collection, { source: 'broken.json', cwd: directory, locale: 'es' })).rejects.toBeInstanceOf(
      ImportSourceError,
    );
    noWrites();
  });

  it('rejects malformed XLIFF with a typed error before writing', async () => {
    writeFileSync(join(directory, 'broken.xlf'), 'not XML');
    await expect(runImport(collection, { source: 'broken.xlf', cwd: directory, locale: 'es' })).rejects.toBeInstanceOf(
      ImportSourceError,
    );
    noWrites();
  });

  it('rejects base-locale imports with a typed error before writing', async () => {
    writeFileSync(join(directory, 'source.json'), JSON.stringify({ 'common.ok': 'Okay' }));
    await expect(runImport(collection, { source: 'source.json', cwd: directory, locale: 'en' })).rejects.toBeInstanceOf(
      InvalidImportLocaleError,
    );
    noWrites();
  });
});
