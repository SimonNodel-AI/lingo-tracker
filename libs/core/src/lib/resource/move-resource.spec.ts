import * as fs from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTempDir } from '../../testing/temp-dir.spec-helpers';
import { RESOURCE_ENTRIES_FILENAME } from '../../constants';
import type { Collection } from '../config/open-collection';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { moveResource } from './move-resource';

function collection(translationsFolder: string, name = 'main'): Collection {
  return {
    name,
    translationsFolder,
    baseLocale: 'en',
    locales: ['en'],
    targetLocales: [],
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
  locales: ['en'],
  collections: { [name]: { translationsFolder } },
});

// Keep real filesystem operations; a mutable copy permits the validation-order spy below.
vi.mock('node:fs', async (importOriginal) => ({ ...(await importOriginal<typeof import('node:fs')>()) }));

describe('Move Resource (real fs)', () => {
  const root = useTempDir('move-resource-unified-');
  let testDir: string;

  beforeEach(() => {
    testDir = root();
  });
  afterEach(() => vi.restoreAllMocks());

  describe('Single Resource Move', () => {
    it('should move a single resource successfully', async () => {
      // Setup source
      const sourceFolder = join(testDir, 'common', 'buttons');
      fs.mkdirSync(sourceFolder, { recursive: true });
      const sourceFile = join(sourceFolder, RESOURCE_ENTRIES_FILENAME);
      fs.writeFileSync(
        sourceFile,
        JSON.stringify({
          ok: { source: 'OK', comment: 'OK button' },
        }),
      );

      const result = await moveResource(collection(testDir), {
        source: 'common.buttons.ok',
        destination: 'common.actions.ok',
      });

      expect(result.movedCount).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Verify source gone
      // In this case, since 'ok' was the only key, the file should be deleted by deleteResource -> unlinkSync
      expect(fs.existsSync(sourceFile)).toBe(false);

      // Verify dest exists
      const destFolder = join(testDir, 'common', 'actions');
      const destFile = join(destFolder, RESOURCE_ENTRIES_FILENAME);
      expect(fs.existsSync(destFile)).toBe(true);

      const destFileContent = fs.readFileSync(destFile, 'utf8');
      expect(destFileContent).toBeDefined();
      const destContent = JSON.parse(destFileContent);
      expect(destContent.ok).toBeDefined();
      expect(destContent.ok.source).toBe('OK');
    });

    it('should warn and skip if destination exists and override is false', async () => {
      // Setup source
      const sourceFolder = join(testDir, 'a');
      fs.mkdirSync(sourceFolder, { recursive: true });
      const sourceFile = join(sourceFolder, RESOURCE_ENTRIES_FILENAME);
      fs.writeFileSync(
        sourceFile,
        JSON.stringify({
          key: { source: 'Source' },
        }),
      );

      // Setup dest
      const destFolder = join(testDir, 'b');
      fs.mkdirSync(destFolder, { recursive: true });
      const destFile = join(destFolder, RESOURCE_ENTRIES_FILENAME);
      fs.writeFileSync(
        destFile,
        JSON.stringify({
          key: { source: 'Dest' },
        }),
      );

      const result = await moveResource(collection(testDir), {
        source: 'a.key',
        destination: 'b.key',
        override: false,
      });

      expect(result.movedCount).toBe(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('already exists');

      // Verify no change
      const sourceFileContent = fs.readFileSync(sourceFile, 'utf8');
      expect(sourceFileContent).toBeDefined();
      const sourceContent = JSON.parse(sourceFileContent);
      expect(sourceContent.key).toBeDefined();
    });

    it('should override if destination exists and override is true', async () => {
      // Setup source
      const sourceFolder = join(testDir, 'a');
      fs.mkdirSync(sourceFolder, { recursive: true });
      const sourceFile = join(sourceFolder, RESOURCE_ENTRIES_FILENAME);
      fs.writeFileSync(
        sourceFile,
        JSON.stringify({
          key: { source: 'Source' },
        }),
      );

      // Setup dest
      const destFolder = join(testDir, 'b');
      fs.mkdirSync(destFolder, { recursive: true });
      const destFile = join(destFolder, RESOURCE_ENTRIES_FILENAME);
      fs.writeFileSync(
        destFile,
        JSON.stringify({
          key: { source: 'Dest' },
        }),
      );

      const result = await moveResource(collection(testDir), {
        source: 'a.key',
        destination: 'b.key',
        override: true,
      });

      expect(result.movedCount).toBe(1);

      // Verify dest updated
      const destFileContent = fs.readFileSync(destFile, 'utf8');
      expect(destFileContent).toBeDefined();
      const destContent = JSON.parse(destFileContent);
      expect(destContent.key.source).toBe('Source');
    });
  });

  describe('Wildcard Pattern Move', () => {
    it('should move multiple resources matching pattern', async () => {
      // Setup: common.buttons.ok, common.buttons.cancel
      const sourceFolder = join(testDir, 'common', 'buttons');
      fs.mkdirSync(sourceFolder, { recursive: true });
      const sourceFile = join(sourceFolder, RESOURCE_ENTRIES_FILENAME);
      fs.writeFileSync(
        sourceFile,
        JSON.stringify({
          ok: { source: 'OK' },
          cancel: { source: 'Cancel' },
        }),
      );

      const result = await moveResource(collection(testDir), {
        source: 'common.buttons.*',
        destination: 'common.actions',
      });

      expect(result.movedCount).toBe(2);
      expect(result.errors).toHaveLength(0);

      // Verify dest
      const destFolder = join(testDir, 'common', 'actions');
      const destFile = join(destFolder, RESOURCE_ENTRIES_FILENAME);
      expect(fs.existsSync(destFile)).toBe(true);

      const destFileContent = fs.readFileSync(destFile, 'utf8');
      expect(destFileContent).toBeDefined();
      const destContent = JSON.parse(destFileContent);
      expect(destContent.ok).toBeDefined();
      expect(destContent.cancel).toBeDefined();
    });

    it('should handle nested resources in wildcard', async () => {
      // Setup: common.buttons.ok, common.buttons.sub.item
      const buttonsFolder = join(testDir, 'common', 'buttons');
      fs.mkdirSync(buttonsFolder, { recursive: true });
      const buttonsFile = join(buttonsFolder, RESOURCE_ENTRIES_FILENAME);
      fs.writeFileSync(
        buttonsFile,
        JSON.stringify({
          ok: { source: 'OK' },
        }),
      );

      const subFolder = join(buttonsFolder, 'sub');
      fs.mkdirSync(subFolder, { recursive: true });
      const subFile = join(subFolder, RESOURCE_ENTRIES_FILENAME);
      fs.writeFileSync(
        subFile,
        JSON.stringify({
          item: { source: 'Item' },
        }),
      );

      const result = await moveResource(collection(testDir), {
        source: 'common.buttons.*',
        destination: 'common.actions',
      });

      expect(result.movedCount).toBe(2);

      // Verify dest
      const actionsFolder = join(testDir, 'common', 'actions');
      const actionsFile = join(actionsFolder, RESOURCE_ENTRIES_FILENAME);
      const actionsFileContent = fs.readFileSync(actionsFile, 'utf8');
      expect(actionsFileContent).toBeDefined();
      const actionsContent = JSON.parse(actionsFileContent);
      expect(actionsContent.ok).toBeDefined();

      const subActionsFolder = join(actionsFolder, 'sub');
      const subActionsFile = join(subActionsFolder, RESOURCE_ENTRIES_FILENAME);
      const subActionsFileContent = fs.readFileSync(subActionsFile, 'utf8');
      expect(subActionsFileContent).toBeDefined();
      const subActionsContent = JSON.parse(subActionsFileContent);
      expect(subActionsContent.item).toBeDefined();
    });
  });
  describe('Cross-Collection Move', () => {
    it('should move resource to a different destination folder', async () => {
      // Setup source in collection A
      const collectionAFolder = join(testDir, 'collectionA');
      const sourceFolder = join(collectionAFolder, 'common', 'buttons');
      fs.mkdirSync(collectionAFolder, { recursive: true });
      fs.mkdirSync(sourceFolder, { recursive: true });
      const sourceFile = join(sourceFolder, RESOURCE_ENTRIES_FILENAME);
      fs.writeFileSync(
        sourceFile,
        JSON.stringify({
          ok: { source: 'OK' },
        }),
      );

      // Setup dest in collection B
      const collectionBFolder = join(testDir, 'collectionB');
      fs.mkdirSync(collectionBFolder, { recursive: true });

      const result = await moveResource(
        collection(collectionAFolder, 'collectionA'),
        {
          source: 'common.buttons.ok',
          destination: 'common.actions.ok',
          toCollection: 'collectionB',
        },
        { config: moveConfig('collectionB', collectionBFolder) },
      );

      expect(result.movedCount).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Verify source gone from A
      expect(fs.existsSync(sourceFile)).toBe(false);

      // Verify dest exists in B
      const destFolder = join(collectionBFolder, 'common', 'actions');
      const destFile = join(destFolder, RESOURCE_ENTRIES_FILENAME);
      expect(fs.existsSync(destFile)).toBe(true);

      const destFileContent = fs.readFileSync(destFile, 'utf8');
      expect(destFileContent).toBeDefined();
      const destContent = JSON.parse(destFileContent);
      expect(destContent.ok).toBeDefined();
      expect(destContent.ok.source).toBe('OK');
    });

    it('should move wildcard resources to a different destination folder', async () => {
      // Setup source in collection A
      const collectionAFolder = join(testDir, 'collectionA');
      const sourceFolder = join(collectionAFolder, 'common', 'buttons');
      fs.mkdirSync(collectionAFolder, { recursive: true });
      fs.mkdirSync(sourceFolder, { recursive: true });
      const sourceFile = join(sourceFolder, RESOURCE_ENTRIES_FILENAME);
      fs.writeFileSync(
        sourceFile,
        JSON.stringify({
          ok: { source: 'OK' },
          cancel: { source: 'Cancel' },
        }),
      );

      // Setup dest in collection B
      const collectionBFolder = join(testDir, 'collectionB');
      fs.mkdirSync(collectionBFolder, { recursive: true });

      const result = await moveResource(
        collection(collectionAFolder, 'collectionA'),
        {
          source: 'common.buttons.*',
          destination: 'common.actions',
          toCollection: 'collectionB',
        },
        { config: moveConfig('collectionB', collectionBFolder) },
      );

      expect(result.movedCount).toBe(2);

      // Verify dest in B
      const destFolder = join(collectionBFolder, 'common', 'actions');
      const destFile = join(destFolder, RESOURCE_ENTRIES_FILENAME);
      expect(fs.existsSync(destFile)).toBe(true);

      const destFileContent = fs.readFileSync(destFile, 'utf8');
      expect(destFileContent).toBeDefined();
      const destContent = JSON.parse(destFileContent);
      expect(destContent.ok).toBeDefined();
      expect(destContent.cancel).toBeDefined();
    });
  });

  describe('Security', () => {
    it('should handle invalid characters in pattern during scanning', async () => {
      // Test with invalid characters that shouldn't be allowed in keys
      const invalidPattern = 'invalid@char*';
      const invalidPath = join(testDir, 'invalid@char');
      const exists = vi.spyOn(fs, 'existsSync');

      const result = await moveResource(collection(testDir), {
        source: invalidPattern,
        destination: 'dest',
      });

      // It should NOT try to check if the folder exists because validation should fail first
      expect(exists).not.toHaveBeenCalledWith(invalidPath);

      // It should return error
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Invalid key segment');
    });
  });
});
