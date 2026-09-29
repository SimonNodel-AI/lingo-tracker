import { HttpTestingController, type TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ResourceSummaryDto, SearchResultDto } from '@simoncodes-ca/data-transfer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectionSettings } from '../../../../testing/collection-settings';
import { getTranslocoTestingModule } from '../../../../testing/transloco-testing.module';
import { provideTrackerHttpClient } from '../../../shared/api-error/api-error';
import { NotificationService } from '../../../shared/notification';
import { TREE_NOT_READY_RETRIES, TREE_NOT_READY_RETRY_DELAY_MS } from '../../services/browser-api.service';
import { BrowserStore } from '../browser.store';

const entry = (fullKey: string): ResourceSummaryDto => {
  const segments = fullKey.split('.');
  const entryKey = segments.pop() ?? '';
  return {
    fullKey,
    folderPath: segments.join('.'),
    entryKey,
    base: { locale: 'en', value: fullKey },
    targets: [],
    tags: [],
    inheritedTags: [],
  };
};
const hit = (fullKey: string): SearchResultDto => ({ ...entry(fullKey), matchType: 'partial-value' });

const keys = (items: readonly ResourceSummaryDto[]): string[] => items.map((item) => item.fullKey);

/**
 * The List Scope through the real HTTP seam: every test shows scopes one after another and
 * checks what the list ends up showing, whether it is busy, and that no stale answer lands.
 */
describe('BrowserStore List Scope', () => {
  let store: InstanceType<typeof BrowserStore>;
  let http: HttpTestingController;
  const toastError = vi.fn();

  const url = (collection: string, endpoint: string) => `/api/collections/${collection}/resources/${endpoint}`;

  /** The list's read of one folder (the folder tree reads without nesting). */
  const listRead = (collection: string, path: string): TestRequest =>
    http.expectOne(
      (req) =>
        req.url === url(collection, 'tree') &&
        req.params.get('path') === path &&
        req.params.get('includeNested') === 'true',
    );
  const searchRead = (collection: string, query: string): TestRequest =>
    http.expectOne((req) => req.url === url(collection, 'search') && req.params.get('query') === query);

  const folder = (path: string, ...fullKeys: string[]) => ({ path, resources: fullKeys.map(entry), children: [] });
  const found = (query: string, ...fullKeys: string[]) => ({
    query,
    results: fullKeys.map(hit),
    totalFound: fullKeys.length,
    limited: false,
  });
  const notReady = { status: 'indexing', message: 'Collection is being indexed.' };

  /** Opens a collection whose index is ready: the folder tree and the list at the root both load. */
  function open(collection: string, ...rootKeys: string[]): void {
    store.openCollection(collectionSettings({ name: collection }));
    http.expectOne(url(collection, 'cache/status')).flush({ status: 'ready' });
    listRead(collection, '').flush(folder('', ...rootKeys));
    http
      .expectOne((req) => req.url === url(collection, 'tree') && req.params.get('includeNested') === 'false')
      .flush(folder(''));
  }

  beforeEach(() => {
    toastError.mockReset();
    TestBed.configureTestingModule({
      imports: [getTranslocoTestingModule()],
      providers: [
        provideTrackerHttpClient(),
        provideHttpClientTesting(),
        { provide: NotificationService, useValue: { error: toastError, success: vi.fn(), info: vi.fn() } },
      ],
    });
    store = TestBed.inject(BrowserStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  it('should show folder A, then a query, then folder B, each with its own rows and busy state', () => {
    open('app', 'welcome');

    store.showFolder('a');
    expect(store.isTranslationsLoading()).toBe(true);
    listRead('app', 'a').flush(folder('a', 'a.one'));
    expect(keys(store.sortedTranslations())).toEqual(['a.one']);
    expect(store.isTranslationsLoading()).toBe(false);

    store.showQuery('one');
    expect(store.isSearchLoading()).toBe(true);
    expect(store.isTranslationsLoading()).toBe(false);
    expect(store.isDisabled()).toBe(true);
    searchRead('app', 'one').flush(found('one', 'a.one', 'b.one'));
    expect(keys(store.sortedTranslations())).toEqual(['a.one', 'b.one']);
    expect(store.isSearchLoading()).toBe(false);

    store.showFolder('b');
    expect(store.isSearchMode()).toBe(false);
    expect(store.isDisabled()).toBe(false);
    listRead('app', 'b').flush(folder('b', 'b.one', 'b.two'));

    expect(store.currentFolderPath()).toBe('b');
    expect(keys(store.sortedTranslations())).toEqual(['b.one', 'b.two']);
    expect(store.isListLoading()).toBe(false);
  });

  it('should cancel the load of a scope the user has already left, so its answer never lands', () => {
    open('app');

    store.showFolder('a');
    const staleFolder = listRead('app', 'a');
    store.showQuery('save');
    const staleSearch = searchRead('app', 'save');
    store.showFolder('b');
    listRead('app', 'b').flush(folder('b', 'b.save'));

    expect(staleFolder.cancelled).toBe(true);
    expect(staleSearch.cancelled).toBe(true);
    expect(keys(store.sortedTranslations())).toEqual(['b.save']);
  });

  it('should not flash the hits of an earlier search while a new one loads', () => {
    open('app');
    store.showQuery('save');
    searchRead('app', 'save').flush(found('save', 'save'));
    store.clearSearch();

    store.showQuery('open');

    expect(store.sortedTranslations()).toEqual([]);
    searchRead('app', 'open').flush(found('open', 'open'));
    expect(keys(store.sortedTranslations())).toEqual(['open']);
  });

  it('should return to the folder behind a search without a request when its rows are loaded', () => {
    open('app', 'welcome');
    store.showQuery('save');
    searchRead('app', 'save').flush(found('save', 'x.save'));

    store.clearSearch();

    expect(store.isSearchMode()).toBe(false);
    expect(keys(store.sortedTranslations())).toEqual(['welcome']);
  });

  it('should load the folder behind a search when the search cut its load short', () => {
    open('app', 'welcome');
    store.showFolder('a');
    const cut = listRead('app', 'a');
    store.showQuery('save');
    searchRead('app', 'save').flush(found('save', 'x.save'));

    store.clearSearch();

    expect(cut.cancelled).toBe(true);
    expect(store.isTranslationsLoading()).toBe(true);
    listRead('app', 'a').flush(folder('a', 'a.one'));
    expect(keys(store.sortedTranslations())).toEqual(['a.one']);
  });

  it("should show a failed load as the list's error, and load the same scope again on Retry", () => {
    open('app');
    store.showQuery('save');
    searchRead('app', 'save').flush({ statusCode: 502, message: 'Search is down' }, { status: 502, statusText: 'Bad' });

    expect(store.error()).toBe('Search is down');
    expect(store.isSearchLoading()).toBe(false);

    store.retryLoad();
    expect(store.error()).toBeNull();
    searchRead('app', 'save').flush(found('save', 'save'));
    expect(keys(store.sortedTranslations())).toEqual(['save']);
  });

  it('should stay on the shown folder after a resource move, locked until the server answers', () => {
    open('app');
    store.showFolder('a');
    listRead('app', 'a').flush(folder('a', 'a.one', 'a.two'));

    store.moveResource({ sourceKey: 'a.one', destinationFolderPath: 'b' });
    expect(store.isDisabled()).toBe(true);
    expect(keys(store.sortedTranslations())).toEqual(['a.two']);
    http.expectOne(url('app', 'move')).flush({ movedCount: 1 });
    expect(store.isDisabled()).toBe(false);

    // The move reloads the folder tree and the list; the tree's answer must not move the list.
    http
      .expectOne((req) => req.url === url('app', 'tree') && req.params.get('includeNested') === 'false')
      .flush(folder('', 'root.entry'));
    listRead('app', 'a').flush(folder('a', 'a.two'));

    expect(store.currentFolderPath()).toBe('a');
    expect(keys(store.sortedTranslations())).toEqual(['a.two']);
  });

  it('should keep the shown list and folder, and toast, when the index is not ready after a list is up', () => {
    vi.useFakeTimers();
    open('app', 'welcome');

    store.showFolder('a');
    for (let attempt = 0; attempt <= TREE_NOT_READY_RETRIES; attempt++) {
      listRead('app', 'a').flush(notReady, { status: 202, statusText: 'Accepted' });
      vi.advanceTimersByTime(TREE_NOT_READY_RETRY_DELAY_MS);
    }

    expect(store.currentFolderPath()).toBe('');
    expect(keys(store.sortedTranslations())).toEqual(['welcome']);
    expect(store.isListLoading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(toastError).toHaveBeenCalledWith('Collection is being indexed.');
  });

  it('should stop retrying the previous collection once another one is opened', () => {
    vi.useFakeTimers();
    open('a', 'a.welcome');

    store.showFolder('slow');
    listRead('a', 'slow').flush(notReady, { status: 202, statusText: 'Accepted' });
    // B's index is still being checked, so B has sent no list load that could cancel A's.
    store.openCollection(collectionSettings({ name: 'b' }));
    http.expectOne(url('b', 'cache/status'));
    vi.advanceTimersByTime(TREE_NOT_READY_RETRIES * TREE_NOT_READY_RETRY_DELAY_MS);

    http.expectNone((req) => req.url.startsWith('/api/collections/a/'));
    // B's status poll kept asking meanwhile; it is not what this test is about.
    http.match(url('b', 'cache/status'));
    expect(store.sortedTranslations()).toEqual([]);
    expect(store.currentFolderPath()).toBe('');
    expect(toastError).not.toHaveBeenCalled();
  });
});
