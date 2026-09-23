import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { type Collection, openCollection } from '../config/open-collection';
import { openResourceFolder } from '../resource/resource-folder';
import * as jsonExporter from './export-to-json';
import { exportTargetLocales, runExport } from './run-export';

vi.mock('./export-to-json', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./export-to-json')>();
  return { ...actual, exportToJson: vi.fn(actual.exportToJson) };
});

describe('runExport', () => {
  let projectDir: string;
  let outputDirectory: string;

  const config: LingoTrackerConfig = {
    exportFolder: 'dist/export',
    importFolder: 'dist/import',
    baseLocale: 'en',
    locales: ['en', 'fr', 'es'],
    collections: {
      common: { translationsFolder: 'translations/common', tags: ['shared'] },
      admin: { translationsFolder: 'translations/admin', locales: ['en', 'fr', 'de'] },
      french: { translationsFolder: 'translations/french', baseLocale: 'fr', locales: ['fr', 'en'] },
      frOnly: { translationsFolder: 'translations/fr-only', locales: ['en', 'fr'] },
      deOnly: { translationsFolder: 'translations/de-only', locales: ['en', 'de'] },
    },
  };

  const open = (name: string): Collection => openCollection(config, name, { cwd: projectDir });

  /** Seeds one folder of a collection; `status` applies to every translation given. */
  const seed = (
    collection: Collection,
    folder: string,
    entries: Record<string, { source: string; translations?: Record<string, string>; tags?: string[] }>,
    status: 'translated' | 'verified' = 'translated',
  ): void => {
    const resourceFolder = openResourceFolder(join(collection.translationsFolder, folder), {
      baseLocale: collection.baseLocale,
    });
    for (const [key, { source, translations = {}, tags }] of Object.entries(entries)) {
      resourceFolder.setBase(key, source);
      if (tags) resourceFolder.setDetails(key, { tags });
      for (const [locale, value] of Object.entries(translations)) {
        resourceFolder.setTranslation(key, locale, value, status);
      }
    }
    resourceFolder.save();
  };

  const readJson = (file: string): unknown => JSON.parse(readFileSync(join(outputDirectory, file), 'utf8'));

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'lingo-run-export-'));
    outputDirectory = join(projectDir, 'out');
    mkdirSync(outputDirectory);
    vi.mocked(jsonExporter.exportToJson).mockClear();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe('exportTargetLocales', () => {
    it("lists every collection's target locales once, in order, never a base locale", () => {
      expect(exportTargetLocales([open('common'), open('admin')])).toEqual(['fr', 'es', 'de']);
      expect(exportTargetLocales([open('french')])).toEqual(['en']);
    });

    it('narrows to the requested locales and ignores unknown or base ones', () => {
      expect(exportTargetLocales([open('common')], ['es', 'en', 'xx'])).toEqual(['es']);
    });
  });

  it('writes one file per target locale and totals the run', async () => {
    const common = open('common');
    seed(common, 'buttons', { ok: { source: 'OK', translations: { fr: "D'accord" } }, cancel: { source: 'Cancel' } });

    const result = await runExport([common], { format: 'json', outputDirectory, jsonStructure: 'flat' });

    expect(result.locales).toEqual(['fr', 'es']);
    expect(result.collections).toEqual(['common']);
    expect(result.filesCreated).toEqual(['fr.json', 'es.json']);
    expect(result.resourcesExported).toBe(4);
    expect(result.errors).toEqual([]);
    expect(result.localeResults).toEqual([
      { locale: 'fr', outcome: 'exported', resourcesExported: 2, filesCreated: ['fr.json'] },
      { locale: 'es', outcome: 'exported', resourcesExported: 2, filesCreated: ['es.json'] },
    ]);
    expect(readJson('fr.json')).toEqual({ 'buttons.ok': "D'accord", 'buttons.cancel': '' });
    expect(result.summary).toContain('# Export Summary');
    expect(result.summary).toContain('**Resources Exported**: 4');
    expect(result.summary).toContain('**Target Locales**: fr, es');
  });

  it('filters by status and by effective tags (collection tags are inherited)', async () => {
    const common = open('common');
    const admin = open('admin');
    seed(common, 'a', { done: { source: 'Done', translations: { fr: 'Fait' } } }, 'verified');
    seed(common, 'a', { todo: { source: 'To do' } });
    seed(admin, 'b', { other: { source: 'Other' }, tagged: { source: 'Tagged', tags: ['shared'] } });

    const result = await runExport([common, admin], {
      format: 'json',
      outputDirectory,
      jsonStructure: 'flat',
      locales: ['fr'],
      status: ['new', 'stale'],
      tags: ['shared'],
    });

    expect(result.resourcesExported).toBe(2);
    expect(readJson('fr.json')).toEqual({ 'a.todo': '', 'b.tagged': '' });
  });

  it('exports a collection only for its own target locales', async () => {
    const common = open('common');
    const admin = open('admin');
    seed(common, 'c', { hello: { source: 'Hello' } });
    seed(admin, 'd', { bye: { source: 'Bye' } });

    const result = await runExport([common, admin], { format: 'json', outputDirectory, jsonStructure: 'flat' });

    expect(result.locales).toEqual(['fr', 'es', 'de']);
    expect(readJson('fr.json')).toEqual({ 'c.hello': '', 'd.bye': '' });
    expect(readJson('es.json')).toEqual({ 'c.hello': '' });
    expect(readJson('de.json')).toEqual({ 'd.bye': '' });
  });

  it("keeps a key shared by two collections in each collection's own locales", async () => {
    const frOnly = open('frOnly');
    const deOnly = open('deOnly');
    seed(frOnly, 'common', { ok: { source: 'OK', translations: { fr: "D'accord" } } });
    seed(deOnly, 'common', { ok: { source: 'Okay', translations: { de: 'In Ordnung' } } });

    const result = await runExport([frOnly, deOnly], { format: 'json', outputDirectory, jsonStructure: 'flat' });

    expect(result.locales).toEqual(['fr', 'de']);
    expect(readJson('fr.json')).toEqual({ 'common.ok': "D'accord" });
    expect(readJson('de.json')).toEqual({ 'common.ok': 'In Ordnung' });
  });

  it('skips a locale with no matching resource and says so through onProgress', async () => {
    const common = open('common');
    seed(common, 'e', { ok: { source: 'OK', translations: { fr: 'OK' } } }, 'verified');
    const messages: string[] = [];

    const result = await runExport([common], {
      format: 'json',
      outputDirectory,
      status: ['verified'],
      onProgress: (message) => messages.push(message),
    });

    expect(result.localeResults).toEqual([
      { locale: 'fr', outcome: 'exported', resourcesExported: 1, filesCreated: ['fr.json'] },
      { locale: 'es', outcome: 'skipped', resourcesExported: 0, filesCreated: [] },
    ]);
    expect(messages).toContain('Skipping es: No matching resources.');
    expect(existsSync(join(outputDirectory, 'es.json'))).toBe(false);
  });

  it('writes nothing in a dry run but reports the files it would create', async () => {
    const common = open('common');
    seed(common, 'f', { ok: { source: 'OK' } });

    const result = await runExport([common], { format: 'json', outputDirectory, dryRun: true });

    expect(result.filesCreated).toEqual(['fr.json', 'es.json']);
    expect(existsSync(join(outputDirectory, 'fr.json'))).toBe(false);
    expect(result.summary).toContain('# Export Summary (DRY RUN)');
  });

  it('writes XLIFF with the base locale as source language and do-not-translate notes', async () => {
    const common = open('common');
    seed(common, 'g', { brand: { source: 'Open Acme' } });

    const result = await runExport([common], {
      format: 'xliff',
      outputDirectory,
      locales: ['fr'],
      protectedTerms: { global: ['Acme'] },
    });

    expect(result.filesCreated).toEqual(['fr.xliff']);
    const xliff = readFileSync(join(outputDirectory, 'fr.xliff'), 'utf8');
    expect(xliff).toContain('source-language="en"');
    expect(xliff).toContain('target-language="fr"');
    expect(xliff).toContain('Do not translate: Acme');
  });

  it("uses each collection's own protected terms, and none when augmentation is off", async () => {
    const common = open('common');
    seed(common, 'h', { brand: { source: 'Try Widget' } });
    const options = {
      format: 'json' as const,
      outputDirectory,
      locales: ['fr'],
      jsonStructure: 'flat' as const,
      richJson: true,
      protectedTerms: { collections: { common: ['Widget'] } },
    };

    await runExport([common], options);
    expect(readJson('fr.json')).toEqual({ 'h.brand': { value: '', doNotTranslate: ['Widget'] } });

    await runExport([common], { ...options, augmentProtectedTerms: false });
    expect(readJson('fr.json')).toEqual({ 'h.brand': { value: '' } });
  });

  it('reports hierarchical key conflicts separately from errors', async () => {
    const common = open('common');
    seed(common, '', { parent: { source: 'Parent' } });
    seed(common, 'parent', { child: { source: 'Child' } });

    const result = await runExport([common], { format: 'json', outputDirectory, locales: ['fr'] });

    expect(result.errors).toEqual([]);
    expect(result.hierarchicalConflicts).toHaveLength(1);
    expect(result.hierarchicalConflicts[0]).toContain('[fr]');
    expect(result.summary).toContain('### Hierarchical Key Conflicts');
  });

  it('records a locale whose exporter throws and continues with the next locale', async () => {
    const common = open('common');
    seed(common, 'i', { ok: { source: 'OK' } });
    vi.mocked(jsonExporter.exportToJson).mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    const result = await runExport([common], { format: 'json', outputDirectory });

    expect(result.localeResults[0]).toEqual({
      locale: 'fr',
      outcome: 'failed',
      resourcesExported: 0,
      filesCreated: [],
      error: 'disk full',
    });
    expect(result.localeResults[1]).toMatchObject({ locale: 'es', outcome: 'exported' });
    expect(result.errors).toEqual(['Export for locale fr failed: disk full']);
    expect(jsonExporter.exportToJson).toHaveBeenCalledTimes(2);
  });

  it("totals each exporter's omitted resources and malformed files", async () => {
    const common = open('common');
    seed(common, 'k', { ok: { source: 'OK' } });
    vi.mocked(jsonExporter.exportToJson).mockImplementationOnce((_resources, options) => ({
      format: 'json',
      filesCreated: ['fr.json'],
      resourcesExported: 1,
      warnings: [],
      errors: [],
      collections: ['common'],
      locales: options.locales ?? [],
      outputDirectory,
      omittedResources: ['k.missing'],
      malformedFiles: ['k/resource_entries.json'],
      hierarchicalConflicts: [],
    }));

    const result = await runExport([common], { format: 'json', outputDirectory, locales: ['fr'] });

    expect(result.omittedResources).toEqual(['k.missing']);
    expect(result.malformedFiles).toEqual(['k/resource_entries.json']);
  });

  it('passes each locale and the shared base locale to the exporter', async () => {
    const common = open('common');
    seed(common, 'j', { ok: { source: 'OK' } });

    await runExport([common], { format: 'json', outputDirectory, filenamePattern: 'strings-{locale}' });

    expect(jsonExporter.exportToJson).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ locales: ['fr'], collections: ['common'], filenamePattern: 'strings-{locale}' }),
      'en',
    );
    expect(existsSync(join(outputDirectory, 'strings-fr.json'))).toBe(true);
  });

  it('refuses collections with different base locales', async () => {
    await expect(runExport([open('common'), open('french')], { format: 'json', outputDirectory })).rejects.toThrow(
      'Cannot export collections with different base locales together (common: en, french: fr)',
    );
  });

  it('refuses collections with different base locales even when no target locale is left', async () => {
    await expect(
      runExport([open('common'), open('french')], { format: 'json', outputDirectory, locales: ['unknown'] }),
    ).rejects.toThrow('Cannot export collections with different base locales together');
  });

  it('does nothing when no target locale is left', async () => {
    const result = await runExport([open('common')], { format: 'json', outputDirectory, locales: ['en'] });

    expect(result.locales).toEqual([]);
    expect(result.localeResults).toEqual([]);
    expect(jsonExporter.exportToJson).not.toHaveBeenCalled();
  });
});
