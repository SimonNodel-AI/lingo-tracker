import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { findSimilarCommand } from './find-similar';

vi.mock('@simoncodes-ca/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simoncodes-ca/core')>();
  // Collection resolution and Resource Search run for real; only the config and the disk read are mocked.
  return { ...actual, loadConfig: vi.fn(), readCollection: vi.fn() };
});
vi.mock('../runner/terminal', () => ({ isInteractiveTerminal: vi.fn(() => false) }));

vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>();
  return {
    ...actual,
    resolve: vi.fn((...segments: string[]) => segments.join('/')),
    default: {
      ...actual,
      resolve: vi.fn((...segments: string[]) => segments.join('/')),
    },
  };
});

import { ConfigNotFoundError, loadConfig, readCollection } from '@simoncodes-ca/core';
import type { CollectionReadProblem, LingoTrackerConfig, StoredResource } from '@simoncodes-ca/core';

/** A fully typed stored resource, so shape drift in the Collection Reader fails to compile. */
function stored(fullKey: string, baseValue: string): StoredResource {
  const segments = fullKey.split('.');
  const entryKey = segments[segments.length - 1] ?? '';
  return {
    fullKey,
    folderPath: segments.slice(0, -1).join('.'),
    entryKey,
    entry: { key: entryKey, source: baseValue, translations: { fr: `fr:${baseValue}` }, metadata: {} },
    effectiveTags: [],
  };
}

function collectionHolds(...resources: StoredResource[]): void {
  vi.mocked(readCollection).mockReturnValue({ resources, problems: [] });
}

function loggedLines(): string[] {
  return vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
}

const BASE_CONFIG: LingoTrackerConfig = {
  exportFolder: 'dist/lingo-export',
  importFolder: 'dist/lingo-import',
  baseLocale: 'en',
  locales: ['en', 'fr'],
  collections: {
    tracker: {
      translationsFolder: 'src/assets/i18n',
    },
  },
};

describe('find-similar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.INIT_CWD = '/project';
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  // ---------------------------------------------------------------------------
  // the similar-value rule, as the command reports it
  // ---------------------------------------------------------------------------

  describe('similar-value rule (via findSimilarCommand output)', () => {
    // The rule itself is specified in libs/core/src/lib/resource/search.spec.ts and the
    // Levenshtein scores in libs/domain/src/lib/normalized-levenshtein.spec.ts. These cases
    // pin what the command prints for it.
    beforeEach(() => {
      vi.mocked(loadConfig).mockReturnValue(BASE_CONFIG);
    });

    it('reports 100% for an identical multi-character stored value', async () => {
      collectionHolds(stored('common.button.addItem', 'Add Item'));
      await findSimilarCommand({ collection: 'tracker', value: 'Add Item' });
      expect(console.log).toHaveBeenCalledWith('  common.button.addItem → "Add Item" (similarity: 100%)');
    });

    it('folds case before scoring', async () => {
      collectionHolds(stored('labels.greeting', 'Hello World'));
      await findSimilarCommand({ collection: 'tracker', value: 'hello world' });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('(similarity: 100%)'));
    });

    it('keeps a candidate sitting exactly on the 0.8 threshold', async () => {
      collectionHolds(stored('btn.save', 'saved'));
      await findSimilarCommand({ collection: 'tracker', value: 'save' });
      expect(console.log).toHaveBeenCalledWith('  btn.save → "saved" (similarity: 80%)');
    });

    it('drops a candidate below the 0.8 threshold that does not contain the query as a word', async () => {
      collectionHolds(stored('btn.delete', 'deleted items'));
      await findSimilarCommand({ collection: 'tracker', value: 'delete' });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No similar values found'));
    });

    it('drops a candidate whose base-locale value is empty', async () => {
      collectionHolds(stored('x.key', ''));
      await findSimilarCommand({ collection: 'tracker', value: 'a' });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No similar values found'));
    });

    it('reports a stored value that contains the query as whole words, with its similarity', async () => {
      collectionHolds(stored('btn.saveDraft', 'Save draft'));
      await findSimilarCommand({ collection: 'tracker', value: 'Save' });
      expect(console.log).toHaveBeenCalledWith('  btn.saveDraft → "Save draft" (similarity: 40%)');
    });

    it('reports a stored value that the query contains as whole words', async () => {
      collectionHolds(stored('common.actions.save', 'Save'));
      await findSimilarCommand({ collection: 'tracker', value: 'Save draft' });
      expect(console.log).toHaveBeenCalledWith('  common.actions.save → "Save" (similarity: 40%)');
    });
  });

  // ---------------------------------------------------------------------------
  // findSimilarCommand — guard clauses
  // ---------------------------------------------------------------------------

  describe('findSimilarCommand — guard clauses', () => {
    it('exits 1 without searching when the configuration is missing', async () => {
      vi.mocked(loadConfig).mockImplementation(() => {
        throw new ConfigNotFoundError('/project/.lingo-tracker.json');
      });
      await findSimilarCommand({ collection: 'tracker', value: 'hello' });
      expect(readCollection).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('exits with code 1 when --value is missing', async () => {
      vi.mocked(loadConfig).mockReturnValue(BASE_CONFIG);
      await findSimilarCommand({ collection: 'tracker' });
      expect(console.error).toHaveBeenCalledWith('❌ Missing required options in non-interactive mode: --value');
      expect(readCollection).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('exits with code 1 when --value is an empty string', async () => {
      vi.mocked(loadConfig).mockReturnValue(BASE_CONFIG);
      await findSimilarCommand({ collection: 'tracker', value: '' });
      expect(console.error).toHaveBeenCalledWith('❌ Missing required options in non-interactive mode: --value');
      expect(process.exitCode).toBe(1);
    });

    it('exits with code 1 when --value is whitespace only', async () => {
      vi.mocked(loadConfig).mockReturnValue(BASE_CONFIG);
      await findSimilarCommand({ collection: 'tracker', value: '   ' });
      expect(console.error).toHaveBeenCalledWith('❌ --value must not be blank');
      expect(readCollection).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('uses the only collection when --collection is missing', async () => {
      vi.mocked(loadConfig).mockReturnValue(BASE_CONFIG);
      collectionHolds();
      await findSimilarCommand({ value: 'hello' });
      expect(readCollection).toHaveBeenCalledWith(
        expect.objectContaining({ translationsFolder: '/project/src/assets/i18n' }),
      );
      expect(process.exitCode).toBe(0);
    });

    it('exits with code 1 when --collection is missing and several collections exist', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        ...BASE_CONFIG,
        collections: { tracker: { translationsFolder: 'a' }, admin: { translationsFolder: 'b' } },
      });
      await findSimilarCommand({ value: 'hello' });
      expect(console.error).toHaveBeenCalledWith('❌ Missing required option: --collection');
      expect(readCollection).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('exits with code 1 when collection is not found in config', async () => {
      vi.mocked(loadConfig).mockReturnValue(BASE_CONFIG);
      await findSimilarCommand({ collection: 'nonexistent', value: 'hello' });
      expect(console.error).toHaveBeenCalledWith('❌ Collection "nonexistent" not found');
      expect(process.exitCode).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // findSimilarCommand — output messages
  // ---------------------------------------------------------------------------

  describe('findSimilarCommand — output messages', () => {
    beforeEach(() => {
      vi.mocked(loadConfig).mockReturnValue(BASE_CONFIG);
    });

    it('prints "No similar values found" when no stored value matches', async () => {
      collectionHolds(stored('a.key', 'hello world'));
      await findSimilarCommand({ collection: 'tracker', value: 'hi' });
      expect(console.log).toHaveBeenCalledWith('No similar values found for "hi".');
    });

    it('prints "No similar values found" when the collection is empty', async () => {
      collectionHolds();
      await findSimilarCommand({ collection: 'tracker', value: 'hello' });
      expect(console.log).toHaveBeenCalledWith('No similar values found for "hello".');
    });

    it('prints header and matched results when a stored value matches', async () => {
      collectionHolds(stored('btn.ok', 'Ok'));
      await findSimilarCommand({ collection: 'tracker', value: 'Ok' });
      expect(console.log).toHaveBeenCalledWith('Similar values found for "Ok":');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('btn.ok'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"Ok"'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('(similarity: 100%)'));
    });

    it('formats each result as "  key → \\"value\\" (similarity: N%)" with the base value', async () => {
      collectionHolds(stored('common.ok', 'Cancel'));
      await findSimilarCommand({ collection: 'tracker', value: 'Cancel' });
      expect(console.log).toHaveBeenCalledWith('  common.ok → "Cancel" (similarity: 100%)');
    });
  });

  // ---------------------------------------------------------------------------
  // findSimilarCommand — keys that contain the query
  // ---------------------------------------------------------------------------

  describe('findSimilarCommand — keys that contain the query', () => {
    beforeEach(() => {
      vi.mocked(loadConfig).mockReturnValue(BASE_CONFIG);
    });

    it('scores an entry whose key contains the query on its base value', async () => {
      collectionHolds(stored('btn.connect', 'Connect'));
      await findSimilarCommand({ collection: 'tracker', value: 'Connect' });
      expect(console.log).toHaveBeenCalledWith('  btn.connect → "Connect" (similarity: 100%)');
    });

    it('still drops an entry whose key contains the query when its value is not similar', async () => {
      collectionHolds(stored('errors.connectTimeout', 'The connection attempt timed out'));
      await findSimilarCommand({ collection: 'tracker', value: 'Connect' });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No similar values found'));
    });

    it('ranks the entry whose key contains the query first when scores tie', async () => {
      collectionHolds(stored('dialogs.secondaryAction', 'Connect'), stored('common.button.connect', 'Connect'));
      await findSimilarCommand({ collection: 'tracker', value: 'Connect' });
      const lines = loggedLines();
      const canonicalIdx = lines.findIndex((line) => line.includes('common.button.connect'));
      const otherIdx = lines.findIndex((line) => line.includes('dialogs.secondaryAction'));
      expect(canonicalIdx).toBeGreaterThan(-1);
      expect(canonicalIdx).toBeLessThan(otherIdx);
    });

    it('does not let a key match outrank a strictly better value match', async () => {
      collectionHolds(stored('common.button.connect', 'Connects'), stored('dialogs.secondaryAction', 'Connect'));
      await findSimilarCommand({ collection: 'tracker', value: 'Connect' });
      const lines = loggedLines();
      const exactIdx = lines.findIndex((line) => line.includes('dialogs.secondaryAction'));
      const keyIdx = lines.findIndex((line) => line.includes('common.button.connect'));
      expect(exactIdx).toBeGreaterThan(-1);
      expect(exactIdx).toBeLessThan(keyIdx);
    });

    it('returns a key-matched and a value-matched entry holding the same value', async () => {
      collectionHolds(stored('common.button.connect', 'Connect'), stored('dialogs.secondaryAction', 'Connect'));
      await findSimilarCommand({ collection: 'tracker', value: 'Connect' });
      const lines = loggedLines();
      expect(lines.some((line) => line.includes('common.button.connect'))).toBe(true);
      expect(lines.some((line) => line.includes('dialogs.secondaryAction'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // findSimilarCommand — sorting and maxResults
  // ---------------------------------------------------------------------------

  describe('findSimilarCommand — sorting and maxResults', () => {
    beforeEach(() => {
      vi.mocked(loadConfig).mockReturnValue(BASE_CONFIG);
    });

    it('sorts results by score descending', async () => {
      // Query 'save': 'saved' scores 0.8, the exact match scores 1.0. The lower
      // scoring entry is read first to prove the ranking actually reorders.
      collectionHolds(stored('key.near', 'saved'), stored('key.exact', 'save'));
      await findSimilarCommand({ collection: 'tracker', value: 'save' });
      const lines = loggedLines();
      const exactIdx = lines.findIndex((line) => line.includes('key.exact'));
      const nearIdx = lines.findIndex((line) => line.includes('key.near'));
      expect(exactIdx).toBeGreaterThan(-1);
      expect(nearIdx).toBeGreaterThan(-1);
      expect(exactIdx).toBeLessThan(nearIdx);
    });

    it('defaults maxResults to 5', async () => {
      collectionHolds(...Array.from({ length: 10 }, (_, i) => stored(`key.${i}`, 'a')));

      await findSimilarCommand({ collection: 'tracker', value: 'a' });

      expect(loggedLines().filter((line) => line.startsWith('  key.'))).toHaveLength(5);
    });

    it('respects custom maxResults', async () => {
      collectionHolds(...Array.from({ length: 10 }, (_, i) => stored(`key.${i}`, 'a')));

      await findSimilarCommand({ collection: 'tracker', value: 'a', maxResults: 3 });

      expect(loggedLines().filter((line) => line.startsWith('  key.'))).toHaveLength(3);
    });

    it('compares every stored value, however many precede the best match', async () => {
      // There is no candidate cap any more: 600 weaker matches read first cannot crowd out the exact one.
      collectionHolds(
        ...Array.from({ length: 600 }, (_, i) => stored(`noise.variant${i}`, `Cancel ${i}`)),
        stored('zz.dismiss', 'Cancel'),
      );

      await findSimilarCommand({ collection: 'tracker', value: 'Cancel' });

      expect(loggedLines().find((line) => line.startsWith('  '))).toBe('  zz.dismiss → "Cancel" (similarity: 100%)');
      expect(console.warn).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // findSimilarCommand — the collection it reads
  // ---------------------------------------------------------------------------

  describe('findSimilarCommand — the collection it reads', () => {
    it('uses collectionConfig.baseLocale when set', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        exportFolder: 'dist/lingo-export',
        importFolder: 'dist/lingo-import',
        baseLocale: 'en',
        locales: ['en', 'fr'],
        collections: {
          tracker: {
            translationsFolder: 'src/i18n',
            baseLocale: 'fr',
          },
        },
      });
      collectionHolds();

      await findSimilarCommand({ collection: 'tracker', value: 'bonjour' });

      expect(readCollection).toHaveBeenCalledWith(expect.objectContaining({ baseLocale: 'fr' }));
    });

    it('falls back to config.baseLocale when collectionConfig has no baseLocale', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        exportFolder: 'dist/lingo-export',
        importFolder: 'dist/lingo-import',
        baseLocale: 'de',
        locales: ['de', 'en'],
        collections: {
          tracker: {
            translationsFolder: 'src/i18n',
          },
        },
      });
      collectionHolds();

      await findSimilarCommand({ collection: 'tracker', value: 'hallo' });

      expect(readCollection).toHaveBeenCalledWith(expect.objectContaining({ baseLocale: 'de' }));
    });

    it('falls back to "en" when neither collection nor config specifies baseLocale', async () => {
      // This test deliberately omits baseLocale to exercise the command's legacy fallback.
      vi.mocked(loadConfig).mockReturnValue({
        exportFolder: 'dist/lingo-export',
        importFolder: 'dist/lingo-import',
        locales: ['en'],
        collections: {
          tracker: {
            translationsFolder: 'src/i18n',
          },
        },
      } as unknown as LingoTrackerConfig);
      collectionHolds();

      await findSimilarCommand({ collection: 'tracker', value: 'hello' });

      expect(readCollection).toHaveBeenCalledWith(expect.objectContaining({ baseLocale: 'en' }));
    });

    it('reads the collection with its translationsFolder resolved from cwd + collectionConfig', async () => {
      vi.mocked(loadConfig).mockReturnValue(BASE_CONFIG);
      collectionHolds();
      await findSimilarCommand({ collection: 'tracker', value: 'hello' });
      expect(readCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          translationsFolder: '/project/src/assets/i18n',
        }),
      );
    });

    it('compares the trimmed query', async () => {
      vi.mocked(loadConfig).mockReturnValue(BASE_CONFIG);
      collectionHolds(stored('labels.hello', 'hello'));
      await findSimilarCommand({ collection: 'tracker', value: '  hello  ' });
      expect(console.log).toHaveBeenCalledWith('Similar values found for "hello":');
      expect(console.log).toHaveBeenCalledWith('  labels.hello → "hello" (similarity: 100%)');
    });

    it('warns about each folder it could not read and still reports the others', async () => {
      vi.mocked(loadConfig).mockReturnValue(BASE_CONFIG);
      const problem: CollectionReadProblem = {
        folderPath: 'broken',
        absolutePath: '/project/src/assets/i18n/broken',
        message: 'Unexpected token in resource_entries.json',
      };
      vi.mocked(readCollection).mockReturnValue({ resources: [stored('common.ok', 'OK')], problems: [problem] });

      await findSimilarCommand({ collection: 'tracker', value: 'OK' });

      expect(console.error).toHaveBeenCalledWith(
        '⚠️  Skipped unreadable folder: Unexpected token in resource_entries.json',
      );
      expect(console.log).toHaveBeenCalledWith('  common.ok → "OK" (similarity: 100%)');
      expect(process.exitCode).toBe(0);
    });

    it('prints no warning when every folder was read', async () => {
      vi.mocked(loadConfig).mockReturnValue(BASE_CONFIG);
      collectionHolds(stored('key.one', 'a'));
      await findSimilarCommand({ collection: 'tracker', value: 'a' });
      expect(loggedLines().some((line) => line.startsWith('⚠️'))).toBe(false);
    });
  });
});
