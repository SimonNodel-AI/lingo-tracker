import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG_FILENAME } from '../constants';
import { loadConfig } from '../lib/config/load-config';
import { openCollection } from '../lib/config/open-collection';
import { ConfigChangedError, InvalidCollectionError } from '../lib/errors/lingo-tracker-error';
import { editCollectionTags } from './edit-collection-tags';

describe('editCollectionTags', () => {
  let cwd: string;
  const read = (): string => readFileSync(join(cwd, CONFIG_FILENAME), 'utf8');
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tags-'));
    writeFileSync(
      join(cwd, CONFIG_FILENAME),
      JSON.stringify({
        baseLocale: 'en',
        locales: ['en'],
        collections: { app: { translationsFolder: './app', tags: ['existing-tag'] } },
      }),
    );
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  const edit = (changes: Parameters<typeof editCollectionTags>[1]): string[] => {
    const collection = openCollection(loadConfig({ cwd }), 'app', { cwd });
    return editCollectionTags(collection, changes);
  };

  it('normalizes added tags and removes existing tags', () => {
    expect(edit({ add: ['New Feature'], remove: ['existing-tag'] })).toEqual(['new-feature']);
    expect(JSON.parse(read()).collections.app.tags).toEqual(['new-feature']);
  });

  it('set replaces and empty set clears tags', () => {
    expect(edit({ set: ['Alpha', 'beta', 'Alpha'] })).toEqual(['alpha', 'beta']);
    expect(edit({ set: [] })).toEqual([]);
    expect(JSON.parse(read()).collections.app.tags).toBeUndefined();
  });

  it('refuses mixed set and add without writing', () => {
    const before = read();
    let thrown: unknown;
    try {
      edit({ set: ['foo'], add: ['bar'] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidCollectionError);
    expect((thrown as InvalidCollectionError).kind).toBe('invalid');
    expect((thrown as InvalidCollectionError).problem).toBe('tag-conflict');
    expect(read()).toBe(before);
  });

  it('refuses a stale collection and keeps the other writer’s bytes', () => {
    const collection = openCollection(loadConfig({ cwd }), 'app', { cwd });
    const other = `${read()}\n`;
    writeFileSync(join(cwd, CONFIG_FILENAME), other);
    expect(() => editCollectionTags(collection, { add: ['new'] })).toThrow(ConfigChangedError);
    expect(read()).toBe(other);
  });

  it('refuses an empty edit without writing', () => {
    const before = read();
    let thrown: unknown;
    try {
      edit({});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidCollectionError);
    expect((thrown as InvalidCollectionError).problem).toBe('tag-missing');
    expect(read()).toBe(before);
  });
});
