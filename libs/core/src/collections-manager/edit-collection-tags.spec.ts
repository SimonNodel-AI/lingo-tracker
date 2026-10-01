import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG_FILENAME } from '../constants';
import { createConfigFileOperations } from '../lib/config/config-file-operations';
import { openCollection } from '../lib/config/open-collection';
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

  const edit = (changes: Parameters<typeof editCollectionTags>[2]): string[] => {
    const configFile = createConfigFileOperations({ cwd });
    return editCollectionTags(openCollection(configFile.read(), 'app', { cwd }), configFile, changes);
  };

  it('normalizes added tags and removes existing tags', () => {
    expect(edit({ add: ['New Feature'], remove: ['existing-tag'] })).toEqual(['new-feature']);
    expect(JSON.parse(read()).collections.app.tags).toEqual(['new-feature']);
  });

  it('set replaces and empty set clears tags', () => {
    expect(edit({ set: 'Alpha, beta, Alpha' })).toEqual(['alpha', 'beta']);
    expect(edit({ set: '' })).toEqual([]);
    expect(JSON.parse(read()).collections.app.tags).toBeUndefined();
  });

  it('refuses mixed set and add without writing', () => {
    const before = read();
    expect(() => edit({ set: 'foo', add: ['bar'] })).toThrow(InvalidCollectionError);
    expect(read()).toBe(before);
  });

  it('refuses an empty edit without writing', () => {
    const before = read();
    expect(() => edit({})).toThrow(InvalidCollectionError);
    expect(read()).toBe(before);
  });
});
