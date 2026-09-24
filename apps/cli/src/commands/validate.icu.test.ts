import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateCommand } from './validate';

vi.mock('@simoncodes-ca/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simoncodes-ca/core')>();
  return {
    // Collection resolution runs for real against the mocked config.
    loadConfig: vi.fn(),
    openCollection: actual.openCollection,
    ConfigNotFoundError: actual.ConfigNotFoundError,
    ConfigParseError: actual.ConfigParseError,
    CollectionNotFoundError: actual.CollectionNotFoundError,
    ReadOnlyCollectionError: actual.ReadOnlyCollectionError,
    CONFIG_FILENAME: '.lingo-tracker.json',
    validateResources: vi.fn(),
    generateValidationSummary: vi.fn(),
    loadPreferredTerminology: vi.fn(() => ({
      rules: [],
      filePath: '/project/.lingo-tracker-preferred-terminology.json',
    })),
  };
});

import * as core from '@simoncodes-ca/core';

const mockValidateResources = vi.mocked(core.validateResources);
const mockGenerateValidationSummary = vi.mocked(core.generateValidationSummary);

const CONFIG = {
  baseLocale: 'en',
  locales: ['en', 'fr', 'es'],
  collections: { common: { translationsFolder: 'translations/common' } },
};

/** The ICU options `validateResources` was called with. */
function icuOptions() {
  return mockValidateResources.mock.calls[0]?.[1].icu;
}

describe('validateCommand ICU options', () => {
  const originalLog = console.log;

  beforeEach(() => {
    vi.clearAllMocks();
    console.log = vi.fn();
    console.warn = vi.fn();
    process.env.INIT_CWD = '/project';
    process.exitCode = undefined;

    vi.mocked(core.loadConfig).mockReturnValue(CONFIG);
    mockGenerateValidationSummary.mockReturnValue('summary');
    mockValidateResources.mockReturnValue({
      totalResourcesValidated: 0,
      totalUniqueKeys: 0,
      localesValidated: 2,
      collectionsValidated: 1,
      statusCounts: { new: 0, translated: 0, stale: 0, verified: 0 },
      failures: [],
      warnings: [],
      successes: [],
      passed: true,
    });
  });

  afterEach(() => {
    console.log = originalLog;
    process.exitCode = undefined;
  });

  it('checks ICU by default', async () => {
    await validateCommand({});

    expect(icuOptions()).toBeDefined();
  });

  it('leaves base-locale compilation to each collection in core', async () => {
    await validateCommand({});

    // Core compiles each collection's base values under that collection's own base locale.
    expect(icuOptions()).not.toHaveProperty('baseLocale');
  });

  it('leaves the portability rule off unless asked', async () => {
    await validateCommand({});

    expect(icuOptions()?.requirePortablePlurals).toBe(false);
  });

  it('enables the portability rule on request', async () => {
    await validateCommand({ requirePortablePlurals: true });

    expect(icuOptions()?.requirePortablePlurals).toBe(true);
  });

  it('compiles values by default', async () => {
    await validateCommand({});

    expect(icuOptions()?.compileValues).toBe(true);
  });

  it('skips ICU checking entirely when asked', async () => {
    await validateCommand({ skipIcu: true });

    expect(icuOptions()).toBeUndefined();
  });

  it('still runs the portability rule alongside --skip-icu, since it only parses', async () => {
    await validateCommand({ skipIcu: true, requirePortablePlurals: true });

    expect(icuOptions()?.requirePortablePlurals).toBe(true);
    expect(icuOptions()?.compileValues).toBe(false);
  });

  it('keeps --skip-locales a statement about target locales only', async () => {
    // The base locale is not a target locale, so skipping it is a no-op —
    // the ICU pass still covers the source value every translation copies.
    await validateCommand({ skipLocales: ['en'] });

    expect(mockValidateResources.mock.calls[0]?.[1].skippedLocales).toEqual([]);
    expect(mockValidateResources.mock.calls[0]?.[0]?.[0]?.targetLocales).toEqual(['fr', 'es']);
  });

  it('does not check a skipped target locale', async () => {
    await validateCommand({ skipLocales: ['es'] });

    expect(mockValidateResources.mock.calls[0]?.[1].skippedLocales).toEqual(['es']);
    expect(mockValidateResources.mock.calls[0]?.[0]?.[0]?.targetLocales).toEqual(['fr', 'es']);
  });
});
