import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@simoncodes-ca/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simoncodes-ca/core')>();
  // Collection resolution runs for real against the mocked config.
  return { ...actual, loadConfig: vi.fn(), readCollection: vi.fn() };
});

// A terminal on stdin by default, so stdin is not read unless a test pipes it.
vi.mock('../runner/terminal', () => ({ isInteractiveTerminal: vi.fn(() => false), hasPipedStdin: vi.fn(() => false) }));

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
  ConfigNotFoundError,
  type LingoTrackerConfig,
  loadConfig,
  readCollection,
  type StoredResource,
} from '@simoncodes-ca/core';
import type { TranslationStatus } from '@simoncodes-ca/domain';
import { hasPipedStdin } from '../runner/terminal';
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

const CONFIG: LingoTrackerConfig = {
  baseLocale: 'en',
  locales: ['en', 'fr'],
  collections: { app: { translationsFolder: 'i18n' } },
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
    process.env.INIT_CWD = '/project';
    process.exitCode = undefined;
    vi.mocked(hasPipedStdin).mockReturnValue(false);
    vi.mocked(loadConfig).mockReturnValue(CONFIG);
    vi.mocked(readCollection).mockReturnValue(LOADED);
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('exits 1 when configuration is missing', async () => {
    vi.mocked(loadConfig).mockImplementation(() => {
      throw new ConfigNotFoundError('/project/.lingo-tracker.json');
    });
    await glossaryCommand({ text: 'Save' });
    expect(readCollection).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 when no input is provided', async () => {
    await glossaryCommand({});
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.readFileSync).not.toHaveBeenCalledWith(0, 'utf8');
    expect(process.exitCode).toBe(1);
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
    expect(process.exitCode).toBe(0);
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
    vi.mocked(hasPipedStdin).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('Please Save your work');
    await glossaryCommand({});
    const out = JSON.parse(writtenContent());
    expect(out.terms.some((t: { key: string }) => t.key === 'save')).toBe(true);
    // fd 0 was read for stdin
    expect(fs.readFileSync).toHaveBeenCalledWith(0, 'utf8');
  });

  it('exits 1 when --input file does not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await glossaryCommand({ input: 'missing.md' });
    expect(process.exitCode).toBe(1);
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

  it('reads only the collection named by --collection', async () => {
    vi.mocked(loadConfig).mockReturnValue({
      ...CONFIG,
      collections: { app: { translationsFolder: 'i18n' }, admin: { translationsFolder: 'admin' } },
    });
    await glossaryCommand({ text: 'Save', collection: 'app' });
    expect(readCollection).toHaveBeenCalledTimes(1);
    expect(readCollection).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'app', translationsFolder: '/project/i18n' }),
    );
  });

  it('exits 1 when --collection cannot be resolved', async () => {
    await glossaryCommand({ text: 'Save', collection: 'nope' });
    expect(console.log).toHaveBeenCalledWith('❌ Collection "nope" not found');
    expect(readCollection).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
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
    vi.mocked(loadConfig).mockReturnValue({
      baseLocale: 'en',
      locales: ['en', 'fr', 'es'],
      collections: { app: { translationsFolder: 'i18n', baseLocale: 'fr' } },
    });
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

  it('exits 1 with a clear error for the unimplemented ai extractor', async () => {
    await glossaryCommand({ text: 'Save', extractor: 'ai' });
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^❌ .*ai/i));
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
