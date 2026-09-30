import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { openCollection } from '../config/open-collection';
import { InvalidFolderPathError } from '../errors/lingo-tracker-error';
import { createFolder } from './create-folder';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'create-folder-address-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

it('resolves a whitespace-only parent to the root Folder Address', () => {
  const config: LingoTrackerConfig = {
    exportFolder: 'dist',
    importFolder: 'import',
    baseLocale: 'en',
    locales: ['en'],
    collections: { main: { translationsFolder: join(root, 'translations') } },
  };
  const collection = openCollection(config, 'main', { cwd: root });

  const result = createFolder(collection, { folderName: 'buttons', parentPath: '  ' });

  expect(result.folderAddress).toBe('buttons');
  expect(result.folderPath).toBe(join(root, 'translations', 'buttons'));
  expect(existsSync(result.folderPath)).toBe(true);
  expect(result.mutations).toEqual([
    { kind: 'add-folder', translationsFolder: collection.translationsFolder, path: 'buttons' },
  ]);
});

it('still rejects a nonempty parent with surrounding whitespace', () => {
  const config: LingoTrackerConfig = {
    exportFolder: 'dist',
    importFolder: 'import',
    baseLocale: 'en',
    locales: ['en'],
    collections: { main: { translationsFolder: join(root, 'translations') } },
  };
  const collection = openCollection(config, 'main', { cwd: root });

  expect(() => createFolder(collection, { folderName: 'buttons', parentPath: ' apps ' })).toThrow(
    InvalidFolderPathError,
  );
  expect(existsSync(join(root, 'translations', 'apps', 'buttons'))).toBe(false);
});
