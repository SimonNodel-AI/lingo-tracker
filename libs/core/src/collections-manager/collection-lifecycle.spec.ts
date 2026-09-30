import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LingoTrackerConfig } from '../config/lingo-tracker-config';
import { CONFIG_FILENAME } from '../constants';
import {
  InvalidCollectionError,
  ParentDirectoryMissingError,
  ProtectedTermsFileNotSetError,
} from '../lib/errors/lingo-tracker-error';
import { seedResources, testCollection } from '../testing/temp-dir.spec-helpers';
import { addCollection } from './add-collection';
import { updateCollection } from './update-collection';

describe('collection lifecycle refused writes', () => {
  let cwd: string;
  const config = (): LingoTrackerConfig => ({
    exportFolder: 'dist/export',
    importFolder: 'dist/import',
    baseLocale: 'en',
    locales: ['en', 'es'],
    collections: { app: { translationsFolder: './i18n', locales: ['en', 'es'] } },
  });

  /** Includes config, both terms lists, all locale resource files, and directory names. */
  const snapshot = (): Record<string, Buffer> => {
    const files: Record<string, Buffer> = {};
    const walk = (directory: string, relative: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          files[`${name}/`] = Buffer.alloc(0);
          walk(path, name);
        } else {
          files[name] = readFileSync(path);
        }
      }
    };
    walk(cwd, '');
    return files;
  };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'lingo-lifecycle-'));
    writeFileSync(join(cwd, CONFIG_FILENAME), JSON.stringify(config()));
    writeFileSync(join(cwd, 'global-terms.json'), '["global"]\n');
    writeFileSync(join(cwd, 'app-terms.json'), '["existing"]\n');
    seedResources(testCollection(join(cwd, 'i18n'), { locales: ['en', 'es'] }), {
      'apps.ok': { source: 'OK', translations: { es: 'Vale' } },
    });
  });

  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it('refuses create with terms and no pointer before writing config or files', () => {
    const before = snapshot();
    expect(() => addCollection('new', { translationsFolder: './new' }, { cwd, protectedTerms: ['Pixel'] })).toThrow(
      ProtectedTermsFileNotSetError,
    );
    expect(snapshot()).toEqual(before);
  });

  it('refuses an added locale with terms and no resulting pointer before seeding', async () => {
    const before = snapshot();
    await expect(
      updateCollection('app', undefined, { locales: ['en', 'es', 'de'] }, { cwd, protectedTerms: ['Pixel'] }),
    ).rejects.toThrow(ProtectedTermsFileNotSetError);
    expect(snapshot()).toEqual(before);
  });

  it('refuses a removed locale with terms and no resulting pointer before purging', async () => {
    const before = snapshot();
    await expect(
      updateCollection('app', undefined, { locales: ['en'] }, { cwd, protectedTerms: ['Pixel'] }),
    ).rejects.toThrow(ProtectedTermsFileNotSetError);
    expect(snapshot()).toEqual(before);
  });

  it('refuses terms when the same patch clears the stored pointer', async () => {
    const withPointer = config();
    withPointer.collections['app'].protectedTermsFile = 'app-terms.json';
    writeFileSync(join(cwd, CONFIG_FILENAME), JSON.stringify(withPointer));
    const before = snapshot();
    await expect(
      updateCollection('app', undefined, { protectedTermsFile: '' }, { cwd, protectedTerms: ['Pixel'] }),
    ).rejects.toThrow(ProtectedTermsFileNotSetError);
    expect(snapshot()).toEqual(before);
  });

  it('refuses a missing terms parent before writing config or files', () => {
    const before = snapshot();
    expect(() =>
      addCollection(
        'new',
        { translationsFolder: './new', protectedTermsFile: 'missing/terms.json' },
        { cwd, protectedTerms: ['Pixel'] },
      ),
    ).toThrow(ParentDirectoryMissingError);
    expect(snapshot()).toEqual(before);
  });

  it('refuses a renamed update with a missing terms parent before seeding or writing', async () => {
    const before = snapshot();
    await expect(
      updateCollection(
        'app',
        'renamed',
        { protectedTermsFile: 'missing/terms.json', locales: ['en', 'es', 'de'] },
        { cwd, protectedTerms: ['Pixel'] },
      ),
    ).rejects.toThrow(ParentDirectoryMissingError);
    expect(snapshot()).toEqual(before);
  });

  it('checks malformed terms before a duplicate name', () => {
    const before = snapshot();
    expect(() =>
      addCollection(
        'app',
        { translationsFolder: './other' },
        { cwd, protectedTerms: ['valid', 42] as unknown as string[] },
      ),
    ).toThrow(InvalidCollectionError);
    expect(snapshot()).toEqual(before);
  });

  it('checks malformed terms before an unknown update target', async () => {
    const before = snapshot();
    await expect(
      updateCollection('unknown', undefined, {}, { cwd, protectedTerms: ['valid', 42] as unknown as string[] }),
    ).rejects.toThrow(InvalidCollectionError);
    expect(snapshot()).toEqual(before);
  });
});
