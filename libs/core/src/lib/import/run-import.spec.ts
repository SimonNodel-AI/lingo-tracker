import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedResources, useTempDir } from '../../testing/temp-dir.spec-helpers';
import { type Collection, openCollection } from '../config/open-collection';
import { ImportSourceError, InvalidImportLocaleError } from '../errors/internal';
import { runImport } from './run-import';
import { summarizeImportRuns } from './summarize-import-runs';

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

  it('defines imported as created plus updated for creates-only, updates-only and mixed runs', async () => {
    for (const dryRun of [true, false]) {
      for (const [created, updated] of [
        [2, 0],
        [0, 2],
        [1, 1],
      ]) {
        const prefix = `counts${dryRun}${created}`;
        const resources = Object.fromEntries(
          Array.from({ length: created + updated }, (_, index) => [`${prefix}.key${index}`, `Value ${index}`]),
        );
        seedResources(
          collection,
          Object.fromEntries(
            Object.keys(resources)
              .slice(created)
              .map((key) => [key, { source: 'Old' }]),
          ),
        );
        writeFileSync(join(directory, 'counts.json'), JSON.stringify(resources));
        const run = await runImport(collection, {
          source: 'counts.json',
          cwd: directory,
          locale: 'en',
          strategy: 'migration',
          dryRun,
        });
        expect(run.result).toMatchObject({
          resourcesCreated: created,
          resourcesUpdated: updated,
          resourcesImported: 2,
        });
        expect(run.summary()).toContain(`**Resources ${dryRun ? 'Would Be ' : ''}Imported**: 2`);
        expect(run.outcome).toBe('succeeded');
      }
    }
  });

  it('totals runs in source order and preserves the core outcome in dry runs', async () => {
    expect(summarizeImportRuns([])).toEqual({
      totals: { entries: 0, imported: 0, created: 0, updated: 0, skipped: 0, failed: 0, changed: 0 },
      outcome: 'succeeded',
    });
    seedResources(collection, { 'common.ok': { source: 'OK' } });
    writeFileSync(join(directory, 'counts.json'), JSON.stringify({ 'common.ok': 'Okay', 'common.new': 'New' }));
    const options = {
      source: 'counts.json',
      cwd: directory,
      locale: 'en',
      strategy: 'migration',
      dryRun: true,
    } as const;
    const first = await runImport(collection, options);
    const second = await runImport(collection, options);
    writeFileSync(join(directory, 'counts.json'), JSON.stringify({ 'bad key': 'Bad', empty: '' }));
    const failed = await runImport(collection, options);
    const summary = summarizeImportRuns([first, second, failed]);
    expect(summary).toEqual({
      totals: {
        entries: 6,
        imported: 4,
        created: 2,
        updated: 2,
        skipped: 1,
        failed: 1,
        changed: new Set(first.result.filesAffected).size + new Set(second.result.filesAffected).size,
      },
      outcome: 'failed',
    });
    expect(summarizeImportRuns([first, second]).outcome).toBe('succeeded');
    expect(summarizeImportRuns([{ ...first, outcome: 'failed' }]).outcome).toBe('failed');
    expect(summarizeImportRuns([{ ...failed, outcome: 'succeeded' }]).outcome).toBe('succeeded');
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
  it('reports parsed entries before validation, including failed and skipped entries', async () => {
    writeFileSync(join(directory, 'counts.json'), JSON.stringify({ 'common.ok': 'OK', 'bad@key': 'Bad', empty: '' }));
    const run = await runImport(collection, {
      source: 'counts.json',
      cwd: directory,
      locale: 'en',
      strategy: 'migration',
      dryRun: true,
    });
    expect(run.entriesParsed).toBe(3);
    expect(run.result.resourcesFailed).toBeGreaterThan(0);
    noWrites();
  });
});
