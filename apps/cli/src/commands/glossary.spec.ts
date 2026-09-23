import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@simoncodes-ca/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simoncodes-ca/core')>();
  return {
    // Config loading and collection resolution run for real against the mocked config.
    loadConfig: actual.loadConfig,
    openCollection: actual.openCollection,
    ConfigNotFoundError: actual.ConfigNotFoundError,
    ConfigParseError: actual.ConfigParseError,
    CollectionNotFoundError: actual.CollectionNotFoundError,
    ReadOnlyCollectionError: actual.ReadOnlyCollectionError,
    readCollection: vi.fn(),
  };
});

vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>();
  return {
    ...actual,
    loadConfiguration: vi.fn(),
    resolveCollection: vi.fn(),
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => ''),
    writeFileSync: vi.fn(),
    default: {
      ...actual,
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => ''),
      writeFileSync: vi.fn(),
    },
  };
});

import * as fs from 'fs';
import {
  type CollectionRead,
  type LingoTrackerConfig,
  openCollection,
  readCollection,
  type StoredResource,
} from '@simoncodes-ca/core';
import type { TranslationStatus } from '@simoncodes-ca/domain';
import { loadConfiguration, resolveCollection } from '../utils';
import { glossaryCommand } from './glossary';

/** A root-level stored resource with one status per translated locale. */
function stored(
  key: string,
  source: string,
  translations: Record<string, string>,
  status: Record<string, TranslationStatus>,
): StoredResource {
  const metadata = Object.fromEntries(
    Object.entries(status).map(([locale, localeStatus]) => [locale, { checksum: 'x', status: localeStatus }]),
  );
  return {
    fullKey: key,
    folderPath: '',
    entryKey: key,
    entry: { key, source, translations, metadata },
    effectiveTags: [],
  };
}

function read(...resources: StoredResource[]): CollectionRead {
  return { resources, problems: [] };
}

const LOADED = read(
  stored('save', 'Save', { fr: 'Enregistrer' }, { fr: 'verified' }),
  stored('settings', 'Settings', { fr: 'Paramètres' }, { fr: 'translated' }),
);

const LOADED_CONFIG = {
  config: {
    baseLocale: 'en',
    locales: ['en', 'fr'],
    collections: { app: { translationsFolder: 'i18n' } },
  },
  configPath: '/project/.lingo-tracker.json',
  cwd: '/project',
};

function writtenContent(): string {
  const calls = vi.mocked(fs.writeFileSync).mock.calls;
  return (calls[calls.length - 1]?.[1] as string) ?? '';
}

describe('glossaryCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    (process.stdin as unknown as { isTTY: boolean }).isTTY = true;
    vi.mocked(loadConfiguration).mockReturnValue(LOADED_CONFIG as never);
    vi.mocked(readCollection).mockReturnValue(LOADED);
  });

  it('returns early when configuration is missing', async () => {
    vi.mocked(loadConfiguration).mockReturnValue(null);
    await glossaryCommand({ text: 'Save' });
    expect(readCollection).not.toHaveBeenCalled();
  });

  it('exits when no input is provided', async () => {
    await expect(glossaryCommand({})).rejects.toThrow('process.exit(1)');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('extracts from --text and writes a glossary file by default', async () => {
    await glossaryCommand({ text: 'Click Save to open Settings' });
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const out = JSON.parse(writtenContent());
    expect(out.baseLocale).toBe('en');
    expect(out.locales).toEqual(['fr']); // base locale excluded
    expect(out.matchCount).toBe(2);
    const keys = out.terms.map((t: { key: string }) => t.key).sort();
    expect(keys).toEqual(['save', 'settings']);
  });

  it('writes to a millisecond-precision timestamped file by default (no same-second collisions)', async () => {
    await glossaryCommand({ text: 'Save' });
    const outPath = vi.mocked(fs.writeFileSync).mock.calls[0][0] as string;
    // ms + trailing Z retained, e.g. lingo-tracker-glossary-2026-06-21T04-41-12-123Z.json
    expect(outPath).toMatch(/lingo-tracker-glossary-\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/);
  });

  it('reads from --input file', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('Save document');
    await glossaryCommand({ input: 'help.md' });
    expect(fs.existsSync).toHaveBeenCalled();
    const out = JSON.parse(writtenContent());
    expect(out.terms.some((t: { key: string }) => t.key === 'save')).toBe(true);
  });

  it('reads from piped stdin when no --text/--input and not a TTY', async () => {
    (process.stdin as unknown as { isTTY: boolean | undefined }).isTTY = undefined;
    vi.mocked(fs.readFileSync).mockReturnValue('Please Save your work');
    await glossaryCommand({});
    const out = JSON.parse(writtenContent());
    expect(out.terms.some((t: { key: string }) => t.key === 'save')).toBe(true);
    // fd 0 was read for stdin
    expect(fs.readFileSync).toHaveBeenCalledWith(0, 'utf8');
  });

  it('exits when --input file does not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await expect(glossaryCommand({ input: 'missing.md' })).rejects.toThrow('process.exit(1)');
  });

  it('prints JSON to stdout with --stdout and does not write a file', async () => {
    await glossaryCommand({ text: 'Save', stdout: true });
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(process.stdout.write).toHaveBeenCalledTimes(1);
    const printed = vi.mocked(process.stdout.write).mock.calls[0][0] as string;
    expect(JSON.parse(printed).matchCount).toBe(1);
  });

  it('narrows output locales with --locales', async () => {
    await glossaryCommand({ text: 'Save', locales: 'fr' });
    const out = JSON.parse(writtenContent());
    expect(out.locales).toEqual(['fr']);
  });

  it('resolves a single collection with --collection', async () => {
    vi.mocked(resolveCollection).mockReturnValue(
      openCollection(LOADED_CONFIG.config as LingoTrackerConfig, 'app', { cwd: '/project' }),
    );
    await glossaryCommand({ text: 'Save', collection: 'app' });
    expect(resolveCollection).toHaveBeenCalledWith('app', expect.anything(), '/project');
  });

  it('exits when --collection cannot be resolved', async () => {
    vi.mocked(resolveCollection).mockReturnValue(null);
    await expect(glossaryCommand({ text: 'Save', collection: 'nope' })).rejects.toThrow('process.exit(1)');
  });

  it('writes an empty glossary when nothing matches', async () => {
    await glossaryCommand({ text: 'completely unrelated words' });
    const out = JSON.parse(writtenContent());
    expect(out.matchCount).toBe(0);
    expect(out.terms).toEqual([]);
  });

  it('excludes stale/new entries by default but includes them with --include-all', async () => {
    vi.mocked(readCollection).mockReturnValue(read(stored('save', 'Save', { fr: 'Enregistrer' }, { fr: 'stale' })));

    await glossaryCommand({ text: 'Save' });
    expect(JSON.parse(writtenContent()).matchCount).toBe(0);

    await glossaryCommand({ text: 'Save', includeAll: true });
    expect(JSON.parse(writtenContent()).matchCount).toBe(1);
  });

  it('strips a collection base-locale override from translations', async () => {
    vi.mocked(loadConfiguration).mockReturnValue({
      config: {
        baseLocale: 'en',
        locales: ['en', 'fr', 'es'],
        collections: { app: { translationsFolder: 'i18n', baseLocale: 'fr' } },
      },
      configPath: '/p/.lingo-tracker.json',
      cwd: '/p',
    } as never);
    vi.mocked(readCollection).mockReturnValue(
      read(stored('save', 'Enregistrer', { fr: 'Enregistrer', es: 'Guardar' }, { fr: 'verified', es: 'verified' })),
    );

    await glossaryCommand({ text: 'Enregistrer' });
    const out = JSON.parse(writtenContent());
    // Collection base 'fr' stripped; only non-base target locale 'es' remains.
    expect(out.terms[0].translations).toEqual({ es: 'Guardar' });
  });

  it('reports an unreadable folder on stderr and keeps the readable entries', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(readCollection).mockReturnValue({
      resources: LOADED.resources,
      problems: [{ folderPath: 'bad', absolutePath: '/project/i18n/bad', message: 'Failed to parse JSON file x' }],
    });

    await glossaryCommand({ text: 'Save', stdout: true });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Collection 'app': skipped unreadable folder"));
    const printed = vi.mocked(process.stdout.write).mock.calls[0][0] as string;
    expect(JSON.parse(printed).matchCount).toBe(1);
  });

  it('reads a null locale metadata record as no status instead of crashing', async () => {
    const entry = stored('save', 'Save', { fr: 'Enregistrer' }, {});
    // A hand-edited tracker_meta.json can hold `"fr": null`.
    const withNullMeta: StoredResource = { ...entry, entry: { ...entry.entry, metadata: JSON.parse('{"fr": null}') } };
    vi.mocked(readCollection).mockReturnValue(read(withNullMeta));

    await glossaryCommand({ text: 'Save', includeAll: true });

    expect(JSON.parse(writtenContent()).matchCount).toBe(1);
  });

  it('exits with a clear error for the unimplemented ai extractor', async () => {
    await expect(glossaryCommand({ text: 'Save', extractor: 'ai' })).rejects.toThrow('process.exit(1)');
  });
});
