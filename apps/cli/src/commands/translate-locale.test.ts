import {
  assertAutoTranslationEnabled,
  AutoTranslationDisabledError,
  InvalidConfigError,
  type LingoTrackerConfig,
  loadConfig,
  type TranslateLocaleResult,
  translateLocale,
  TranslationError,
} from '@simoncodes-ca/core';
import prompts from 'prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isInteractiveTerminal } from '../runner/terminal';
import { translateLocaleCommand } from './translate-locale';

vi.mock('prompts');
vi.mock('../runner/terminal', () => ({ isInteractiveTerminal: vi.fn(() => false) }));
vi.mock('@simoncodes-ca/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simoncodes-ca/core')>();
  return {
    ...actual,
    assertAutoTranslationEnabled: vi.fn(actual.assertAutoTranslationEnabled),
    loadConfig: vi.fn(),
    translateLocale: vi.fn(),
  };
});

const CONFIG: LingoTrackerConfig = {
  exportFolder: 'dist/lingo-export',
  importFolder: 'dist/lingo-import',
  baseLocale: 'en',
  locales: ['en', 'fr', 'de'],
  translation: { enabled: true, provider: 'google-translate', apiKeyEnv: 'KEY' },
  collections: { main: { translationsFolder: 'src/i18n' } },
};

const RESULT: TranslateLocaleResult = {
  outcome: 'succeeded',
  totalResources: 4,
  translatedCount: 3,
  skippedCount: 1,
  failedCount: 0,
  warnings: [],
  failures: [],
  skippedKeys: ['a.plural'],
};

describe('translateLocaleCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INIT_CWD = '/project';
    process.exitCode = undefined;
    vi.mocked(isInteractiveTerminal).mockReturnValue(false);
    vi.mocked(loadConfig).mockReturnValue(CONFIG);
    vi.mocked(translateLocale).mockResolvedValue(RESULT);
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('translates the locale in the only collection', async () => {
    await translateLocaleCommand({ locale: 'fr' });

    expect(translateLocale).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'main', translationsFolder: '/project/src/i18n' }),
      { targetLocale: 'fr', onProgress: undefined },
    );
    expect(console.log).toHaveBeenCalledWith('  Translated: 3');
    expect(process.exitCode).toBe(0);
  });

  it('passes a progress callback with --verbose', async () => {
    await translateLocaleCommand({ locale: 'fr', verbose: true });

    expect(translateLocale).toHaveBeenCalledWith(expect.anything(), {
      targetLocale: 'fr',
      onProgress: expect.any(Function),
    });
  });

  it('exits 1 when some entries failed', async () => {
    vi.mocked(translateLocale).mockResolvedValue({
      ...RESULT,
      outcome: 'failed',
      failedCount: 1,
      failures: [{ key: 'a.b', error: 'quota' }],
    });

    await translateLocaleCommand({ locale: 'fr' });

    expect(console.log).toHaveBeenCalledWith('  a.b: quota');
    expect(process.exitCode).toBe(1);
  });

  it('prefixes a run that cannot start with "Translation failed:" and exits 1', async () => {
    vi.mocked(translateLocale).mockRejectedValue(new Error('API key missing'));

    await translateLocaleCommand({ locale: 'fr' });

    expect(console.error).toHaveBeenCalledWith('❌ Translation failed: API key missing');
    expect(process.exitCode).toBe(1);
  });

  it('keeps a typed translation error while printing the existing prefix', async () => {
    const error = new TranslationError('API key missing', 'MISSING_API_KEY', false);
    vi.mocked(translateLocale).mockRejectedValue(error);

    await translateLocaleCommand({ locale: 'fr' });

    expect(error).toBeInstanceOf(TranslationError);
    expect(error.code).toBe('MISSING_API_KEY');
    expect(error.message).toBe('API key missing');
    expect(console.error).toHaveBeenCalledWith('❌ Translation failed: API key missing');
    expect(process.exitCode).toBe(1);
  });

  it('keeps a disabled-translation error and prints its configuration hint', async () => {
    const error = new AutoTranslationDisabledError('main');
    vi.mocked(assertAutoTranslationEnabled).mockImplementationOnce(() => {
      throw error;
    });

    await translateLocaleCommand({ locale: 'fr' });

    expect(error).toBeInstanceOf(AutoTranslationDisabledError);
    expect(error.kind).toBe('unavailable');
    expect(error.message).toBe('Auto-translation is not enabled for collection "main"');
    expect(console.error).toHaveBeenCalledWith(
      '❌ Auto-translation is not enabled for collection "main". Set translation.enabled = true in your configuration',
    );
    expect(process.exitCode).toBe(1);
  });

  it('prints a typed error cause under the translation failure', async () => {
    const error = new InvalidConfigError('Cannot translate', { cause: new Error('API request failed') });
    vi.mocked(translateLocale).mockRejectedValue(error);

    await translateLocaleCommand({ locale: 'fr' });

    expect(console.error).toHaveBeenCalledWith('❌ Translation failed: Cannot translate');
    expect(console.error).toHaveBeenCalledWith('  API request failed');
    expect(error.message).toBe('Cannot translate');
  });

  it.each([
    ['the base locale', 'en', '❌ Cannot translate to the base locale "en".'],
    ['an unconfigured locale', 'ja', '❌ Locale "ja" is not configured. Available locales: en, fr, de'],
  ])('exits 1 for %s', async (_label, locale, message) => {
    await translateLocaleCommand({ locale });

    expect(console.error).toHaveBeenCalledWith(message);
    expect(translateLocale).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it.each([
    ['disabled', { ...CONFIG, translation: { enabled: false, provider: 'none', apiKeyEnv: 'NONE' } }],
    ['absent', { ...CONFIG, translation: undefined }],
  ])('exits 1 with a configuration hint, before any core call, when auto-translation is %s', async (_label, config) => {
    vi.mocked(loadConfig).mockReturnValue(config);

    await translateLocaleCommand({ locale: 'fr' });

    expect(console.error).toHaveBeenCalledWith(
      '❌ Auto-translation is not enabled for collection "main". Set translation.enabled = true in your configuration',
    );
    expect(translateLocale).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 when the collection has no target locales', async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...CONFIG, locales: ['en'] });

    await translateLocaleCommand({ locale: 'fr' });

    expect(console.error).toHaveBeenCalledWith(
      '❌ No target locales configured. Add locales other than the base locale "en".',
    );
    expect(translateLocale).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 without --locale in non-interactive mode', async () => {
    await translateLocaleCommand({});

    expect(console.error).toHaveBeenCalledWith('❌ Missing required options in non-interactive mode: --locale');
    expect(translateLocale).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  describe('interactive', () => {
    beforeEach(() => {
      vi.mocked(isInteractiveTerminal).mockReturnValue(true);
    });

    it('offers the target locales', async () => {
      vi.mocked(prompts).mockResolvedValueOnce({ locale: 'de' });

      await translateLocaleCommand({});

      expect(prompts).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            name: 'locale',
            choices: [
              { title: 'fr', value: 'fr' },
              { title: 'de', value: 'de' },
            ],
          }),
        ],
        expect.anything(),
      );
      expect(translateLocale).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ targetLocale: 'de' }));
    });

    it('offers only collection target locales and passes the prompted choice to core', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        ...CONFIG,
        collections: {
          main: { translationsFolder: 'src/i18n', baseLocale: 'fr', locales: ['fr', 'de'] },
        },
      });
      vi.mocked(prompts).mockResolvedValueOnce({ locale: 'de' });

      await translateLocaleCommand({});

      // The collection's base locale (fr) and unconfigured locales (including global en) are excluded.
      expect(prompts).toHaveBeenCalledExactlyOnceWith(
        [
          expect.objectContaining({
            type: 'select',
            name: 'locale',
            choices: [{ title: 'de', value: 'de' }],
          }),
        ],
        expect.anything(),
      );
      expect(translateLocale).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ name: 'main', baseLocale: 'fr', locales: ['fr', 'de'], targetLocales: ['de'] }),
        { targetLocale: 'de', onProgress: undefined },
      );
      expect(process.exitCode).toBe(0);
    });

    it('refuses a collection with auto-translation disabled before asking for a locale', async () => {
      vi.mocked(loadConfig).mockReturnValue({ ...CONFIG, translation: undefined });

      await translateLocaleCommand({});

      expect(prompts).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        '❌ Auto-translation is not enabled for collection "main". Set translation.enabled = true in your configuration',
      );
      expect(translateLocale).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('refuses a collection with no target locales before asking for a locale', async () => {
      vi.mocked(loadConfig).mockReturnValue({ ...CONFIG, locales: ['en'] });

      await translateLocaleCommand({});

      expect(console.error).toHaveBeenCalledWith(
        '❌ No target locales configured. Add locales other than the base locale "en".',
      );
      expect(prompts).not.toHaveBeenCalled();
      expect(translateLocale).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it.each([
      ['en', '❌ Cannot translate to the base locale "en".'],
      ['ja', '❌ Locale "ja" is not configured. Available locales: en, fr, de'],
    ])('refuses an invalid locale flag %s before prompting or running', async (locale, message) => {
      await translateLocaleCommand({ locale });

      expect(console.error).toHaveBeenCalledWith(message);
      expect(prompts).not.toHaveBeenCalled();
      expect(translateLocale).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('cancelling prints one cancel line and exits 0', async () => {
      vi.mocked(prompts).mockImplementationOnce(async (_questions, options) => {
        options?.onCancel?.({ type: 'select', name: 'locale', message: 'Locale' }, {});
        return {};
      });

      await translateLocaleCommand({});

      expect(console.error).toHaveBeenCalledWith('❌ Translate locale cancelled.');
      expect(translateLocale).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
    });
  });
});
