import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seedResources, testCollection, useTempDir } from '../../testing/temp-dir.spec-helpers';
import { ResourceAlreadyExistsError, TranslationError } from '../errors/lingo-tracker-error';
import { InMemoryTranslationProvider } from '../translation/in-memory-translation-provider';
import { commitPrepared, preflightAdd, prepareAdd } from './resource-entry';
import type { ResourceMutation } from './resource-mutation';

describe('prepareAdd', () => {
  const root = useTempDir('prepared-add-');
  const collection = () => testCollection(root(), { locales: ['en', 'fr', 'de'] });
  const automatic = () => ({
    ...collection(),
    translationConfig: { enabled: true, provider: 'google-translate' as const, apiKeyEnv: 'KEY' },
  });

  it('normalizes the ICU base, ignores a supplied base locale, and keeps supplied values and details without writing', async () => {
    const prepared = await prepareAdd(
      preflightAdd(
        collection(),
        'common.hello',
        {
          baseValue: 'Hello {{ name }}',
          comment: 'Greeting',
          tags: [' UI '],
          translations: [
            { locale: 'en', value: 'Ignored' },
            { locale: 'fr', value: 'Bonjour {{ name }}', status: 'verified' },
          ],
        },
        'fail',
      ),
    );
    expect(prepared.resolvedKey).toBe('common.hello');
    expect(prepared.changes).toEqual({
      baseValue: 'Hello {name}',
      comment: 'Greeting',
      tags: [' UI '],
      translations: [
        { locale: 'fr', value: 'Bonjour {{ name }}', status: 'verified' },
        { locale: 'de', value: 'Hello {name}', status: 'new' },
      ],
    });
    expect(prepared).not.toHaveProperty('skippedLocales');
    expect(existsSync(join(root(), 'common'))).toBe(false);
    const result = commitPrepared(prepared);
    expect(result.translations).toEqual([
      { locale: 'fr', value: 'Bonjour {name}', status: 'verified' },
      { locale: 'de', value: 'Hello {name}', status: 'new' },
    ]);
  });

  it('seeds every missing locale with a new copy of the base when auto-translation is disabled', async () => {
    const prepared = await prepareAdd(preflightAdd(collection(), 'common.ok', { baseValue: 'New' }, 'fail'));
    expect(prepared.changes.translations).toEqual([
      { locale: 'fr', value: 'New', status: 'new' },
      { locale: 'de', value: 'New', status: 'new' },
    ]);
    expect(prepared.terminology).toEqual({ findings: [], problems: [] });
  });

  it('auto-translates only missing locales from the ICU base and retains the result without translating again at commit', async () => {
    const provider = new InMemoryTranslationProvider();
    const prepared = await prepareAdd(
      preflightAdd(
        automatic(),
        'common.hello',
        {
          baseValue: 'Hello {{ name }}',
          translations: [{ locale: 'fr', value: 'Bonjour {name}' }],
        },
        'fail',
      ),
      { provider },
    );
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.[0]?.targetLocale).toBe('de');
    expect(prepared.changes.translations).toEqual([
      { locale: 'fr', value: 'Bonjour {name}' },
      { locale: 'de', value: '[de] Hello {name}', status: 'translated' },
    ]);
    expect(prepared.skippedLocales).toEqual([]);
    const result = commitPrepared(prepared);
    expect(provider.calls).toHaveLength(1);
    expect(result.skippedLocales).toEqual([]);
    expect(result.terminology).toBe(prepared.terminology);
  });

  it('collects terminology findings, translator problems and skipped-locale copies once before the write', async () => {
    writeFileSync(
      collection().termFiles.preferredTerminology.path,
      JSON.stringify([{ discouraged: 'Expenditure', preferred: 'Investment' }]),
    );
    const target = {
      ...automatic(),
      termFiles: {
        ...collection().termFiles,
        protectedTerms: { path: join(root(), 'missing-terms.json'), explicit: true },
      },
    };
    const provider = new InMemoryTranslationProvider();
    const baseValue = 'Expenditure {count, plural, other {items}}';
    const prepared = await prepareAdd(preflightAdd(target, 'budget.one', { baseValue }, 'fail'), { provider });
    expect(prepared.changes.translations).toEqual([
      { locale: 'fr', value: baseValue, status: 'new' },
      { locale: 'de', value: baseValue, status: 'new' },
    ]);
    expect(prepared.skippedLocales).toEqual(['fr', 'de']);
    expect(prepared.terminology.findings).toEqual([
      {
        key: 'budget.one',
        discouraged: 'Expenditure',
        preferred: 'Investment',
        message: 'consider "Investment" instead of "Expenditure"',
      },
    ]);
    expect(prepared.terminology.problems).toHaveLength(1);
    expect(prepared.terminology.problems[0]).toContain('missing-terms.json');
    expect(provider.calls).toEqual([]);
    expect(existsSync(join(root(), 'budget'))).toBe(false);
    // Commit carries the captured advice, even when the rule file changes after preparation.
    writeFileSync(collection().termFiles.preferredTerminology.path, '[]');
    const result = commitPrepared(prepared);
    expect(result.skippedLocales).toEqual(prepared.skippedLocales);
    expect(result.terminology).toBe(prepared.terminology);
  });

  it('leaves preparation unwritten on provider failure and refuses a late conflict without emitting a mutation', async () => {
    const failure = new TranslationError('provider failed', 'SERVER_ERROR', false);
    await expect(
      prepareAdd(preflightAdd(automatic(), 'common.ok', { baseValue: 'OK' }, 'fail'), {
        provider: new InMemoryTranslationProvider(() => {
          throw failure;
        }),
      }),
    ).rejects.toBe(failure);
    expect(existsSync(join(root(), 'common'))).toBe(false);
    const prepared = await prepareAdd(preflightAdd(collection(), 'common.ok', { baseValue: 'OK' }, 'fail'));
    seedResources(collection(), { 'common.ok': { source: 'Concurrent' } });
    const before = readFileSync(join(root(), 'common', 'resource_entries.json'));
    const mutations: ResourceMutation[] = [];
    expect(() => prepared.recheck()).toThrow(ResourceAlreadyExistsError);
    expect(() => commitPrepared(prepared, (mutation) => mutations.push(mutation))).toThrow(ResourceAlreadyExistsError);
    expect(readFileSync(join(root(), 'common', 'resource_entries.json'))).toEqual(before);
    expect(mutations).toEqual([]);
  });
});
