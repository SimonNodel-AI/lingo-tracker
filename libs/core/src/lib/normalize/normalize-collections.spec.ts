import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { seedResources, testCollection, useTempDir, writeFolderFiles } from '../../testing/temp-dir.spec-helpers';
import type { ReadOnlyCollectionError } from '../errors';
import { normalizeCollections } from './normalize-collections';
import * as normalizeModule from './normalize';

describe('normalizeCollections', () => {
  const root = useTempDir('normalize-runs-');
  afterEach(() => vi.restoreAllMocks());

  it('refuses a named read-only collection with the existing typed error', async () => {
    await expect(normalizeCollections([testCollection(root(), { name: 'Lib', readOnly: true })])).rejects.toMatchObject(
      {
        name: 'ReadOnlyCollectionError',
        message: 'Collection "Lib" is read-only. Its resources cannot be modified.',
      } satisfies Partial<ReadOnlyCollectionError>,
    );
  });

  it('refuses a later read-only collection in a named selection before processing any', async () => {
    const events: string[] = [];
    await expect(
      normalizeCollections(
        [
          testCollection(join(root(), 'first'), { name: 'First' }),
          testCollection(join(root(), 'second'), { name: 'Second', readOnly: true }),
        ],
        { onEvent: (event) => events.push(event.kind) },
      ),
    ).rejects.toThrow('Collection "Second" is read-only. Its resources cannot be modified.');
    expect(events).toEqual([]);
  });

  it('skips read-only collections in all mode and totals writable results', async () => {
    const first = testCollection(join(root(), 'first'), { name: 'First' });
    const second = testCollection(join(root(), 'second'), { name: 'Second' });
    seedResources(first, { hello: { source: 'Hello' } });
    seedResources(second, { bye: { source: 'Bye' } });
    const result = await normalizeCollections(
      [first, testCollection(root(), { name: 'Lib', readOnly: true }), second],
      { all: true, dryRun: true },
    );
    expect(result.collections.map(({ collectionName }) => collectionName)).toEqual(['First', 'Second']);
    expect(result.totals).toEqual({
      collectionsProcessed: 2,
      entriesProcessed: 2,
      localesAdded: 4,
      valuesConverted: 0,
      tagsNormalized: 0,
      filesCreated: 0,
      filesUpdated: 4,
      foldersRemoved: 0,
    });
    expect(result.errors).toEqual([]);
    expect(result.outcome).toBe('succeeded');
  });

  it('continues after a collection fails and reports events in order', async () => {
    const blocked = join(root(), 'blocked');
    vi.spyOn(normalizeModule, 'normalize').mockRejectedValueOnce(new Error('disk full'));
    const next = testCollection(join(root(), 'next'), { name: 'Next' });
    seedResources(next, { hello: { source: 'Hello' } });
    const events: string[] = [];

    const result = await normalizeCollections([testCollection(blocked, { name: 'Broken' }), next], {
      all: true,
      onEvent: (event) =>
        events.push(`${event.kind}:${event.kind === 'result' ? event.result.collectionName : event.name}`),
    });

    expect(result.errors).toHaveLength(1);
    expect(result.outcome).toBe('failed');
    expect(result.errors[0]?.name).toBe('Broken');
    expect(result.collections.map(({ collectionName }) => collectionName)).toEqual(['Next']);
    expect(events).toEqual(['start:Broken', 'error:Broken', 'start:Next', 'result:Next']);
  });

  it('propagates a result event callback error', async () => {
    const collection = testCollection(root(), { name: 'Main' });
    await expect(
      normalizeCollections([collection], {
        onEvent: (event) => {
          if (event.kind === 'result') throw new Error('printer failed');
        },
      }),
    ).rejects.toThrow('printer failed');
  });

  it('fails when every collection fails, including in a dry run', async () => {
    vi.spyOn(normalizeModule, 'normalize').mockRejectedValue(new Error('disk full'));
    for (const dryRun of [false, true]) {
      const result = await normalizeCollections([testCollection(root())], { dryRun });
      expect(result.outcome).toBe('failed');
      expect(result.errors).toHaveLength(1);
      expect(result.collections).toEqual([]);
      expect(result.totals.collectionsProcessed).toBe(0);
    }
  });

  it('succeeds with only read-only skips or folder problems', async () => {
    const skipped = await normalizeCollections([testCollection(root(), { readOnly: true })], { all: true });
    expect(skipped.outcome).toBe('succeeded');
    expect(skipped.collections).toEqual([]);
    expect(skipped.errors).toEqual([]);

    writeFolderFiles(root(), 'broken', { entries: '{ invalid json' });
    const warned = await normalizeCollections([testCollection(root())]);
    expect(warned.collections[0]?.problems).toHaveLength(1);
    expect(warned.errors).toEqual([]);
    expect(warned.outcome).toBe('succeeded');
  });
});
