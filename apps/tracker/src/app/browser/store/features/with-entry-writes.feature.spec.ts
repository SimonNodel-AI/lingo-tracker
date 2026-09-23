import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { patchState } from '@ngrx/signals';
import type { ResourceSummaryDto, SearchResultDto } from '@simoncodes-ca/data-transfer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTranslocoTestingModule } from '../../../../testing/transloco-testing.module';
import { BrowserStore } from '../browser.store';
import { listKeyFor } from './with-entry-writes.feature';

const RESOURCES_URL = '/api/collections/my-collection/resources';

const entry = (key: string, en = key): ResourceSummaryDto => ({ key, translations: { en }, status: {} });
const hit = (key: string, en = key): SearchResultDto => ({ ...entry(key, en), matchType: 'value' });

describe('listKeyFor', () => {
  it.each<[string, string, string | undefined]>([
    ['common.save', '', 'common.save'],
    ['common.save', 'common', 'save'],
    ['common.dialog.title', 'common', 'dialog.title'],
    ['commonly.save', 'common', undefined],
    ['errors.save', 'common', undefined],
  ])('%s in the list of "%s" is %s', (fullKey, listFolderPath, expected) => {
    expect(listKeyFor(fullKey, listFolderPath)).toBe(expected);
  });
});

describe('BrowserStore entry writes', () => {
  let store: InstanceType<typeof BrowserStore>;
  let http: HttpTestingController;

  /** The folder list as the browser shows `common` with nested resources folded in. */
  const folderMode = (): void => {
    patchState(store, {
      selectedCollection: 'my-collection',
      currentFolderPath: 'common',
      translations: [entry('save', 'Save'), entry('dialog.title', 'Title')],
    });
  };

  /** A search over the same collection, with the `common` folder list still behind it. */
  const searchMode = (): void => {
    folderMode();
    patchState(store, {
      isSearchMode: true,
      searchQuery: 'sa',
      searchResults: [hit('common.save', 'Save'), hit('errors.save', 'Save')],
    });
  };

  const englishOf = (items: readonly ResourceSummaryDto[], key: string): string | undefined =>
    items.find((item) => item.key === key)?.translations['en'];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [getTranslocoTestingModule()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(BrowserStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  describe('createResource', () => {
    it('should post the DTO and reload the current folder so the list shows the new entry', () => {
      folderMode();
      const next = vi.fn();

      store.createResource('my-collection', { key: 'common.ok', baseValue: 'OK' }).subscribe(next);

      const post = http.expectOne({ method: 'POST', url: RESOURCES_URL });
      expect(post.request.body).toEqual({ key: 'common.ok', baseValue: 'OK' });
      post.flush({ entriesCreated: 1, created: true });

      const reload = http.expectOne((req) => req.url === `${RESOURCES_URL}/tree`);
      expect(reload.request.params.get('path')).toBe('common');
      reload.flush({ path: 'common', resources: [entry('ok'), entry('save')], children: [] });

      expect(next).toHaveBeenCalledWith({ entriesCreated: 1, created: true });
      expect(store.translations().map((item) => item.key)).toEqual(['ok', 'save']);
    });

    it('should cancel a folder load already in flight, so only the reload lands', () => {
      folderMode();
      const treeRequests = () => http.match((req) => req.url === `${RESOURCES_URL}/tree`);

      store.selectFolder('common');
      store.createResource('my-collection', { key: 'common.ok', baseValue: 'OK' }).subscribe();
      http.expectOne({ method: 'POST', url: RESOURCES_URL }).flush({ entriesCreated: 1, created: true });

      const [stale, reload] = treeRequests();
      expect(stale.cancelled).toBe(true);
      reload.flush({ path: 'common', resources: [entry('ok'), entry('save')], children: [] });

      expect(store.translations().map((item) => item.key)).toEqual(['ok', 'save']);
    });

    it('should hand a failure to the caller without reloading', () => {
      folderMode();
      const error = vi.fn();

      store.createResource('my-collection', { key: 'common.save', baseValue: 'Save' }).subscribe({ error });
      http
        .expectOne({ method: 'POST', url: RESOURCES_URL })
        .flush({ message: 'exists' }, { status: 409, statusText: 'Conflict' });

      expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 409 }));
      http.expectNone((req) => req.url === `${RESOURCES_URL}/tree`);
    });
  });

  describe('updateResource', () => {
    const update = (key: string, response: object, moveTo?: string): void => {
      store
        .updateResource('my-collection', { key, baseValue: 'x', ...(moveTo !== undefined ? { moveTo } : {}) })
        .subscribe();
      const patch = http.expectOne({ method: 'PATCH', url: RESOURCES_URL });
      expect(patch.request.body.key).toBe(key);
      patch.flush(response);
    };

    it('should patch the folder list under the key relative to its folder', () => {
      folderMode();

      update('common.save', { resolvedKey: 'common.save', updated: true, resource: entry('save', 'Save now') });

      expect(englishOf(store.translations(), 'save')).toBe('Save now');
      expect(store.translations().map((item) => item.key)).toEqual(['save', 'dialog.title']);
    });

    it('should keep the sub-path of a nested entry, which the API reports by its bare key', () => {
      folderMode();

      update('common.dialog.title', {
        resolvedKey: 'common.dialog.title',
        updated: true,
        resource: entry('title', 'New'),
      });

      expect(englishOf(store.translations(), 'dialog.title')).toBe('New');
    });

    it('should patch a search result under its full key and the folder list under its relative key', () => {
      searchMode();

      update('common.save', { resolvedKey: 'common.save', updated: true, resource: entry('save', 'Save now') });

      const result = store.searchResults().find((item) => item.key === 'common.save');
      expect(result?.translations['en']).toBe('Save now');
      expect(result?.matchType).toBe('value');
      expect(englishOf(store.searchResults(), 'errors.save')).toBe('Save');
      expect(englishOf(store.translations(), 'save')).toBe('Save now');
    });

    it('should patch a search result outside the folder list without touching the list', () => {
      searchMode();
      const listBefore = store.translations();

      update('errors.save', { resolvedKey: 'errors.save', updated: true, resource: entry('save', 'Retry') });

      expect(englishOf(store.searchResults(), 'errors.save')).toBe('Retry');
      expect(store.translations()).toBe(listBefore);
    });

    it('should drop an entry sent to another folder from both caches', () => {
      searchMode();

      update('common.save', { resolvedKey: 'other.save', updated: true, resource: entry('save') }, 'other');

      expect(store.translations().map((item) => item.key)).toEqual(['dialog.title']);
      expect(store.searchResults().map((item) => item.key)).toEqual(['errors.save']);
    });

    it('should patch in place when the DTO carries no moveTo', () => {
      folderMode();

      store.updateResource('my-collection', { key: 'common.save', baseValue: 'Save now' }).subscribe();
      const patch = http.expectOne({ method: 'PATCH', url: RESOURCES_URL });
      expect('moveTo' in patch.request.body).toBe(false);
      patch.flush({ resolvedKey: 'common.save', updated: true, resource: entry('save', 'Save now') });

      expect(store.translations().map((item) => item.key)).toEqual(['save', 'dialog.title']);
      expect(englishOf(store.translations(), 'save')).toBe('Save now');
    });

    it('should drop an entry moved to the collection root (an empty moveTo)', () => {
      folderMode();

      update('common.save', { resolvedKey: 'save', updated: true, resource: entry('save') }, '');

      expect(store.translations().map((item) => item.key)).toEqual(['dialog.title']);
    });

    it('should leave the caches alone when the response carries no resource', () => {
      folderMode();
      const before = store.translations();

      update('common.save', { resolvedKey: 'common.save', updated: false });

      expect(store.translations()).toBe(before);
    });

    it('should hand a failure to the caller and leave the caches alone', () => {
      folderMode();
      const before = store.translations();
      const error = vi.fn();

      store.updateResource('my-collection', { key: 'common.save', baseValue: 'x' }).subscribe({ error });
      http
        .expectOne({ method: 'PATCH', url: RESOURCES_URL })
        .flush({ message: 'gone' }, { status: 404, statusText: 'Not Found' });

      expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }));
      expect(store.translations()).toBe(before);
    });
  });

  describe('deleteResource', () => {
    const remove = (fullKey: string, entriesDeleted: number): void => {
      store.deleteResource('my-collection', fullKey).subscribe();
      const request = http.expectOne({ method: 'DELETE', url: RESOURCES_URL });
      expect(request.request.body).toEqual({ keys: [fullKey] });
      request.flush({ entriesDeleted });
    };

    it('should drop the entry from the folder list under its relative key', () => {
      folderMode();

      remove('common.dialog.title', 1);

      expect(store.translations().map((item) => item.key)).toEqual(['save']);
    });

    it('should drop a search result under its full key, and the folder row with it', () => {
      searchMode();

      remove('common.save', 1);

      expect(store.searchResults().map((item) => item.key)).toEqual(['errors.save']);
      expect(store.translations().map((item) => item.key)).toEqual(['dialog.title']);
    });

    it('should keep everything when the server deleted nothing', () => {
      folderMode();

      remove('common.save', 0);

      expect(store.translations().map((item) => item.key)).toEqual(['save', 'dialog.title']);
    });

    it('should ignore a key that is not cached', () => {
      folderMode();

      remove('common.missing', 1);

      expect(store.translations().map((item) => item.key)).toEqual(['save', 'dialog.title']);
    });
  });

  describe('translateResource', () => {
    const translate = (fullKey: string, resource: ResourceSummaryDto): void => {
      store.translateResource('my-collection', fullKey).subscribe();
      const request = http.expectOne({ method: 'POST', url: `${RESOURCES_URL}/translate` });
      expect(request.request.body).toEqual({ key: fullKey });
      request.flush({ resource, translatedCount: 1, skippedLocales: [] });
    };

    it('should patch the folder list, rewriting the bare API key to the relative one', () => {
      folderMode();

      translate('common.dialog.title', { key: 'title', translations: { en: 'Title', fr: 'Titre' }, status: {} });

      const row = store.translations().find((item) => item.key === 'dialog.title');
      expect(row?.translations['fr']).toBe('Titre');
    });

    it('should patch a search result under its full key', () => {
      searchMode();

      translate('common.save', { key: 'save', translations: { en: 'Save', fr: 'Enregistrer' }, status: {} });

      expect(store.searchResults().find((item) => item.key === 'common.save')?.translations['fr']).toBe('Enregistrer');
      expect(store.translations().find((item) => item.key === 'save')?.translations['fr']).toBe('Enregistrer');
    });
  });
});
