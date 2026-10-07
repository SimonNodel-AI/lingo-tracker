import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seedResources, testCollection, useTempDir } from '../../testing/temp-dir.spec-helpers';
import { ResourceAlreadyExistsError, ResourceNotFoundError, TranslationError } from '../errors/lingo-tracker-error';
import * as fileIO from '../file-io/json-file-operations';
import { InMemoryTranslationProvider } from '../machine-translation/in-memory-translation-provider';
import { calculateChecksum } from './checksum';
import { pruneEmptiedFolders } from './folder-pruning';
import { type EntryWriteResult, removeEntry, writeEntry } from './resource-entry';
import { openResourceFolder } from './resource-folder';
import type { ResourceMutation } from './resource-mutation';

function requireAddResult(outcome: EntryWriteResult) {
  if (outcome.kind !== 'add') throw new Error('Expected add result');
  return outcome.result;
}
function requireEditResult(outcome: EntryWriteResult) {
  if (outcome.kind !== 'edit') throw new Error('Expected edit result');
  return outcome.result;
}
function requireTranslateResult(outcome: EntryWriteResult) {
  if (outcome.kind !== 'translate') throw new Error('Expected translate result');
  return outcome.result;
}

describe('writeEntry (real fs)', () => {
  const root = useTempDir('entry-write-');
  afterEach(() => vi.restoreAllMocks());
  const collection = () => testCollection(root());
  const automatic = () =>
    testCollection(root(), {
      translationConfig: { enabled: true, provider: 'google-translate', apiKeyEnv: 'ENTRY_WRITE_TEST_KEY' },
    });
  const folder = () => openResourceFolder(join(root(), 'buttons'), collection());
  const seed = () =>
    seedResources(collection(), {
      'buttons.ok': { source: 'OK', translations: { fr: { value: 'OK', status: 'new' }, es: 'Aceptar' } },
      'buttons.keep': { source: 'Keep' },
    });

  it('adds ICU values, inferred and explicit statuses, details, and the exact saved upsert', async () => {
    const mutations: ResourceMutation[] = [];
    const result = await writeEntry(
      collection(),
      'buttons.ok',
      {
        kind: 'add',
        onExisting: 'fail',
        changes: {
          baseValue: 'Hello {{ name }}',
          comment: 'Greeting',
          tags: [' UI ', 'UI'],
          translations: [{ locale: 'fr', value: 'Bonjour {{ name }}', status: 'verified' }],
        },
      },
      { onMutation: (mutation) => mutations.push(mutation) },
    ).then(requireAddResult);
    const stored = folder().treeEntry('ok');
    expect(stored).toBeDefined();
    expect(result.created).toBe(true);
    expect(stored).toMatchObject({
      source: 'Hello {name}',
      comment: 'Greeting',
      tags: ['ui'],
      translations: { fr: 'Bonjour {name}', es: 'Hello {name}' },
    });
    expect(stored?.metadata).toEqual({
      en: { checksum: calculateChecksum('Hello {name}') },
      fr: {
        checksum: calculateChecksum('Bonjour {name}'),
        baseChecksum: calculateChecksum('Hello {name}'),
        status: 'verified',
      },
      es: {
        checksum: calculateChecksum('Hello {name}'),
        baseChecksum: calculateChecksum('Hello {name}'),
        status: 'new',
      },
    });
    expect(mutations).toEqual([{ kind: 'upsert', translationsFolder: root(), key: 'buttons.ok', entry: stored }]);
    expect(result.translations).toEqual([
      { locale: 'fr', value: 'Bonjour {name}', status: 'verified' },
      { locale: 'es', value: 'Hello {name}', status: 'new' },
    ]);
  });

  it('refuses an existing add before provider work and replaces only when requested', async () => {
    seed();
    const provider = new InMemoryTranslationProvider();
    const intent = {
      kind: 'add' as const,
      onExisting: 'fail' as const,
      changes: { baseValue: 'Replace' },
    };
    await expect(writeEntry(automatic(), 'buttons.ok', intent, { provider }).then(requireAddResult)).rejects.toThrow(
      ResourceAlreadyExistsError,
    );
    expect(provider.calls).toEqual([]);
    const result = await writeEntry(collection(), 'buttons.ok', { ...intent, onExisting: 'replace' }).then(
      requireAddResult,
    );
    expect(result.created).toBe(false);
    expect(folder().treeEntry('ok')?.translations).toEqual({ fr: 'Replace', es: 'Replace' });
    expect(folder().keys()).toEqual(['ok', 'keep']);
  });

  it('leaves an add unwritten on provider failure and detects a late existence conflict', async () => {
    const intent = {
      kind: 'add' as const,
      onExisting: 'fail' as const,
      changes: { baseValue: 'OK' },
    };
    const failure = new TranslationError('FAILED', 'provider failed', false);
    await expect(
      writeEntry(automatic(), 'buttons.ok', intent, {
        provider: new InMemoryTranslationProvider(() => {
          throw failure;
        }),
      }).then(requireAddResult),
    ).rejects.toBe(failure);
    expect(existsSync(join(root(), 'buttons'))).toBe(false);
    await expect(
      writeEntry(automatic(), 'buttons.ok', intent, {
        provider: new InMemoryTranslationProvider(() => {
          seedResources(collection(), { 'buttons.ok': { source: 'Late' } });
          return 'Translated';
        }),
      }).then(requireAddResult),
    ).rejects.toThrow(ResourceAlreadyExistsError);
    expect(folder().get('ok')?.entry.source).toBe('Late');
  });

  it('returns no changes and preserves both files and the sink for an unchanged edit', async () => {
    seed();
    const files = ['resource_entries.json', 'tracker_meta.json'].map((name) => join(root(), 'buttons', name));
    const before = files.map((file) => readFileSync(file, 'utf8'));
    const mutations: ResourceMutation[] = [];
    expect(
      await writeEntry(
        collection(),
        'buttons.ok',
        { kind: 'edit', changes: { baseValue: 'OK' } },
        { onMutation: (mutation) => mutations.push(mutation) },
      ).then(requireEditResult),
    ).toEqual({
      resolvedKey: 'buttons.ok',
      updated: false,
      message: 'No changes detected',
      entry: folder().treeEntry('ok'),
    });
    expect(files.map((file) => readFileSync(file, 'utf8'))).toEqual(before);
    expect(mutations).toEqual([]);
  });

  it('applies staleness, seeds copies, and changes an unchanged translation status', async () => {
    seed();
    const result = await writeEntry(collection(), 'buttons.ok', {
      kind: 'edit',
      changes: { baseValue: 'Save', translations: { es: { value: 'Aceptar', status: 'verified' } } },
    }).then(requireEditResult);
    expect(result.entry?.translations).toEqual({ fr: 'Save', es: 'Aceptar' });
    expect(result.entry?.metadata['fr'].status).toBe('new');
    expect(result.entry?.metadata['es'].status).toBe('verified');
    expect(result.entry?.metadata['fr'].baseChecksum).toBe(calculateChecksum('Save'));
    expect(folder().treeEntry('ok')).toEqual(result.entry);
  });

  it('saves phase one and its mutation before translation and keeps them on provider failure', async () => {
    seed();
    const mutations: ResourceMutation[] = [];
    const failure = new TranslationError('FAILED', 'provider failed', false);
    await expect(
      writeEntry(
        automatic(),
        'buttons.ok',
        { kind: 'edit', changes: { baseValue: 'Save' } },
        {
          onMutation: (mutation) => mutations.push(mutation),
          provider: new InMemoryTranslationProvider(() => {
            expect(folder().get('ok')?.entry.source).toBe('Save');
            expect(mutations.map(({ kind }) => kind)).toEqual(['upsert']);
            throw failure;
          }),
        },
      ).then(requireEditResult),
    ).rejects.toBe(failure);
    expect(folder().get('ok')?.entry.source).toBe('Save');
    expect(folder().get('ok')?.meta?.['es'].status).toBe('stale');
  });

  it('keeps concurrent target edits and siblings while reporting ordered skips and fresh mutations', async () => {
    seed();
    const mutations: ResourceMutation[] = [];
    const result = await writeEntry(
      automatic(),
      'buttons.ok',
      { kind: 'edit', changes: { baseValue: 'Save' } },
      {
        onMutation: (mutation) => mutations.push(mutation),
        provider: new InMemoryTranslationProvider(({ targetLocale }) => {
          if (targetLocale === 'fr') {
            const current = folder();
            current.setTranslation('ok', 'fr', 'Manual', 'verified');
            current.setBase('sibling', 'Sibling');
            current.save();
          }
          return `Translated ${targetLocale}`;
        }),
      },
    ).then(requireEditResult);
    expect(result.skippedLocales).toEqual(['fr']);
    expect(result.entry?.translations).toEqual({ fr: 'Manual', es: 'Translated es' });
    expect(folder().has('sibling')).toBe(true);
    expect(mutations.map(({ kind }) => kind)).toEqual(['upsert', 'upsert']);
    expect(mutations[1]).toEqual({
      kind: 'upsert',
      translationsFolder: root(),
      key: 'buttons.ok',
      entry: result.entry,
    });
  });

  it('skips all phase-two writes when the base changes and returns fresh disk state', async () => {
    seed();
    const result = await writeEntry(
      automatic(),
      'buttons.ok',
      { kind: 'translate' },
      {
        provider: new InMemoryTranslationProvider(() => {
          const current = folder();
          current.setBase('ok', 'Concurrent');
          current.save();
          return 'Translated';
        }),
      },
    ).then(requireTranslateResult);
    expect(result.translatedCount).toBe(0);
    expect(result.skippedLocales).toEqual(['fr']);
    expect(result.entry.source).toBe('Concurrent');
    expect(result.entry).toEqual(folder().treeEntry('ok'));
  });

  it('does not resurrect an entry deleted during translation', async () => {
    seed();
    await expect(
      writeEntry(
        automatic(),
        'buttons.ok',
        { kind: 'edit', changes: { baseValue: 'Save' } },
        {
          provider: new InMemoryTranslationProvider(() => {
            const current = folder();
            current.remove('ok');
            current.save();
            return 'Translated';
          }),
        },
      ).then(requireEditResult),
    ).rejects.toThrow(ResourceNotFoundError);
    expect(folder().has('ok')).toBe(false);
    expect(folder().has('keep')).toBe(true);
  });

  it('returns translator skips and warnings without writing skipped targets', async () => {
    seedResources(collection(), { 'buttons.ok': { source: '{count, plural, one {One} other {Many}}' } });
    const provider = new InMemoryTranslationProvider();
    const result = await writeEntry(
      testCollection(root(), {
        translationConfig: { enabled: true, provider: 'google-translate', apiKeyEnv: 'ENTRY_WRITE_TEST_KEY' },
        termFiles: {
          ...collection().termFiles,
          protectedTerms: { path: join(root(), 'missing.json'), explicit: true },
        },
      }),
      'buttons.ok',
      { kind: 'translate' },
      { provider },
    ).then(requireTranslateResult);
    expect(result.translatedCount).toBe(0);
    expect(result.skippedLocales).toEqual(['fr', 'es']);
    expect(result.warnings).toHaveLength(1);
    expect(provider.calls).toEqual([]);
    expect(result.entry.translations).toEqual({});
  });

  it('reports an emptied removal without pruning and uses the explicit sink over the default', () => {
    seedResources(collection(), { 'nested.child.ok': { source: 'OK' } });
    const inherited: ResourceMutation[] = [];
    const explicit: ResourceMutation[] = [];
    const result = removeEntry(
      testCollection(root(), { onMutation: (mutation) => inherited.push(mutation) }),
      'nested.child.ok',
      { onMutation: (mutation) => explicit.push(mutation) },
    );
    expect(result).toEqual({ resolvedKey: 'nested.child.ok', emptied: join(root(), 'nested', 'child') });
    expect(existsSync(join(root(), 'nested', 'child'))).toBe(true);
    expect(existsSync(join(root(), 'nested', 'child', 'resource_entries.json'))).toBe(false);
    expect(inherited).toEqual([]);
    expect(explicit).toEqual([{ kind: 'remove', translationsFolder: root(), key: 'nested.child.ok' }]);
    pruneEmptiedFolders(collection(), result.emptied ? [result.emptied] : [], {
      onMutation: (mutation) => explicit.push(mutation),
    });
    expect(explicit.map(({ kind }) => kind)).toEqual(['remove', 'remove-folder', 'remove-folder']);
  });

  it('moves a saved edit and prunes after remove/upsert mutations', async () => {
    seedResources(collection(), { 'nested.child.ok': { source: 'OK' } });
    const mutations: ResourceMutation[] = [];
    const result = await writeEntry(
      testCollection(root(), { onMutation: (mutation) => mutations.push(mutation) }),
      'nested.child.ok',
      { kind: 'edit', changes: { comment: 'Context', moveTo: 'shared' } },
    ).then(requireEditResult);
    expect(result.resolvedKey).toBe('shared.ok');
    expect(result.entry?.comment).toBe('Context');
    expect(existsSync(join(root(), 'nested'))).toBe(false);
    expect(mutations.map(({ kind }) => kind)).toEqual(['upsert', 'remove', 'upsert', 'remove-folder', 'remove-folder']);
  });
  it('returns advisory terminology under the final key after an edit moves the entry', async () => {
    seed();
    writeFileSync(
      collection().termFiles.preferredTerminology.path,
      JSON.stringify([{ discouraged: 'Expenditure', preferred: 'Investment', reason: 'Finance style guide' }]),
    );
    const result = await writeEntry(collection(), 'buttons.ok', {
      kind: 'edit',
      changes: { baseValue: 'Capital expenditure', moveTo: 'budget' },
    }).then(requireEditResult);
    expect(result.terminology).toEqual({
      findings: [
        {
          key: 'budget.ok',
          discouraged: 'Expenditure',
          preferred: 'Investment',
          reason: 'Finance style guide',
          message: 'consider "Investment" instead of "Expenditure"',
        },
      ],
      problems: [],
    });
    expect(result.entry.source).toBe('Capital expenditure');
  });
  it('skips a target edited during translation and returns its fresh value with unchanged siblings', async () => {
    seed();
    const mutations: ResourceMutation[] = [];
    const result = await writeEntry(
      automatic(),
      'buttons.ok',
      { kind: 'translate' },
      {
        provider: new InMemoryTranslationProvider(() => {
          const current = folder();
          current.setTranslation('ok', 'fr', 'Manual', 'verified');
          current.setBase('sibling', 'Sibling');
          current.save();
          return 'Translated';
        }),
        onMutation: (mutation) => mutations.push(mutation),
      },
    ).then(requireTranslateResult);
    expect(result.translatedCount).toBe(0);
    expect(result.skippedLocales).toEqual(['fr']);
    expect(result.entry.translations).toEqual({ fr: 'Manual', es: 'Aceptar' });
    expect(result.entry.metadata['fr'].status).toBe('verified');
    expect(result.entry).toEqual(folder().treeEntry('ok'));
    expect(folder().has('sibling')).toBe(true);
    expect(mutations).toEqual([]);
  });

  it('throws for an entry deleted during a translate write without resurrecting it', async () => {
    seed();
    const mutations: ResourceMutation[] = [];
    await expect(
      writeEntry(
        automatic(),
        'buttons.ok',
        { kind: 'translate' },
        {
          provider: new InMemoryTranslationProvider(() => {
            const current = folder();
            current.remove('ok');
            current.save();
            return 'Translated';
          }),
          onMutation: (mutation) => mutations.push(mutation),
        },
      ),
    ).rejects.toThrow(ResourceNotFoundError);
    expect(folder().has('ok')).toBe(false);
    expect(folder().has('keep')).toBe(true);
    expect(mutations).toEqual([]);
  });

  it('reports reindex and rethrows a failing translate write-back save', async () => {
    seed();
    const mutations: ResourceMutation[] = [];
    const failure = new Error('second file failed');
    const original = fileIO.writeJsonFile;
    let writes = 0;
    vi.spyOn(fileIO, 'writeJsonFile').mockImplementation((params) => {
      writes++;
      if (writes === 2) throw failure;
      return original(params);
    });
    await expect(
      writeEntry(
        automatic(),
        'buttons.ok',
        { kind: 'translate' },
        {
          provider: new InMemoryTranslationProvider(),
          onMutation: (mutation) => mutations.push(mutation),
        },
      ),
    ).rejects.toBe(failure);
    expect(writes).toBe(2);
    expect(mutations).toEqual([{ kind: 'reindex', translationsFolder: root() }]);
    expect(folder().get('ok')?.entry['fr']).toBe('[fr] OK');
    expect(folder().get('ok')?.meta?.['fr'].status).toBe('new');
    expect(folder().has('keep')).toBe(true);
  });
});
