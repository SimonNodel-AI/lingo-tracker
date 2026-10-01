import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG_FILENAME } from '../constants';
import { InvalidCollectionError } from '../lib/errors/lingo-tracker-error';
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

  it('normalizes added tags and removes existing tags', () => {
    expect(editCollectionTags('app', { add: ['New Feature'], remove: ['existing-tag'] }, { cwd })).toEqual([
      'new-feature',
    ]);
    expect(JSON.parse(read()).collections.app.tags).toEqual(['new-feature']);
  });

  it('set replaces and empty set clears tags', () => {
    expect(editCollectionTags('app', { set: ['Alpha', 'beta', 'Alpha'] }, { cwd })).toEqual(['alpha', 'beta']);
    expect(editCollectionTags('app', { set: [] }, { cwd })).toEqual([]);
    expect(JSON.parse(read()).collections.app.tags).toBeUndefined();
  });

  it('refuses mixed set and add without writing', () => {
    const before = read();
    let thrown: unknown;
    try {
      editCollectionTags('app', { set: ['foo'], add: ['bar'] }, { cwd });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidCollectionError);
    expect((thrown as InvalidCollectionError).kind).toBe('invalid');
    expect(read()).toBe(before);
  });

  it('refuses an empty edit without writing', () => {
    const before = read();
    expect(() => editCollectionTags('app', {}, { cwd })).toThrow(InvalidCollectionError);
    expect(read()).toBe(before);
  });
});
