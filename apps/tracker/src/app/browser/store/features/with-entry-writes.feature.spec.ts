import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { patchState } from '@ngrx/signals';
import { unprotected } from '@ngrx/signals/testing';
import type { ResourceSummaryDto, SearchResultDto } from '@simoncodes-ca/data-transfer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTranslocoTestingModule } from '../../../../testing/transloco-testing.module';
import { BrowserStore } from '../browser.store';

const RESOURCES_URL = '/api/collections/my-collection/resources';

const entry = (fullKey: string, en = fullKey, fr?: string): ResourceSummaryDto => {
  const segments = fullKey.split('.');
  const entryKey = segments.pop() ?? '';
  return {
    fullKey,
    folderPath: segments.join('.'),
    entryKey,
    base: { locale: 'en', value: en },
    targets: fr === undefined ? [] : [{ locale: 'fr', value: fr, needsWork: true, sameAsBase: fr === en }],
    tags: [],
    inheritedTags: [],
  };
};
const hit = (fullKey: string, en = fullKey): SearchResultDto => ({
  ...entry(fullKey, en),
  matchType: 'partial-value',
});

describe('BrowserStore entry writes', () => {
  let store: InstanceType<typeof BrowserStore>;
  let http: HttpTestingController;

  /** The folder list as the browser shows `common` with nested resources folded in. */
  const folderMode = (): void => {
    patchState(unprotected(store), {
      selectedCollection: 'my-collection',
      currentFolderPath: 'common',
      translations: [entry('common.save', 'Save'), entry('common.dialog.title', 'Title')],
    });
  };

  /** A search over the same collection, with the `common` folder list still behind it. */
  const searchMode = (): void => {
    folderMode();
    patchState(unprotected(store), {
      isSearchMode: true,
      searchQuery: 'sa',
      searchResults: [hit('common.save', 'Save'), hit('errors.save', 'Save')],
    });
  };

  const englishOf = (items: readonly ResourceSummaryDto[], fullKey: string): string | undefined =>
    items.find((item) => item.fullKey === fullKey)?.base.value;

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
      reload.flush({ path: 'common', resources: [entry('common.ok'), entry('common.save')], children: [] });

      expect(next).toHaveBeenCalledWith({ entriesCreated: 1, created: true });
      expect(store.translations().map((item) => item.fullKey)).toEqual(['common.ok', 'common.save']);
    });

    it('should cancel a folder load already in flight, so only the reload lands', () => {
      folderMode();
      const treeRequests = () => http.match((req) => req.url === `${RESOURCES_URL}/tree`);

      store.selectFolder('common');
      store.createResource('my-collection', { key: 'common.ok', baseValue: 'OK' }).subscribe();
      http.expectOne({ method: 'POST', url: RESOURCES_URL }).flush({ entriesCreated: 1, created: true });

      const [stale, reload] = treeRequests();
      expect(stale.cancelled).toBe(true);
      reload.flush({ path: 'common', resources: [entry('common.ok'), entry('common.save')], children: [] });

      expect(store.translations().map((item) => item.fullKey)).toEqual(['common.ok', 'common.save']);
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

    it('should patch the folder list under its full key', () => {
      folderMode();

      update('common.save', { resolvedKey: 'common.save', updated: true, resource: entry('common.save', 'Save now') });

      expect(englishOf(store.translations(), 'common.save')).toBe('Save now');
      expect(store.translations().map((item) => item.fullKey)).toEqual(['common.save', 'common.dialog.title']);
    });

    it('should patch a nested entry by its full key', () => {
      folderMode();

      update('common.dialog.title', {
        resolvedKey: 'common.dialog.title',
        updated: true,
        resource: entry('common.dialog.title', 'New'),
      });

      expect(englishOf(store.translations(), 'common.dialog.title')).toBe('New');
    });

    it('should patch both caches under the same full key', () => {
      searchMode();

      update('common.save', { resolvedKey: 'common.save', updated: true, resource: entry('common.save', 'Save now') });

      const result = store.searchResults().find((item) => item.fullKey === 'common.save');
      expect(result?.base.value).toBe('Save now');
      expect(result?.matchType).toBe('partial-value');
      expect(englishOf(store.searchResults(), 'errors.save')).toBe('Save');
      expect(englishOf(store.translations(), 'common.save')).toBe('Save now');
    });

    it('should patch a search result outside the folder list without touching the list', () => {
      searchMode();
      const listBefore = store.translations();

      update('errors.save', { resolvedKey: 'errors.save', updated: true, resource: entry('errors.save', 'Retry') });

      expect(englishOf(store.searchResults(), 'errors.save')).toBe('Retry');
      expect(store.translations()).toBe(listBefore);
    });

    it('should drop an entry sent to another folder from both caches', () => {
      searchMode();

      update('common.save', { resolvedKey: 'other.save', updated: true, resource: entry('other.save') }, 'other');

      expect(store.translations().map((item) => item.fullKey)).toEqual(['common.dialog.title']);
      expect(store.searchResults().map((item) => item.fullKey)).toEqual(['errors.save']);
    });

    it('should patch in place when the DTO carries no moveTo', () => {
      folderMode();

      store.updateResource('my-collection', { key: 'common.save', baseValue: 'Save now' }).subscribe();
      const patch = http.expectOne({ method: 'PATCH', url: RESOURCES_URL });
      expect('moveTo' in patch.request.body).toBe(false);
      patch.flush({ resolvedKey: 'common.save', updated: true, resource: entry('common.save', 'Save now') });

      expect(store.translations().map((item) => item.fullKey)).toEqual(['common.save', 'common.dialog.title']);
      expect(englishOf(store.translations(), 'common.save')).toBe('Save now');
    });

    it('should drop an entry moved to the collection root (an empty moveTo)', () => {
      folderMode();

      update('common.save', { resolvedKey: 'save', updated: true, resource: entry('save') }, '');

      expect(store.translations().map((item) => item.fullKey)).toEqual(['common.dialog.title']);
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

    it('should drop the entry from the folder list under its full key', () => {
      folderMode();

      remove('common.dialog.title', 1);

      expect(store.translations().map((item) => item.fullKey)).toEqual(['common.save']);
    });

    it('should drop a search result under its full key, and the folder row with it', () => {
      searchMode();

      remove('common.save', 1);

      expect(store.searchResults().map((item) => item.fullKey)).toEqual(['errors.save']);
      expect(store.translations().map((item) => item.fullKey)).toEqual(['common.dialog.title']);
    });

    it('should keep everything when the server deleted nothing', () => {
      folderMode();

      remove('common.save', 0);

      expect(store.translations().map((item) => item.fullKey)).toEqual(['common.save', 'common.dialog.title']);
    });

    it('should ignore a key that is not cached', () => {
      folderMode();

      remove('common.missing', 1);

      expect(store.translations().map((item) => item.fullKey)).toEqual(['common.save', 'common.dialog.title']);
    });
  });

  describe('translateResource', () => {
    const translate = (fullKey: string, resource: ResourceSummaryDto): void => {
      store.translateResource('my-collection', fullKey).subscribe();
      const request = http.expectOne({ method: 'POST', url: `${RESOURCES_URL}/translate` });
      expect(request.request.body).toEqual({ key: fullKey });
      request.flush({ resource, translatedCount: 1, skippedLocales: [] });
    };

    it('should patch a nested folder row by its full key', () => {
      folderMode();

      translate('common.dialog.title', entry('common.dialog.title', 'Title', 'Titre'));

      const row = store.translations().find((item) => item.fullKey === 'common.dialog.title');
      expect(row?.targets.find((target) => target.locale === 'fr')?.value).toBe('Titre');
    });

    it('should patch a search result under its full key', () => {
      searchMode();

      translate('common.save', entry('common.save', 'Save', 'Enregistrer'));

      expect(
        store
          .searchResults()
          .find((item) => item.fullKey === 'common.save')
          ?.targets.find((target) => target.locale === 'fr')?.value,
      ).toBe('Enregistrer');
      expect(
        store
          .translations()
          .find((item) => item.fullKey === 'common.save')
          ?.targets.find((target) => target.locale === 'fr')?.value,
      ).toBe('Enregistrer');
    });
  });
});
