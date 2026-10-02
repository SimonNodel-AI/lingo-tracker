import type { ResourceMutation } from './resource-mutation';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import type { Collection } from '../config/open-collection';
import { CollectionNotFoundError, ReadOnlyCollectionError } from '../errors/lingo-tracker-error';
import { writeJsonFile } from '../file-io/json-file-operations';
import { moveFolder } from '../folder/move-folder';
import { calculateChecksum } from './checksum';
import { moveResource } from './move-resource';
import { moveResources } from './move-resources';

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

const md5 = calculateChecksum;

/**
 * Regression: moves used to go through addResource, which rebuilt metadata and marked every
 * carried translation 'translated' — losing 'verified' and 'stale'. Moves are now lossless.
 */
describe('moving resources keeps metadata (real fs)', () => {
  let root: string;

  const collection = (translationsFolder = root, name = 'main'): Collection => ({
    name,
    translationsFolder,
    baseLocale: 'en',
    locales: ['en', 'fr', 'es'],
    targetLocales: ['fr', 'es'],
    translationConfig: undefined,
    tags: [],
    termFiles: {
      protectedTerms: { path: '/nonexistent/.lingo-tracker-protected-terms.json', explicit: false },
      preferredTerminology: { path: '/nonexistent/.lingo-tracker-preferred-terminology.json', explicit: false },
    },
    readOnly: false,
    config: { translationsFolder },
  });

  const entries = { ok: { source: 'OK', comment: 'Button', tags: ['ui'], fr: "D'accord", es: 'Vale' } };
  const meta = {
    ok: {
      en: { checksum: md5('OK') },
      fr: { checksum: md5("D'accord"), baseChecksum: md5('OK'), status: 'verified' },
      es: { checksum: md5('Vale'), baseChecksum: md5('Old OK'), status: 'stale' },
    },
  };

  function writeFolder(...segments: string[]): void {
    const folder = join(root, ...segments);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'resource_entries.json'), JSON.stringify(entries));
    writeFileSync(join(folder, 'tracker_meta.json'), JSON.stringify(meta));
  }

  function read(file: 'resource_entries.json' | 'tracker_meta.json', ...segments: string[]) {
    return JSON.parse(readFileSync(join(root, ...segments, file), 'utf8'));
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'move-resource-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('moveResource carries values, details, checksums, and statuses', async () => {
    writeFolder('common');

    const result = await moveResource(
      collection(),
      { source: 'common.ok', destination: 'shared.buttons.confirm' },
      { onMutation },
    );

    expect(result).toEqual({
      outcome: 'succeeded',
      movedCount: 1,
      warnings: [],
      errors: [],
    });
    expect(collected).toEqual([
      { kind: 'remove', translationsFolder: root, key: 'common.ok' },
      { kind: 'upsert', translationsFolder: root, key: 'shared.buttons.confirm', entry: expect.any(Object) },
    ]);
    expect(read('resource_entries.json', 'shared', 'buttons')).toEqual({ confirm: entries.ok });
    expect(read('tracker_meta.json', 'shared', 'buttons')).toEqual({ confirm: meta.ok });
    // Source folder had only this entry, so both files are removed
    expect(existsSync(join(root, 'common', 'resource_entries.json'))).toBe(false);
  });

  it('moveResource by pattern keeps statuses', async () => {
    writeFolder('common', 'buttons');

    await moveResource(collection(), { source: 'common.*', destination: 'shared' }, { onMutation });

    expect(read('tracker_meta.json', 'shared', 'buttons').ok.fr.status).toBe('verified');
    expect(read('tracker_meta.json', 'shared', 'buttons').ok.es.status).toBe('stale');
  });

  it('moveResource across collections keeps statuses', async () => {
    writeFolder('common');
    const otherCollection = join(root, 'other');

    await moveResource(
      collection(),
      {
        source: 'common.ok',
        destination: 'common.ok',
        toCollection: 'other',
      },
      {
        onMutation,
        config: {
          exportFolder: 'dist',
          importFolder: 'import',
          baseLocale: 'en',
          locales: ['en', 'fr', 'es'],
          collections: { other: { translationsFolder: otherCollection } },
        },
      },
    );

    expect(read('tracker_meta.json', 'other', 'common')).toEqual(meta);
  });

  it('refuses a missing destination before a single resource move writes', async () => {
    writeFolder('common');
    const config: LingoTrackerConfig = {
      exportFolder: 'dist',
      importFolder: 'import',
      baseLocale: 'en',
      locales: ['en', 'fr', 'es'],
      collections: { main: { translationsFolder: root } },
    };
    await expect(
      moveResource(
        collection(),
        { source: 'common.ok', destination: 'shared.ok', toCollection: 'missing' },
        { config, onMutation },
      ),
    ).rejects.toThrow(CollectionNotFoundError);
    expect(collected).toEqual([]);
    expect(read('resource_entries.json', 'common')).toEqual(entries);
  });

  it('refuses a read-only destination before a single resource move writes', async () => {
    writeFolder('common');
    const config: LingoTrackerConfig = {
      exportFolder: 'dist',
      importFolder: 'import',
      baseLocale: 'en',
      locales: ['en', 'fr', 'es'],
      collections: { vendor: { translationsFolder: 'vendor', readOnly: true } },
    };
    await expect(
      moveResource(
        collection(),
        { source: 'common.ok', destination: 'shared.ok', toCollection: 'vendor' },
        { config, cwd: root, onMutation },
      ),
    ).rejects.toThrow(ReadOnlyCollectionError);
    expect(collected).toEqual([]);
    expect(read('resource_entries.json', 'common')).toEqual(entries);
  });

  it('resolves a relative destination using the supplied cwd', async () => {
    writeFolder('common');
    const config: LingoTrackerConfig = {
      exportFolder: 'dist',
      importFolder: 'import',
      baseLocale: 'en',
      locales: ['en', 'fr', 'es'],
      collections: { other: { translationsFolder: 'other' } },
    };
    const result = await moveResource(
      collection(),
      { source: 'common.ok', destination: 'shared.ok', toCollection: 'other' },
      { config, cwd: root, onMutation },
    );
    expect(result.movedCount).toBe(1);
    expect(read('resource_entries.json', 'other', 'shared')).toEqual(entries);
    expect(collected.map(({ translationsFolder }) => translationsFolder)).toEqual([root, join(root, 'other')]);
  });

  it('moveFolder keeps statuses', async () => {
    writeFolder('apps', 'buttons');

    const result = await moveFolder(
      collection(),
      {
        sourceFolderPath: 'apps.buttons',
        destinationFolderPath: 'shared',
      },
      { onMutation },
    );

    expect(result.errors).toEqual([]);
    expect(result.outcome).toBe('succeeded');
    expect(read('resource_entries.json', 'shared', 'buttons')).toEqual(entries);
    expect(read('tracker_meta.json', 'shared', 'buttons')).toEqual(meta);
    expect(existsSync(join(root, 'apps', 'buttons'))).toBe(false);
  });

  it('does not overwrite an existing destination without override', async () => {
    writeFolder('common');
    writeFolder('shared');

    const result = await moveResource(collection(), { source: 'common.ok', destination: 'shared.ok' }, { onMutation });

    expect(result.movedCount).toBe(0);
    expect(result.warnings[0]).toContain('Destination key already exists');
    expect(existsSync(join(root, 'common', 'resource_entries.json'))).toBe(true);
  });

  it('moves a pattern to the collection root with an empty destination', async () => {
    writeFolder('common', 'buttons');

    const result = await moveResource(collection(), { source: 'common.*', destination: '' }, { onMutation });

    expect(result.errors).toEqual([]);
    expect(result.outcome).toBe('succeeded');
    expect(result.movedCount).toBe(1);
    expect(read('resource_entries.json', 'buttons')).toEqual(entries);
    expect(read('tracker_meta.json', 'buttons')).toEqual(meta);
  });

  it('reports a missing destination and still runs later moves', async () => {
    writeFolder('common');
    const config: LingoTrackerConfig = {
      exportFolder: 'dist',
      importFolder: 'import',
      baseLocale: 'en',
      locales: ['en', 'fr', 'es'],
      collections: { main: { translationsFolder: root } },
    };

    const result = await moveResources(
      collection(),
      [
        { source: 'common.ok', destination: 'ignored.ok', toCollection: 'missing' },
        { source: 'common.ok', destination: 'shared.ok' },
      ],
      { onMutation, config },
    );

    expect(result.errors).toEqual(['Destination collection "missing" not found']);
    expect(result.outcome).toBe('failed');
    expect(result.movedCount).toBe(1);
    expect(read('resource_entries.json', 'shared')).toEqual(entries);
    expect(collected.map(({ kind }) => kind)).toEqual(['remove', 'upsert']);
  });

  it('keeps the first move delivered when the second move write fails', async () => {
    writeFolder('common');
    writeFolder('second');
    const config: LingoTrackerConfig = {
      exportFolder: 'dist',
      importFolder: 'import',
      baseLocale: 'en',
      locales: ['en', 'fr', 'es'],
      collections: { main: { translationsFolder: root } },
    };
    const actual = await vi.importActual<typeof import('../file-io/json-file-operations')>(
      '../file-io/json-file-operations',
    );
    const writer = vi.mocked(writeJsonFile);
    writer.mockImplementation((options) => {
      if (options.filePath.endsWith(join('blocked', 'resource_entries.json'))) throw new Error('blocked write');
      return actual.writeJsonFile(options);
    });
    let result: Awaited<ReturnType<typeof moveResources>>;
    try {
      result = await moveResources(
        collection(),
        [
          { source: 'common.ok', destination: 'shared.ok' },
          { source: 'second.ok', destination: 'blocked.ok' },
        ],
        { config, onMutation },
      );
    } finally {
      writer.mockImplementation(actual.writeJsonFile);
    }
    expect(result.errors).toEqual([expect.stringContaining('Failed to write the move')]);
    expect(result.outcome).toBe('failed');
    expect(collected).toEqual([
      { kind: 'remove', translationsFolder: root, key: 'common.ok' },
      expect.objectContaining({ kind: 'upsert', translationsFolder: root, key: 'shared.ok' }),
      { kind: 'reindex', translationsFolder: root },
    ]);
  });

  it('preserves the read-only destination error text', async () => {
    writeFolder('common');
    const config: LingoTrackerConfig = {
      exportFolder: 'dist',
      importFolder: 'import',
      baseLocale: 'en',
      locales: ['en', 'fr', 'es'],
      collections: {
        main: { translationsFolder: root },
        vendor: { translationsFolder: join(root, 'vendor'), readOnly: true },
      },
    };

    const result = await moveResources(
      collection(),
      [{ source: 'common.ok', destination: 'shared.ok', toCollection: 'vendor' }],
      { onMutation, config },
    );

    expect(result.errors).toEqual(['Collection "vendor" is read-only. Its resources cannot be modified.']);
    expect(result.outcome).toBe('failed');
    expect(result.movedCount).toBe(0);
    expect(existsSync(join(root, 'common', 'resource_entries.json'))).toBe(true);
    expect(collected).toEqual([]);
  });

  it('continues a batch after a read-only destination and resolves a later destination with cwd', async () => {
    writeFolder('common');
    const config: LingoTrackerConfig = {
      exportFolder: 'dist',
      importFolder: 'import',
      baseLocale: 'en',
      locales: ['en', 'fr', 'es'],
      collections: {
        vendor: { translationsFolder: 'vendor', readOnly: true },
        other: { translationsFolder: 'other' },
      },
    };
    const result = await moveResources(
      collection(),
      [
        { source: 'common.ok', destination: 'ignored.ok', toCollection: 'vendor' },
        { source: 'common.ok', destination: 'shared.ok', toCollection: 'other' },
      ],
      { config, cwd: root, onMutation },
    );
    expect(result).toEqual({
      outcome: 'failed',
      movedCount: 1,
      warnings: [],
      errors: ['Collection "vendor" is read-only. Its resources cannot be modified.'],
    });
    expect(read('resource_entries.json', 'other', 'shared')).toEqual(entries);
    expect(collected.map(({ translationsFolder }) => translationsFolder)).toEqual([root, join(root, 'other')]);
  });
});
