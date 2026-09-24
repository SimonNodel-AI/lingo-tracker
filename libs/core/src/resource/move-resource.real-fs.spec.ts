import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Collection } from '../lib/config/open-collection';
import { moveFolder } from '../lib/folder/move-folder';
import { calculateChecksum } from './checksum';
import { moveResource } from './move-resource';

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
    protectedTermsFiles: { global: '/nonexistent/.lingo-tracker-protected-terms.json', globalExplicit: false },
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

    const result = await moveResource(collection(), { source: 'common.ok', destination: 'shared.buttons.confirm' });

    expect(result).toEqual({
      movedCount: 1,
      warnings: [],
      errors: [],
      mutations: [
        { kind: 'upsert', translationsFolder: root, key: 'shared.buttons.confirm', entry: expect.any(Object) },
        { kind: 'remove', translationsFolder: root, key: 'common.ok' },
      ],
    });
    expect(read('resource_entries.json', 'shared', 'buttons')).toEqual({ confirm: entries.ok });
    expect(read('tracker_meta.json', 'shared', 'buttons')).toEqual({ confirm: meta.ok });
    // Source folder had only this entry, so both files are removed
    expect(existsSync(join(root, 'common', 'resource_entries.json'))).toBe(false);
  });

  it('moveResource by pattern keeps statuses', async () => {
    writeFolder('common', 'buttons');

    await moveResource(collection(), { source: 'common.*', destination: 'shared' });

    expect(read('tracker_meta.json', 'shared', 'buttons').ok.fr.status).toBe('verified');
    expect(read('tracker_meta.json', 'shared', 'buttons').ok.es.status).toBe('stale');
  });

  it('moveResource across collections keeps statuses', async () => {
    writeFolder('common');
    const otherCollection = join(root, 'other');

    await moveResource(collection(), {
      source: 'common.ok',
      destination: 'common.ok',
      destinationCollection: collection(otherCollection, 'other'),
    });

    expect(read('tracker_meta.json', 'other', 'common')).toEqual(meta);
  });

  it('moveFolder keeps statuses', async () => {
    writeFolder('apps', 'buttons');

    const result = await moveFolder(collection(), {
      sourceFolderPath: 'apps.buttons',
      destinationFolderPath: 'shared',
    });

    expect(result.errors).toEqual([]);
    expect(read('resource_entries.json', 'shared', 'buttons')).toEqual(entries);
    expect(read('tracker_meta.json', 'shared', 'buttons')).toEqual(meta);
    expect(existsSync(join(root, 'apps', 'buttons'))).toBe(false);
  });

  it('does not overwrite an existing destination without override', async () => {
    writeFolder('common');
    writeFolder('shared');

    const result = await moveResource(collection(), { source: 'common.ok', destination: 'shared.ok' });

    expect(result.movedCount).toBe(0);
    expect(result.warnings[0]).toContain('Destination key already exists');
    expect(existsSync(join(root, 'common', 'resource_entries.json'))).toBe(true);
  });
});
