import { TestBed } from '@angular/core/testing';
import { getState, patchState, signalStore, withMethods } from '@ngrx/signals';
import { unprotected } from '@ngrx/signals/testing';
import { NEVER } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectionSettings } from '../../../../testing/collection-settings';
import { getTranslocoTestingModule } from '../../../../testing/transloco-testing.module';
import { BrowserApiService } from '../../services/browser-api.service';
import { BrowserStore } from '../browser.store';
import { type CollectionResetRegistry, withCollectionResetRegistry, withCollectionState } from '../collection-reset';
import { initialRootState } from '../root-state';
import { withBrowserSessionFeature } from './with-browser-session.feature';

// This feature is deliberately composed after Browser Session, without editing that feature.
const cancelLoads = vi.fn<() => void>();
const ExtendedSession = signalStore(
  withCollectionResetRegistry(),
  withCollectionState(initialRootState),
  withMethods(() => ({
    restoreViewPreferences: vi.fn<(name: string) => void>(),
    checkCacheStatus: vi.fn<() => void>(),
    _cancelListLoads: cancelLoads,
  })),
  withBrowserSessionFeature(),
  withCollectionState({ extraCache: ['initial'] }),
);

describe('Browser Session reset registration', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [getTranslocoTestingModule()] }));

  it('registers every state key on the real BrowserStore for collection reset', () => {
    const store = TestBed.inject(BrowserStore);
    // NgRx hides underscore-prefixed props from public types, but retains them on the instance.
    const registry = store as unknown as CollectionResetRegistry;
    const registeredKeys = new Set(registry._collectionResets.flatMap(({ keys }) => keys));
    const stateKeys = Object.keys(getState(store)).sort();
    const unregisteredKeys = stateKeys.filter((key) => !registeredKeys.has(key));

    // Every BrowserStore state field is per-collection; there are no intentional exceptions.
    expect(
      [...registeredKeys].sort(),
      `Unregistered collection state keys: ${unregisteredKeys.join(', ') || '(none)'}. Use withCollectionState to declare per-collection state.`,
    ).toEqual(stateKeys);
  });

  it('resets a later feature on every open, including an earlier open of the same collection', () => {
    const store = TestBed.runInInjectionContext(() => new ExtendedSession());
    for (const name of ['a', 'b', 'a']) {
      patchState(unprotected(store), { extraCache: ['from the previous session'] });
      store.openCollection(collectionSettings({ name }));
      expect(store.extraCache()).toEqual(['initial']);
    }
    expect(store.sessionId()).toBe(3);
    expect(cancelLoads).toHaveBeenCalledTimes(3);
  });

  it('runs every registered feature reset and removes all previous collection state', () => {
    const store = TestBed.inject(BrowserStore);
    vi.spyOn(TestBed.inject(BrowserApiService), 'getCacheStatus').mockReturnValue(NEVER);
    store.openCollection(collectionSettings({ name: 'a' }));
    const initial = getState(store);
    // Give every registered slice foreign data, including fields with object-shaped state.
    patchState(unprotected(store), {
      translations: [
        {
          fullKey: 'old',
          folderPath: '',
          entryKey: 'old',
          base: { locale: 'en', value: 'old' },
          targets: [],
          tags: [],
          inheritedTags: [],
        },
      ],
      searchResults: [
        {
          fullKey: 'old',
          folderPath: '',
          entryKey: 'old',
          base: { locale: 'en', value: 'old' },
          targets: [],
          tags: [],
          inheritedTags: [],
          matchType: 'partial-value',
        },
      ],
      currentFolderPath: 'old',
      error: 'old',
      nonCompactSelectedLocales: ['old'],
      listScope: { kind: 'search', query: 'old' },
      loadedFolderPath: 'old',
      listError: 'old',
      showNestedResources: false,
      isListLoading: true,
      shownScope: { listScope: { kind: 'folder', path: 'old' }, currentFolderPath: 'old' },
      selectedLocales: ['old'],
      selectedStatuses: ['stale'],
      sortField: 'status',
      sortDirection: 'desc',
      rootFolders: [{ name: 'old', fullPath: 'old', loaded: false }],
      folderTreeLoaded: true,
      expandedFolders: new Set(['old']),
      preFilterExpandedFolders: new Set(['old']),
      isRootExpanded: false,
      folderTreeFilter: 'old',
      isFolderTreeLoading: true,
      isAddingFolder: true,
      addFolderParentPath: 'old',
      folderDraftId: 42,
      newlyCreatedFolderPath: 'old',
      isDeletingFolder: true,
      deletingFolderPath: 'old',
      movesInFlight: 3,
      cacheStatus: 'indexing',
      cacheError: 'old',
      collectionStats: { totalKeys: 10, localeCount: 2 },
    });
    store.openCollection(collectionSettings({ name: 'b' }));
    expect(getState(store)).toEqual({
      ...initial,
      sessionId: 2,
      selectedCollection: 'b',
      collectionSettings: collectionSettings({ name: 'b' }),
    });
  });
});
