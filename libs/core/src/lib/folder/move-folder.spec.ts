import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { RESOURCE_ENTRIES_FILENAME, TRACKER_META_FILENAME } from '../../constants';
import type { Collection } from '../config/open-collection';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import {
  FolderMoveIntoDescendantError,
  FolderNotFoundError,
  InvalidFolderPathError,
} from '../errors/lingo-tracker-error';
import { moveFolder } from './move-folder';

function collection(translationsFolder: string, name = 'main'): Collection {
  return {
    name,
    translationsFolder,
    baseLocale: 'en',
    locales: ['en', 'fr'],
    targetLocales: ['fr'],
    translationConfig: undefined,
    tags: [],
    termFiles: {
      protectedTerms: { path: '/nonexistent/.lingo-tracker-protected-terms.json', explicit: false },
      preferredTerminology: { path: '/nonexistent/.lingo-tracker-preferred-terminology.json', explicit: false },
    },
    readOnly: false,
    config: { translationsFolder },
  };
}

const moveConfig = (name: string, translationsFolder: string): LingoTrackerConfig => ({
  exportFolder: 'dist',
  importFolder: 'import',
  baseLocale: 'en',
  locales: ['en', 'fr'],
  collections: { [name]: { translationsFolder } },
});

// Mock node:fs
vi.mock('node:fs', () => {
  return {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    rmdirSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

describe('Move Folder', () => {
  const testDir = resolve('/tmp/test-move-folder');
  let mockFileSystem: Map<string, string>;
  let mockDirectories: Set<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFileSystem = new Map();
    mockDirectories = new Set();

    // Setup default mocks
    (fs.existsSync as Mock).mockImplementation((path: string) => {
      return mockFileSystem.has(path) || mockDirectories.has(path);
    });

    (fs.readFileSync as Mock).mockImplementation((path: string) => {
      if (mockFileSystem.has(path)) {
        return mockFileSystem.get(path);
      }
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    });

    (fs.writeFileSync as Mock).mockImplementation((path: string, data: string) => {
      mockFileSystem.set(path, data);
    });

    (fs.mkdirSync as Mock).mockImplementation((path: string) => {
      mockDirectories.add(path);
    });

    (fs.rmSync as Mock).mockImplementation((path: string) => {
      mockFileSystem.delete(path);
      mockDirectories.delete(path);
      // Also remove children
      for (const key of mockFileSystem.keys()) {
        if (key.startsWith(path)) {
          mockFileSystem.delete(key);
        }
      }
      for (const dir of mockDirectories) {
        if (dir.startsWith(path)) {
          mockDirectories.delete(dir);
        }
      }
    });

    (fs.rmdirSync as Mock).mockImplementation((path: string) => {
      const prefix = `${path}/`;
      const hasChildren =
        [...mockFileSystem.keys()].some((key) => key.startsWith(prefix)) ||
        [...mockDirectories].some((dir) => dir.startsWith(prefix));
      if (hasChildren) {
        throw new Error(`ENOTEMPTY: directory not empty, rmdir '${path}'`);
      }
      mockDirectories.delete(path);
    });

    (fs.unlinkSync as Mock).mockImplementation((path: string) => {
      if (mockFileSystem.has(path)) {
        mockFileSystem.delete(path);
      } else {
        throw new Error(`ENOENT: no such file or directory, unlink '${path}'`);
      }
    });

    (fs.readdirSync as Mock).mockImplementation((path: string, options?: unknown) => {
      const children = new Set<string>();

      // Check files
      for (const file of mockFileSystem.keys()) {
        if (file.startsWith(path) && file !== path) {
          const relative = file.slice(path.length + 1);
          const firstPart = relative.split('/')[0];
          if (firstPart) children.add(firstPart);
        }
      }

      // Check dirs
      for (const dir of mockDirectories) {
        if (dir.startsWith(path) && dir !== path) {
          const relative = dir.slice(path.length + 1);
          const firstPart = relative.split('/')[0];
          if (firstPart) children.add(firstPart);
        }
      }

      const childNames = Array.from(children);

      // Handle withFileTypes option
      if (options && typeof options === 'object' && 'withFileTypes' in options && options.withFileTypes) {
        return childNames.map((name) => {
          const childPath = join(path, name);
          return {
            name,
            isDirectory: () => mockDirectories.has(childPath),
            isFile: () => mockFileSystem.has(childPath),
          };
        });
      }

      return childNames;
    });

    (fs.statSync as Mock).mockImplementation((path: string) => {
      return {
        isDirectory: () => mockDirectories.has(path),
        isFile: () => mockFileSystem.has(path),
      };
    });

    mockDirectories.add(testDir);
  });

  describe('Basic Folder Move', () => {
    it('should move a folder with a single resource', async () => {
      // Setup source folder: apps.common.buttons.ok
      const buttonsFolder = join(testDir, 'apps', 'common', 'buttons');
      mockDirectories.add(join(testDir, 'apps'));
      mockDirectories.add(join(testDir, 'apps', 'common'));
      mockDirectories.add(buttonsFolder);

      const buttonsFile = join(buttonsFolder, RESOURCE_ENTRIES_FILENAME);
      mockFileSystem.set(
        buttonsFile,
        JSON.stringify({
          ok: { source: 'OK', en: 'OK', fr: 'Bien' },
        }),
      );

      const buttonsMetaFile = join(buttonsFolder, TRACKER_META_FILENAME);
      mockFileSystem.set(
        buttonsMetaFile,
        JSON.stringify({
          ok: {
            en: { baseChecksum: 'abc123' },
            fr: { checksum: 'def456', status: 'translated', baseChecksum: 'abc123' },
          },
        }),
      );

      const result = await moveFolder(collection(testDir), {
        sourceFolderPath: 'apps.common.buttons',
        destinationFolderPath: 'apps.shared',
      });

      expect(result.movedCount).toBe(1);
      expect(result.foldersDeleted).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);

      // Verify destination exists: apps.shared.buttons.ok
      const sharedButtonsFolder = join(testDir, 'apps', 'shared', 'buttons');
      const sharedButtonsFile = join(sharedButtonsFolder, RESOURCE_ENTRIES_FILENAME);
      expect(mockFileSystem.has(sharedButtonsFile)).toBe(true);

      const destContent = JSON.parse(mockFileSystem.get(sharedButtonsFile) as string);
      expect(destContent.ok).toBeDefined();
      expect(destContent.ok.source).toBe('OK');
    });

    it('should move a folder with nested subfolders and multiple resources', async () => {
      // Setup: apps.common.buttons (ok, cancel) and apps.common.buttons.sub (item)
      const buttonsFolder = join(testDir, 'apps', 'common', 'buttons');
      mockDirectories.add(join(testDir, 'apps'));
      mockDirectories.add(join(testDir, 'apps', 'common'));
      mockDirectories.add(buttonsFolder);

      const buttonsFile = join(buttonsFolder, RESOURCE_ENTRIES_FILENAME);
      mockFileSystem.set(
        buttonsFile,
        JSON.stringify({
          ok: { source: 'OK' },
          cancel: { source: 'Cancel' },
        }),
      );

      const buttonsMetaFile = join(buttonsFolder, TRACKER_META_FILENAME);
      mockFileSystem.set(
        buttonsMetaFile,
        JSON.stringify({
          ok: { en: { baseChecksum: 'abc1' } },
          cancel: { en: { baseChecksum: 'abc2' } },
        }),
      );

      const subFolder = join(buttonsFolder, 'sub');
      mockDirectories.add(subFolder);
      const subFile = join(subFolder, RESOURCE_ENTRIES_FILENAME);
      mockFileSystem.set(
        subFile,
        JSON.stringify({
          item: { source: 'Item' },
        }),
      );

      const subMetaFile = join(subFolder, TRACKER_META_FILENAME);
      mockFileSystem.set(
        subMetaFile,
        JSON.stringify({
          item: { en: { baseChecksum: 'abc3' } },
        }),
      );

      const result = await moveFolder(collection(testDir), {
        sourceFolderPath: 'apps.common.buttons',
        destinationFolderPath: 'apps.shared',
      });

      expect(result.movedCount).toBe(3);
      expect(result.foldersDeleted).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Verify destination structure: apps.shared.buttons.ok, apps.shared.buttons.cancel, apps.shared.buttons.sub.item
      const sharedButtonsFolder = join(testDir, 'apps', 'shared', 'buttons');
      const sharedButtonsFile = join(sharedButtonsFolder, RESOURCE_ENTRIES_FILENAME);
      expect(mockFileSystem.has(sharedButtonsFile)).toBe(true);

      const buttonsContent = JSON.parse(mockFileSystem.get(sharedButtonsFile) as string);
      expect(buttonsContent.ok).toBeDefined();
      expect(buttonsContent.cancel).toBeDefined();

      const sharedSubFolder = join(sharedButtonsFolder, 'sub');
      const sharedSubFile = join(sharedSubFolder, RESOURCE_ENTRIES_FILENAME);
      expect(mockFileSystem.has(sharedSubFile)).toBe(true);

      const subContent = JSON.parse(mockFileSystem.get(sharedSubFile) as string);
      expect(subContent.item).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty folder (no resources)', async () => {
      const emptyFolder = join(testDir, 'apps', 'empty');
      mockDirectories.add(join(testDir, 'apps'));
      mockDirectories.add(emptyFolder);

      const result = await moveFolder(collection(testDir), {
        sourceFolderPath: 'apps.empty',
        destinationFolderPath: 'apps.shared',
      });

      expect(result.movedCount).toBe(0);
      expect(result.foldersDeleted).toBe(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('No resources found');
    });

    it('should throw for non-existent source folder', async () => {
      await expect(
        moveFolder(collection(testDir), {
          sourceFolderPath: 'apps.nonexistent',
          destinationFolderPath: 'apps.shared',
        }),
      ).rejects.toThrow(FolderNotFoundError);
      expect(mockDirectories.has(join(testDir, 'apps', 'nonexistent'))).toBe(false);
    });

    it('should throw when source is not a directory', async () => {
      // Create a file instead of directory
      const filePath = join(testDir, 'apps', 'notadir');
      mockDirectories.add(join(testDir, 'apps'));
      mockFileSystem.set(filePath, 'some content');

      await expect(
        moveFolder(collection(testDir), {
          sourceFolderPath: 'apps.notadir',
          destinationFolderPath: 'apps.shared',
        }),
      ).rejects.toThrow(FolderNotFoundError);
      expect(mockFileSystem.get(filePath)).toBe('some content');
    });
  });

  describe('Circular Dependency Prevention', () => {
    it('should prevent moving folder into its own descendant', async () => {
      const commonFolder = join(testDir, 'apps', 'common');
      mockDirectories.add(join(testDir, 'apps'));
      mockDirectories.add(commonFolder);

      const buttonsFolder = join(commonFolder, 'buttons');
      mockDirectories.add(buttonsFolder);

      await expect(
        moveFolder(collection(testDir), {
          sourceFolderPath: 'apps.common',
          destinationFolderPath: 'apps.common.buttons',
        }),
      ).rejects.toThrow(FolderMoveIntoDescendantError);
      expect(mockDirectories.has(commonFolder)).toBe(true);
    });

    it('should prevent moving folder into deeply nested descendant', async () => {
      const commonFolder = join(testDir, 'apps', 'common');
      mockDirectories.add(join(testDir, 'apps'));
      mockDirectories.add(commonFolder);

      await expect(
        moveFolder(collection(testDir), {
          sourceFolderPath: 'apps.common',
          destinationFolderPath: 'apps.common.buttons.nested.deep',
        }),
      ).rejects.toThrow(FolderMoveIntoDescendantError);
      expect(mockDirectories.has(commonFolder)).toBe(true);
    });

    it('should allow moving to sibling folder', async () => {
      // Setup apps.buttons with one resource
      const buttonsFolder = join(testDir, 'apps', 'buttons');
      mockDirectories.add(join(testDir, 'apps'));
      mockDirectories.add(buttonsFolder);

      const buttonsFile = join(buttonsFolder, RESOURCE_ENTRIES_FILENAME);
      mockFileSystem.set(
        buttonsFile,
        JSON.stringify({
          ok: { source: 'OK' },
        }),
      );

      const buttonsMetaFile = join(buttonsFolder, TRACKER_META_FILENAME);
      mockFileSystem.set(
        buttonsMetaFile,
        JSON.stringify({
          ok: { en: { baseChecksum: 'abc1' } },
        }),
      );

      // Move to sibling: apps.actions
      // With new default (nestUnderDestination: true), creates apps.actions.buttons.ok
      const result = await moveFolder(collection(testDir), {
        sourceFolderPath: 'apps.buttons',
        destinationFolderPath: 'apps.actions',
      });

      expect(result.movedCount).toBe(1);
      expect(result.foldersDeleted).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Verify destination: apps.actions.buttons.ok (new default behavior)
      const actionsButtonsFolder = join(testDir, 'apps', 'actions', 'buttons');
      const actionsButtonsFile = join(actionsButtonsFolder, RESOURCE_ENTRIES_FILENAME);
      expect(mockFileSystem.has(actionsButtonsFile)).toBe(true);

      const destContent = JSON.parse(mockFileSystem.get(actionsButtonsFile) as string);
      expect(destContent.ok).toBeDefined();
      expect(destContent.ok.source).toBe('OK');
    });
  });

  describe('Same-Folder Move', () => {
    it('should detect and skip same-folder move', async () => {
      const buttonsFolder = join(testDir, 'apps', 'common', 'buttons');
      mockDirectories.add(join(testDir, 'apps'));
      mockDirectories.add(join(testDir, 'apps', 'common'));
      mockDirectories.add(buttonsFolder);

      const result = await moveFolder(collection(testDir), {
        sourceFolderPath: 'apps.common.buttons',
        destinationFolderPath: 'apps.common.buttons',
      });

      expect(result.movedCount).toBe(0);
      expect(result.foldersDeleted).toBe(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Source and destination are the same');
    });

    it('should treat a destination collection with the same translations folder as the same collection', async () => {
      const buttonsFolder = join(testDir, 'apps', 'buttons');
      mockDirectories.add(join(testDir, 'apps'));
      mockDirectories.add(buttonsFolder);

      const result = await moveFolder(
        collection(testDir),
        {
          sourceFolderPath: 'apps.buttons',
          destinationFolderPath: 'apps.buttons',
          toCollection: 'alias',
        },
        { config: moveConfig('alias', testDir) },
      );

      expect(result.movedCount).toBe(0);
      expect(result.foldersDeleted).toBe(0);
      expect(result.warnings).toEqual(['Source and destination are the same. No move performed.']);
      expect(mockDirectories.has(buttonsFolder)).toBe(true);
    });

    it('should return warning when moving folder to its own parent with nestUnderDestination', async () => {
      // Setup source folder: apps.common.buttons with one resource
      const buttonsFolder = join(testDir, 'apps', 'common', 'buttons');
      mockDirectories.add(join(testDir, 'apps'));
      mockDirectories.add(join(testDir, 'apps', 'common'));
      mockDirectories.add(buttonsFolder);

      const buttonsFile = join(buttonsFolder, RESOURCE_ENTRIES_FILENAME);
      mockFileSystem.set(
        buttonsFile,
        JSON.stringify({
          ok: { source: 'OK' },
        }),
      );

      const buttonsMetaFile = join(buttonsFolder, TRACKER_META_FILENAME);
      mockFileSystem.set(
        buttonsMetaFile,
        JSON.stringify({
          ok: { en: { baseChecksum: 'abc123' } },
        }),
      );

      // Move apps.common.buttons to apps.common (its parent)
      // With nestUnderDestination=true, this would result in apps.common.buttons.ok -> apps.common.buttons.ok (no-op)
      const result = await moveFolder(collection(testDir), {
        sourceFolderPath: 'apps.common.buttons',
        destinationFolderPath: 'apps.common',
      });

      expect(result.movedCount).toBe(0);
      expect(result.foldersDeleted).toBe(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('already at this location');
    });
  });

  describe('Cross-Collection Move', () => {
    it('should move folder to a different collection', async () => {
      // Setup source in collection A
      const collectionAFolder = join(testDir, 'collectionA');
      const buttonsFolder = join(collectionAFolder, 'apps', 'buttons');
      mockDirectories.add(collectionAFolder);
      mockDirectories.add(join(collectionAFolder, 'apps'));
      mockDirectories.add(buttonsFolder);

      const buttonsFile = join(buttonsFolder, RESOURCE_ENTRIES_FILENAME);
      mockFileSystem.set(
        buttonsFile,
        JSON.stringify({
          ok: { source: 'OK' },
        }),
      );

      const buttonsMetaFile = join(buttonsFolder, TRACKER_META_FILENAME);
      mockFileSystem.set(
        buttonsMetaFile,
        JSON.stringify({
          ok: { en: { baseChecksum: 'abc1' } },
        }),
      );

      // Setup collection B
      const collectionBFolder = join(testDir, 'collectionB');
      mockDirectories.add(collectionBFolder);

      const result = await moveFolder(
        collection(collectionAFolder, 'collectionA'),
        {
          sourceFolderPath: 'apps.buttons',
          destinationFolderPath: 'shared.buttons',
          nestUnderDestination: false,
          toCollection: 'collectionB',
        },
        { config: moveConfig('collectionB', collectionBFolder) },
      );

      expect(result.movedCount).toBe(1);
      expect(result.foldersDeleted).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Verify source gone from A
      expect(mockFileSystem.has(buttonsFile)).toBe(false);

      // Verify dest exists in B
      const destFolder = join(collectionBFolder, 'shared', 'buttons');
      const destFile = join(destFolder, RESOURCE_ENTRIES_FILENAME);
      expect(mockFileSystem.has(destFile)).toBe(true);

      const destContent = JSON.parse(mockFileSystem.get(destFile) as string);
      expect(destContent.ok).toBeDefined();
    });

    it('should allow same-folder move when cross-collection', async () => {
      // Setup source in collection A
      const collectionAFolder = join(testDir, 'collectionA');
      const buttonsFolder = join(collectionAFolder, 'apps', 'buttons');
      mockDirectories.add(collectionAFolder);
      mockDirectories.add(join(collectionAFolder, 'apps'));
      mockDirectories.add(buttonsFolder);

      const buttonsFile = join(buttonsFolder, RESOURCE_ENTRIES_FILENAME);
      mockFileSystem.set(
        buttonsFile,
        JSON.stringify({
          ok: { source: 'OK' },
        }),
      );

      const buttonsMetaFile = join(buttonsFolder, TRACKER_META_FILENAME);
      mockFileSystem.set(
        buttonsMetaFile,
        JSON.stringify({
          ok: { en: { baseChecksum: 'abc1' } },
        }),
      );

      // Setup collection B
      const collectionBFolder = join(testDir, 'collectionB');
      mockDirectories.add(collectionBFolder);

      // Same path but different collection should work
      const result = await moveFolder(
        collection(collectionAFolder, 'collectionA'),
        {
          sourceFolderPath: 'apps.buttons',
          destinationFolderPath: 'apps.buttons',
          nestUnderDestination: false,
          toCollection: 'collectionB',
        },
        { config: moveConfig('collectionB', collectionBFolder) },
      );

      expect(result.movedCount).toBe(1);
      expect(result.foldersDeleted).toBe(1);
      expect(result.warnings).toHaveLength(0);

      // Verify dest exists in B
      const destFolder = join(collectionBFolder, 'apps', 'buttons');
      const destFile = join(destFolder, RESOURCE_ENTRIES_FILENAME);
      expect(mockFileSystem.has(destFile)).toBe(true);
    });
  });

  describe('Validation', () => {
    it('should reject invalid source folder path segments', async () => {
      await expect(
        moveFolder(collection(testDir), {
          sourceFolderPath: 'apps.invalid@char.buttons',
          destinationFolderPath: 'apps.shared',
        }),
      ).rejects.toThrow(InvalidFolderPathError);
    });

    it('should reject invalid destination folder path segments', async () => {
      const buttonsFolder = join(testDir, 'apps', 'buttons');
      mockDirectories.add(join(testDir, 'apps'));
      mockDirectories.add(buttonsFolder);

      await expect(
        moveFolder(collection(testDir), {
          sourceFolderPath: 'apps.buttons',
          destinationFolderPath: 'apps.invalid@char',
        }),
      ).rejects.toThrow(InvalidFolderPathError);
    });
  });
  describe('Existing destination folder', () => {
    it('should merge contents when destination already has subfolder with same name', async () => {
      // Setup source folder: testdata with resource (testdata.bar)
      const sourceTestdataFolder = join(testDir, 'testdata');
      mockDirectories.add(sourceTestdataFolder);

      const sourceFile = join(sourceTestdataFolder, RESOURCE_ENTRIES_FILENAME);
      mockFileSystem.set(
        sourceFile,
        JSON.stringify({
          bar: { source: 'Bar Value' },
        }),
      );

      const sourceMetaFile = join(sourceTestdataFolder, TRACKER_META_FILENAME);
      mockFileSystem.set(
        sourceMetaFile,
        JSON.stringify({
          bar: { en: { baseChecksum: 'def456' } },
        }),
      );

      // Setup destination: common.testdata already exists with resource (common.testdata.foo)
      const commonFolder = join(testDir, 'common');
      const destTestdataFolder = join(commonFolder, 'testdata');
      mockDirectories.add(commonFolder);
      mockDirectories.add(destTestdataFolder);

      const destFile = join(destTestdataFolder, RESOURCE_ENTRIES_FILENAME);
      mockFileSystem.set(
        destFile,
        JSON.stringify({
          foo: { source: 'Foo Value' },
        }),
      );

      const destMetaFile = join(destTestdataFolder, TRACKER_META_FILENAME);
      mockFileSystem.set(
        destMetaFile,
        JSON.stringify({
          foo: { en: { baseChecksum: 'abc123' } },
        }),
      );

      // Move testdata into common (should merge with existing common.testdata)
      const result = await moveFolder(collection(testDir), {
        sourceFolderPath: 'testdata',
        destinationFolderPath: 'common',
        nestUnderDestination: true,
      });

      expect(result.movedCount).toBe(1);
      expect(result.foldersDeleted).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Verify both resources exist in common.testdata
      const mergedFile = join(destTestdataFolder, RESOURCE_ENTRIES_FILENAME);
      expect(mockFileSystem.has(mergedFile)).toBe(true);

      const mergedContent = JSON.parse(mockFileSystem.get(mergedFile) as string);
      expect(mergedContent.foo).toBeDefined();
      expect(mergedContent.foo.source).toBe('Foo Value');
      expect(mergedContent.bar).toBeDefined();
      expect(mergedContent.bar.source).toBe('Bar Value');
    });
  });
});
