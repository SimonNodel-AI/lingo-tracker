import { signal } from '@angular/core';
import type { ResourceSummaryDto } from '@simoncodes-ca/data-transfer';
import { type Observable, of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { EditorLocation, type EditorLocationOptions } from './editor-location';

const entry = (fullKey: string): ResourceSummaryDto => {
  const parts = fullKey.split('.');
  const entryKey = parts.pop() ?? '';
  return {
    fullKey,
    folderPath: parts.join('.'),
    entryKey,
    base: { locale: 'en', value: entryKey },
    targets: [],
    tags: [],
    inheritedTags: [],
  };
};

function setup(overrides: Partial<EditorLocationOptions> = {}) {
  const folderEntries = signal<ReadonlyMap<string, readonly string[]>>(new Map());
  const loadingFolders = signal<ReadonlySet<string>>(new Set());
  const responses = new Map<string, string[]>();
  const peekFolder = vi.fn((_collection: string, path: string): Observable<unknown> => {
    folderEntries.update((loaded) => new Map(loaded).set(path, responses.get(path) ?? []));
    return of(undefined);
  });
  const location = new EditorLocation({
    collectionName: 'test',
    mode: 'create',
    rootFolders: signal([]),
    browserFolderPath: signal(''),
    browserEntries: signal([]),
    peek: { folderEntries, loadingFolders, peekFolder },
    moreLabel: (hidden) => `+${hidden} more`,
    ...overrides,
  });
  return { location, folderEntries, loadingFolders, responses, peekFolder };
}

describe('EditorLocation', () => {
  it('extends the absorbed folder when typing a. then b.', () => {
    const { location } = setup();

    expect(location.typeKey('a.')).toEqual({ leaf: '', folder: 'a' });
    expect(location.typeKey('b.')).toEqual({ leaf: '', folder: 'a.b' });
    expect(location.selectedFolderPath()).toBe('a.b');
    expect(location.fullKeyPreview()).toBe('a.b');
  });

  it('reanchors a dotted key after the user picks a folder', () => {
    const { location } = setup();

    location.typeKey('a.');
    location.pick('chosen.folder');
    expect(location.typeKey('b.ok')).toEqual({ leaf: 'ok', folder: 'b' });
    expect(location.selectedFolderPath()).toBe('b');
    expect(location.fullKeyPreview()).toBe('b.ok');
  });

  it('selects a created folder and resets dotted-key continuation', () => {
    const { location } = setup();

    location.typeKey('a.');
    location.pick('common.new');

    expect(location.selectedFolderPath()).toBe('common.new');
    expect(location.typeKey('b.ok')).toEqual({ leaf: 'ok', folder: 'b' });
    expect(location.fullKeyPreview()).toBe('b.ok');
  });

  it('uses a picked folder for the preview and collision', () => {
    const { location, responses, peekFolder } = setup();
    responses.set('common.errors', ['save']);

    location.typeKey('save');
    location.pick('common.buttons');
    expect(location.selectedFolderPath()).toBe('common.buttons');
    expect(location.keyCollision()).toBe(false);

    location.pick('common.errors');
    expect(location.selectedFolderPath()).toBe('common.errors');
    expect(location.fullKeyPreview()).toBe('common.errors.save');
    expect(location.keyCollision()).toBe(true);
    expect(peekFolder).toHaveBeenCalledWith('test', 'common.errors');
  });

  it('seeds the key view when typeKey receives the initial value', () => {
    const { location } = setup({ browserEntries: signal([entry('save')]) });

    expect(location.typeKey('save')).toBeNull();
    expect(location.fullKeyPreview()).toBe('save');
    expect(location.keyCollision()).toBe(true);
  });

  it('detects a collision when an edit moves into a folder holding its key', () => {
    const original = entry('common.buttons.save');
    const { location, responses, peekFolder } = setup({ mode: 'edit', original });
    responses.set('common.errors', ['save']);

    location.pick(original.folderPath);
    location.typeKey(original.entryKey);
    location.pick('common.errors');

    expect(peekFolder).toHaveBeenCalledWith('test', 'common.errors');
    expect(location.keyCollision()).toBe(true);
    expect(location.contextTree().find((node) => node.kind === 'entry' && node.name === 'save')?.mark).toBe('exists');
  });

  it('does not collide with the edited entry in its original folder', () => {
    const original = entry('common.buttons.save');
    const { location, peekFolder } = setup({
      mode: 'edit',
      original,
      browserFolderPath: signal(original.folderPath),
      browserEntries: signal([original]),
    });

    location.pick(original.folderPath);
    location.typeKey(original.entryKey);

    expect(peekFolder).not.toHaveBeenCalled();
    expect(location.keyCollision()).toBe(false);
    expect(location.contextTree().find((node) => node.kind === 'entry' && node.name === 'save')?.mark).toBe('editing');
  });

  it('exempts the own key again when an edit moves away and back', () => {
    const original = entry('common.buttons.save');
    const { location, responses, peekFolder } = setup({ mode: 'edit', original });
    responses.set(original.folderPath, ['save']);
    responses.set('common.errors', ['save']);

    location.pick(original.folderPath);
    location.typeKey(original.entryKey);
    expect(location.keyCollision()).toBe(false);

    location.pick('common.errors');
    expect(location.keyCollision()).toBe(true);

    location.pick(original.folderPath);
    expect(location.keyCollision()).toBe(false);
    expect(peekFolder.mock.calls.filter((call) => call[1] === original.folderPath)).toHaveLength(1);
  });

  it('peeks an unknown original folder and detects a sibling-key rename', () => {
    const original = entry('common.buttons.save');
    const { location, responses, peekFolder } = setup({ mode: 'edit', original });
    responses.set(original.folderPath, ['save', 'cancel']);

    location.pick(original.folderPath);
    location.typeKey('cancel');

    expect(peekFolder).toHaveBeenCalledWith('test', original.folderPath);
    expect(location.keyCollision()).toBe(true);
    expect(location.contextTree().find((node) => node.kind === 'entry' && node.name === 'cancel')?.mark).toBe('exists');
  });

  it('peeks once per folder and does not start another read while loading', () => {
    const pending = new Subject<unknown>();
    const { location, folderEntries, loadingFolders, peekFolder } = setup();
    peekFolder.mockImplementation((_collection: string, path: string) => {
      loadingFolders.set(new Set([path]));
      return pending;
    });

    location.pick('common.errors');
    location.pick('common.errors');
    expect(peekFolder).toHaveBeenCalledTimes(1);

    folderEntries.set(new Map([['common.errors', ['save']]]));
    loadingFolders.set(new Set());
    pending.complete();
    location.pick('common.errors');
    expect(peekFolder).toHaveBeenCalledTimes(1);

    location.pick('common.other');
    location.pick('common.other');
    expect(peekFolder).toHaveBeenCalledTimes(2);
    location.destroy();
  });
});
