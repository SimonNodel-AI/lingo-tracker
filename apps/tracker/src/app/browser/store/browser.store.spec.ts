import { HttpClientTestingModule } from '@angular/common/http/testing';
import { createServiceFactory, type SpectatorService } from '@ngneat/spectator/vitest';
import type {
  CacheStatusDto,
  ResourceSummaryDto,
  ResourceTreeDto,
  TranslationStatus,
} from '@simoncodes-ca/data-transfer';
import { NEVER, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTranslocoTestingModule } from '../../../testing/transloco-testing.module';
import { NotificationService } from '../../shared/notification';
import { BrowserApiService, CollectionIndexNotReadyError } from '../services/browser-api.service';
import { BrowserStore } from './browser.store';

/**
 * Helper to wait for async signal updates from rxMethod.
 * RxJS observables in rxMethod complete asynchronously, so we need
 * to wait for multiple microtasks to allow signals to update.
 * We use a small delay to ensure all async operations complete.
 */
const waitForSignals = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

const summary = (
  fullKey: string,
  baseValue: string,
  targets: Record<string, [string | undefined, TranslationStatus | undefined]> = {},
): ResourceSummaryDto => {
  const segments = fullKey.split('.');
  const entryKey = segments.pop() ?? '';
  return {
    fullKey,
    folderPath: segments.join('.'),
    entryKey,
    base: { locale: 'en', value: baseValue },
    targets: Object.entries(targets).map(([locale, [value, status]]) => ({
      locale,
      value,
      status,
      needsWork: status === undefined || status === 'new' || status === 'stale',
      sameAsBase: (value?.trim() ?? '').length > 0 && value?.trim() === baseValue.trim(),
    })),
    tags: [],
    inheritedTags: [],
  };
};

describe('BrowserStore', () => {
  let store: InstanceType<typeof BrowserStore>;
  let spectator: SpectatorService<InstanceType<typeof BrowserStore>>;
  let apiService: BrowserApiService;

  const mockTreeRoot: ResourceTreeDto = {
    path: '',
    resources: [summary('welcome', 'Welcome', { es: ['Bienvenido', 'translated'] })],
    children: [
      { name: 'common', fullPath: 'common', loaded: false },
      { name: 'errors', fullPath: 'errors', loaded: false },
    ],
  };

  const mockTreeCommon: ResourceTreeDto = {
    path: 'common',
    resources: [summary('common.save', 'Save', { es: ['Guardar', 'translated'] })],
    children: [{ name: 'buttons', fullPath: 'common.buttons', loaded: false }],
  };

  const mockTreeWithNesting: ResourceTreeDto = {
    path: '',
    resources: [],
    children: [
      {
        name: 'common',
        fullPath: 'common',
        loaded: true,
        tree: {
          path: 'common',
          resources: [],
          children: [{ name: 'buttons', fullPath: 'common.buttons', loaded: true }],
        },
      },
      {
        name: 'errors',
        fullPath: 'errors',
        loaded: true,
        tree: {
          path: 'errors',
          resources: [],
          children: [{ name: 'http', fullPath: 'errors.http', loaded: true }],
        },
      },
    ],
  };

  const mockCacheReady: CacheStatusDto = {
    status: 'ready',
    stats: {
      totalKeys: 100,
      localeCount: 3,
    },
  };

  const createStore = createServiceFactory({
    service: BrowserStore,
    imports: [HttpClientTestingModule, getTranslocoTestingModule()],
    providers: [BrowserApiService],
  });

  beforeEach(() => {
    spectator = createStore();
    store = spectator.service;
    apiService = spectator.inject(BrowserApiService);
  });

  describe('Initialization', () => {
    it('should create store with default state', () => {
      expect(store.selectedCollection()).toBeNull();
      expect(store.availableLocales()).toEqual([]);
      expect(store.currentFolderPath()).toBe('');
      expect(store.expandedFolders()).toEqual(new Set());
      expect(store.rootFolders()).toEqual([]);
      expect(store.folderTreeFilter()).toBe('');
      expect(store.isFolderTreeLoading()).toBe(false);
      expect(store.translations()).toEqual([]);
      expect(store.isTranslationsLoading()).toBe(false);
      expect(store.isDisabled()).toBe(false);
      expect(store.error()).toBeNull();
    });
  });

  describe('Collection Selection', () => {
    it('should show indexing state while the initial cache status request is pending', () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(NEVER);

      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: ['en', 'es'],
      });

      expect(store.cacheStatus()).toBe('not-started');
      expect(store.isCacheIndexing()).toBe(true);
    });

    it('should set selected collection and load root folders', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));

      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: ['en', 'es', 'de'],
      });

      expect(store.selectedCollection()).toBe('app-translations');
      expect(store.availableLocales()).toEqual(['en', 'es', 'de']);

      await waitForSignals();

      expect(store.rootFolders()).toEqual(mockTreeRoot.children);
      expect(store.translations()).toEqual(mockTreeRoot.resources);
      expect(store.isFolderTreeLoading()).toBe(false);
    });

    it('should reset state when switching collections', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));

      // Select first collection
      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: ['en', 'es'],
      });
      store.setFolderTreeFilter('test');
      store.selectFolder('common');

      // Switch to second collection
      store.setSelectedCollection({
        collectionName: 'website-translations',
        locales: ['en', 'fr'],
      });

      expect(store.folderTreeFilter()).toBe('');
      expect(store.currentFolderPath()).toBe('');
      expect(store.selectedCollection()).toBe('website-translations');
      expect(store.availableLocales()).toEqual(['en', 'fr']);

      await waitForSignals();
    });

    it('should clear nonCompactSelectedLocales when switching collections', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));

      // Select first collection — initial densityMode is 'compact'
      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: ['en', 'es', 'de'],
      });

      // Switch to full mode, then select multiple locales, then back to compact.
      // Entering compact saves selectedLocales into nonCompactSelectedLocales.
      store.setDensityMode('full');
      store.setSelectedLocales(['en', 'es', 'de']);
      store.setDensityMode('compact');

      expect(store.nonCompactSelectedLocales()).toEqual(['en', 'es', 'de']);

      // Switch to a different collection — nonCompactSelectedLocales must be cleared
      store.setSelectedCollection({
        collectionName: 'website-translations',
        locales: ['en', 'fr'],
      });

      expect(store.nonCompactSelectedLocales()).toEqual([]);

      await waitForSignals();
    });
  });

  describe('Folder Tree Loading', () => {
    it('should load root folders successfully when cache is ready', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));

      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: ['en', 'es'],
      });

      await waitForSignals();

      expect(store.rootFolders()).toEqual(mockTreeRoot.children);
      expect(store.translations()).toEqual(mockTreeRoot.resources);
      expect(store.currentFolderPath()).toBe('');
      expect(store.isFolderTreeLoading()).toBe(false);
      expect(store.error()).toBeNull();
    });

    it('should handle root folder loading errors', async () => {
      const error = new Error('Collection not found');
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(throwError(() => error));

      store.setSelectedCollection({
        collectionName: 'nonexistent',
        locales: [],
      });

      await waitForSignals();

      expect(store.rootFolders()).toEqual([]);
      expect(store.isFolderTreeLoading()).toBe(false);
      expect(store.error()).toBe('Collection not found');
    });

    it('should keep the already-loaded root folders when the index is still not ready after the retries', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      const getTree = vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));
      const notifyError = vi.spyOn(spectator.inject(NotificationService), 'error').mockImplementation(() => undefined);

      store.setSelectedCollection({ collectionName: 'app-translations', locales: ['en', 'es'] });
      await waitForSignals();
      expect(store.rootFolders()).toEqual(mockTreeRoot.children);

      getTree.mockReturnValue(throwError(() => new CollectionIndexNotReadyError('Collection is being indexed.')));
      store.loadRootFolders();
      await waitForSignals();

      expect(store.rootFolders()).toEqual(mockTreeRoot.children);
      expect(store.translations()).toEqual(mockTreeRoot.resources);
      expect(store.isFolderTreeLoading()).toBe(false);
      expect(store.error()).toBeNull();
      expect(notifyError).toHaveBeenCalledWith('Collection is being indexed.');
    });

    it('should set loading state during folder tree fetch', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));

      expect(store.isFolderTreeLoading()).toBe(false);

      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: [],
      });

      await waitForSignals();

      // After observable completes, loading should be false
      expect(store.isFolderTreeLoading()).toBe(false);
    });
  });

  describe('Folder Children Loading', () => {
    it('should load folder children and update tree', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree')
        .mockReturnValueOnce(of(mockTreeRoot))
        .mockReturnValueOnce(of(mockTreeCommon));

      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: ['en', 'es'],
      });

      await waitForSignals();

      store.loadFolderChildren('common');

      await waitForSignals();

      const rootFolders = store.rootFolders();
      const commonFolder = rootFolders.find((f) => f.fullPath === 'common');

      expect(commonFolder).toBeDefined();
      expect(commonFolder?.loaded).toBe(true);
      expect(commonFolder?.tree).toEqual(mockTreeCommon);
      expect(store.isFolderTreeLoading()).toBe(false);
    });

    it('should handle folder children loading errors', async () => {
      const error = new Error('api error: load folder children');
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree')
        .mockReturnValueOnce(of(mockTreeRoot))
        .mockReturnValueOnce(throwError(() => error));

      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: [],
      });

      await waitForSignals();

      store.loadFolderChildren('common');

      await waitForSignals();

      expect(store.isFolderTreeLoading()).toBe(false);
      expect(store.error()).toBe('api error: load folder children');
    });
  });

  describe('Folder Selection and Translation Loading', () => {
    it('should select folder and load its translations', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree')
        .mockReturnValueOnce(of(mockTreeRoot))
        .mockReturnValueOnce(of(mockTreeCommon));

      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: ['en', 'es'],
      });

      await waitForSignals();

      store.selectFolder('common');

      await waitForSignals();

      expect(store.currentFolderPath()).toBe('common');
      expect(store.translations()).toEqual(mockTreeCommon.resources);
      expect(store.isTranslationsLoading()).toBe(false);
      expect(store.error()).toBeNull();
    });

    it('should handle translation loading errors', async () => {
      const error = new Error('api error: load translations');
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree')
        .mockReturnValueOnce(of(mockTreeRoot))
        .mockReturnValueOnce(throwError(() => error));

      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: [],
      });

      await waitForSignals();

      store.selectFolder('common');

      await waitForSignals();

      expect(store.currentFolderPath()).toBe('common');
      expect(store.isTranslationsLoading()).toBe(false);
      expect(store.error()).toBe('api error: load translations');
    });

    it('should keep the tree and the shown list, and notify, when the index is still not ready after the retries', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree')
        .mockReturnValueOnce(of(mockTreeRoot))
        .mockReturnValueOnce(throwError(() => new CollectionIndexNotReadyError('Collection is being indexed.')));
      const notifyError = vi.spyOn(spectator.inject(NotificationService), 'error').mockImplementation(() => undefined);

      store.setSelectedCollection({ collectionName: 'app-translations', locales: [] });
      await waitForSignals();

      store.selectFolder('common');
      await waitForSignals();

      expect(store.rootFolders()).toEqual(mockTreeRoot.children);
      expect(store.translations()).toEqual(mockTreeRoot.resources);
      expect(store.currentFolderPath()).toBe('');
      expect(store.isTranslationsLoading()).toBe(false);
      expect(store.error()).toBeNull();
      expect(notifyError).toHaveBeenCalledWith('Collection is being indexed.');
    });

    it('should set loading state during translation fetch', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree')
        .mockReturnValueOnce(of(mockTreeRoot))
        .mockReturnValueOnce(of(mockTreeCommon));

      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: [],
      });

      await waitForSignals();

      expect(store.isTranslationsLoading()).toBe(false);

      store.selectFolder('common');

      await waitForSignals();

      // After observable completes, loading should be false
      expect(store.isTranslationsLoading()).toBe(false);
    });
  });

  describe('Folder Tree Filter', () => {
    it('should update folder tree filter', () => {
      store.setFolderTreeFilter('common');
      expect(store.folderTreeFilter()).toBe('common');
    });

    it('should filter folders based on search term', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));

      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: [],
      });

      await waitForSignals();

      store.setFolderTreeFilter('common');
      const filtered = store.filteredFolders();

      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('common');
    });

    it('should return all folders when filter is empty', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));

      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: [],
      });

      await waitForSignals();

      store.setFolderTreeFilter('');
      const filtered = store.filteredFolders();

      expect(filtered).toEqual(mockTreeRoot.children);
    });
  });

  describe('Folder Expansion', () => {
    it('should toggle folder expanded state', () => {
      expect(store.expandedFolders().has('common')).toBe(false);

      store.toggleFolderExpanded('common');
      expect(store.expandedFolders().has('common')).toBe(true);

      store.toggleFolderExpanded('common');
      expect(store.expandedFolders().has('common')).toBe(false);
    });

    it('should track multiple expanded folders', () => {
      store.toggleFolderExpanded('common');
      store.toggleFolderExpanded('errors');

      expect(store.expandedFolders().has('common')).toBe(true);
      expect(store.expandedFolders().has('errors')).toBe(true);
    });

    it('should open a folder without closing it when already open', () => {
      store.expandFolder('common');
      store.expandFolder('common');

      expect(store.expandedFolders().has('common')).toBe(true);
    });

    it('should reveal the selected folder by expanding its ancestors only', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeCommon));

      store.setSelectedCollection({ collectionName: 'app-translations', locales: [] });
      await waitForSignals();

      store.selectFolder('common.buttons.primary');
      await waitForSignals();

      // Ancestors are revealed; the selection itself is not opened, and the stored set is untouched.
      expect(store.visibleExpandedFolders().has('common')).toBe(true);
      expect(store.visibleExpandedFolders().has('common.buttons')).toBe(true);
      expect(store.visibleExpandedFolders().has('common.buttons.primary')).toBe(false);
      expect(store.expandedFolders().size).toBe(0);
    });

    it('should start with the root expanded', () => {
      expect(store.isRootExpanded()).toBe(true);
    });

    it('should toggle the root row', () => {
      store.toggleRootExpanded();
      expect(store.isRootExpanded()).toBe(false);

      store.toggleRootExpanded();
      expect(store.isRootExpanded()).toBe(true);
    });

    it('should expand every folder in view and leave the root open', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeWithNesting));

      store.setSelectedCollection({ collectionName: 'app-translations', locales: [] });
      await waitForSignals();

      expect(store.areAllFoldersExpanded()).toBe(false);

      store.expandAllFolders();

      expect(store.expandedFolders().has('common')).toBe(true);
      expect(store.expandedFolders().has('errors')).toBe(true);
      // A folder with no child folders has nothing to open, so it never enters the set.
      expect(store.expandedFolders().has('common.buttons')).toBe(false);
      expect(store.areAllFoldersExpanded()).toBe(true);
      expect(store.isRootExpanded()).toBe(true);
    });

    it('should collapse every folder but keep the root open', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeWithNesting));

      store.setSelectedCollection({ collectionName: 'app-translations', locales: [] });
      await waitForSignals();

      store.expandAllFolders();
      store.collapseAllFolders();

      expect(store.expandedFolders().size).toBe(0);
      expect(store.isRootExpanded()).toBe(true);
    });

    it('should open branches holding matches while filtering and restore expansion on clear', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeWithNesting));

      store.setSelectedCollection({ collectionName: 'app-translations', locales: [] });
      await waitForSignals();

      store.toggleFolderExpanded('errors');

      store.setFolderTreeFilter('buttons');

      // The branch leading to the match is open; the user's unrelated branch is set aside.
      expect(store.expandedFolders().has('common')).toBe(true);
      expect(store.expandedFolders().has('errors')).toBe(false);

      store.setFolderTreeFilter('');

      expect(store.expandedFolders().has('errors')).toBe(true);
      expect(store.expandedFolders().has('common')).toBe(false);
    });

    it('should prune expanded paths under a deleted folder', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeWithNesting));
      vi.spyOn(apiService, 'deleteFolder').mockReturnValue(
        of({ deleted: true, folderPath: 'common', resourcesDeleted: 0 }),
      );

      store.setSelectedCollection({ collectionName: 'app-translations', locales: [] });
      await waitForSignals();

      store.expandAllFolders();
      store.deleteFolder('common');
      await waitForSignals();

      expect(store.expandedFolders().has('common')).toBe(false);
      expect(store.expandedFolders().has('common.buttons')).toBe(false);
      expect(store.expandedFolders().has('errors')).toBe(true);
    });
  });

  describe('Computed Signals', () => {
    it('should compute breadcrumbs from current folder path', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));

      store.selectFolder('common.buttons.primary');

      await waitForSignals();

      const breadcrumbs = store.breadcrumbs();
      expect(breadcrumbs).toEqual(['common', 'buttons', 'primary']);
    });

    it('should return empty breadcrumbs for root folder', () => {
      const breadcrumbs = store.breadcrumbs();
      expect(breadcrumbs).toEqual([]);
    });

    it('should compute isLoading correctly', async () => {
      expect(store.isLoading()).toBe(false);

      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));
      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: [],
      });

      await waitForSignals();

      // After observable completes, loading should be false
      expect(store.isLoading()).toBe(false);
    });

    it('should compute isEmpty correctly', async () => {
      const emptyTree: ResourceTreeDto = {
        path: '',
        resources: [],
        children: [],
      };

      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(emptyTree));

      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: [],
      });

      await waitForSignals();

      expect(store.isEmpty()).toBe(true);
      expect(store.hasTranslations()).toBe(false);
      expect(store.translationCount()).toBe(0);
    });

    it('should compute hasTranslations and translationCount correctly', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));

      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: [],
      });

      await waitForSignals();

      expect(store.hasTranslations()).toBe(true);
      expect(store.translationCount()).toBe(1);
      expect(store.isEmpty()).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should clear error when clearError is called', async () => {
      const error = new Error('Test error');
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(throwError(() => error));

      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: [],
      });

      await waitForSignals();

      expect(store.error()).toBe('Test error');

      store.clearError();
      expect(store.error()).toBeNull();
    });

    it('should clear error when new operation starts', async () => {
      const error = new Error('Test error');
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree')
        .mockReturnValueOnce(throwError(() => error))
        .mockReturnValueOnce(of(mockTreeRoot));

      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: [],
      });

      await waitForSignals();

      expect(store.error()).toBe('Test error');

      // Try again - should clear error
      store.loadRootFolders();

      await waitForSignals();

      expect(store.error()).toBeNull();
    });
  });

  describe('Disabled State', () => {
    it('should set disabled state', () => {
      expect(store.isDisabled()).toBe(false);

      store.setDisabled(true);
      expect(store.isDisabled()).toBe(true);

      store.setDisabled(false);
      expect(store.isDisabled()).toBe(false);
    });
  });

  describe('Read-only State', () => {
    it('should default to not read-only', () => {
      expect(store.isReadOnly()).toBe(false);
      expect(store.effectiveDisabled()).toBe(false);
    });

    it('effectiveDisabled is true when either isDisabled or isReadOnly is true', () => {
      store.setReadOnly(true);
      expect(store.effectiveDisabled()).toBe(true);

      store.setReadOnly(false);
      store.setDisabled(true);
      expect(store.effectiveDisabled()).toBe(true);
    });

    it('persists read-only across clearSearch (does not get cleared like isDisabled)', () => {
      store.setReadOnly(true);
      store.setSearchQuery('something');
      expect(store.isDisabled()).toBe(true);

      store.clearSearch();

      // Transient disabled is cleared, but read-only remains.
      expect(store.isDisabled()).toBe(false);
      expect(store.isReadOnly()).toBe(true);
      expect(store.effectiveDisabled()).toBe(true);
    });

    it('sets read-only from setSelectedCollection params', () => {
      store.setSelectedCollection({ collectionName: 'vendor', locales: ['en'], readOnly: true });
      expect(store.isReadOnly()).toBe(true);

      store.setSelectedCollection({ collectionName: 'main', locales: ['en'] });
      expect(store.isReadOnly()).toBe(false);
    });
  });

  describe('Reset', () => {
    it('should reset store to initial state', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));

      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: ['en', 'es'],
      });
      store.setFolderTreeFilter('test');
      store.setDisabled(true);

      await waitForSignals();

      store.reset();

      expect(store.selectedCollection()).toBeNull();
      expect(store.availableLocales()).toEqual([]);
      expect(store.currentFolderPath()).toBe('');
      expect(store.rootFolders()).toEqual([]);
      expect(store.folderTreeFilter()).toBe('');
      expect(store.translations()).toEqual([]);
      expect(store.isDisabled()).toBe(false);
    });
  });

  describe('Density mode & view preferences (Phase 1)', () => {
    beforeEach(() => {
      // Ensure localStorage is clean for each test
      localStorage.clear();
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
    });

    it('should update density mode state', () => {
      expect(store.densityMode()).toBe('compact');

      store.setDensityMode('full');
      expect(store.densityMode()).toBe('full');

      store.setDensityMode('compact');
      expect(store.densityMode()).toBe('compact');
    });

    it('should persist and load view preferences to/from localStorage', () => {
      const coll = 'prefs-collection';
      const prefs = {
        densityMode: 'full' as const,
        selectedLocales: ['es', 'fr'],
        showNestedResources: true,
        compactLocale: undefined,
        compactLocaleManuallyChanged: false,
        sortField: 'key' as const,
        sortDirection: 'asc' as const,
        selectedStatuses: [],
      };

      // Write directly to localStorage (saveViewPreferences was removed — localStorage.setItem is the canonical write path)
      localStorage.setItem(`lingo-tracker:view-prefs:${coll}`, JSON.stringify(prefs));

      // Ensure it's stored
      const raw = localStorage.getItem(`lingo-tracker:view-prefs:${coll}`);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw as string);
      expect(parsed).toEqual(prefs);

      // Load back through exposed method
      const loaded = store.loadViewPreferences(coll);
      expect(loaded).toEqual(prefs);
    });

    it('should start compact on the base locale regardless of the full-density filter', async () => {
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));

      store.setSelectedCollection({
        collectionName: 'c1',
        locales: ['en', 'es', 'fr'],
        baseLocale: 'en',
      });

      await waitForSignals();

      store.setDensityMode('full');
      store.setSelectedLocales(['es', 'fr']);
      expect(store.selectedLocales()).toEqual(['es', 'fr']);

      store.setDensityMode('compact');

      // Compact shows one locale, and it is the base until the user picks another
      expect(store.selectedLocales()).toEqual(['en']);
      expect(store.compactDisplayLocale()).toBe('en');
      expect(store.densityMode()).toBe('compact');
    });

    it('should remember the compact locale as soon as it is picked', async () => {
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));

      store.setSelectedCollection({
        collectionName: 'c1',
        locales: ['en', 'es', 'fr'],
        baseLocale: 'en',
      });

      await waitForSignals();

      store.setDensityMode('compact');
      store.setSelectedLocales(['fr']);

      expect(store.compactDisplayLocale()).toBe('fr');
      expect(store.compactLocale()).toBe('fr');

      // Round-trips through full density and back
      store.setDensityMode('full');
      store.setDensityMode('compact');
      expect(store.compactDisplayLocale()).toBe('fr');
    });

    it('should load preferences when collection is selected', async () => {
      const coll = 'load-collection';
      const prefs = {
        densityMode: 'compact' as const,
        selectedLocales: ['fr'],
        showNestedResources: true,
        compactLocale: 'fr',
        compactLocaleManuallyChanged: false,
        sortField: 'key' as const,
        sortDirection: 'asc' as const,
        selectedStatuses: [],
      };
      localStorage.setItem(`lingo-tracker:view-prefs:${coll}`, JSON.stringify(prefs));

      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));

      store.setSelectedCollection({
        collectionName: coll,
        locales: ['en', 'fr', 'es'],
      });

      await waitForSignals();

      // density mode should be applied and selectedLocales as well (compact implies single locale)
      expect(store.densityMode()).toBe('compact');
      expect(store.selectedLocales()).toEqual(['fr']);
    });

    it('should default to base locale when switching to compact mode with no selection', async () => {
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));

      store.setSelectedCollection({
        collectionName: 'c1',
        locales: ['en', 'es', 'fr'],
        baseLocale: 'en',
      });

      await waitForSignals();

      // No locales selected initially
      expect(store.selectedLocales()).toEqual([]);

      store.setDensityMode('compact');

      // Should select base locale
      expect(store.selectedLocales()).toEqual(['en']);
      expect(store.densityMode()).toBe('compact');
    });

    it('should default to base locale when loading compact mode from localStorage with no selection', async () => {
      const coll = 'compact-no-selection';
      const prefs = {
        densityMode: 'compact' as const,
        selectedLocales: [],
        showNestedResources: true,
        compactLocale: undefined,
        compactLocaleManuallyChanged: false,
        sortField: 'key' as const,
        sortDirection: 'asc' as const,
        selectedStatuses: [],
      };
      localStorage.setItem(`lingo-tracker:view-prefs:${coll}`, JSON.stringify(prefs));

      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));

      store.setSelectedCollection({
        collectionName: coll,
        locales: ['en', 'es', 'fr'],
        baseLocale: 'en',
      });

      await waitForSignals();

      // Should have applied compact mode and defaulted to base locale
      expect(store.densityMode()).toBe('compact');
      expect(store.selectedLocales()).toEqual(['en']);
    });

    it('should fallback to first available locale if base locale is not in available locales', async () => {
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));

      store.setSelectedCollection({
        collectionName: 'c1',
        locales: ['es', 'fr', 'de'],
        baseLocale: 'en', // not in available locales
      });

      await waitForSignals();

      expect(store.selectedLocales()).toEqual([]);

      store.setDensityMode('compact');

      // Should fallback to first available locale
      expect(store.selectedLocales()).toEqual(['es']);
    });
  });

  describe('Refresh Translations', () => {
    it('should reload current folder translations', async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree')
        .mockReturnValueOnce(of(mockTreeRoot))
        .mockReturnValueOnce(of(mockTreeCommon))
        .mockReturnValueOnce(of(mockTreeCommon));

      store.setSelectedCollection({
        collectionName: 'app-translations',
        locales: [],
      });

      await waitForSignals();

      store.selectFolder('common');

      await waitForSignals();

      store.selectFolder(store.currentFolderPath());

      await waitForSignals();

      expect(apiService.getResourceTree).toHaveBeenCalledTimes(3);
      expect(store.currentFolderPath()).toBe('common');
    });
  });

  describe('moveResource', () => {
    it('should optimistically remove a non-root folder row by its full key', async () => {
      const row = summary('common.buttons.save', 'Save');
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockImplementation((_collection, path) =>
        of({ path: path ?? '', resources: path === 'common.buttons' ? [row] : [], children: [] }),
      );
      vi.spyOn(apiService, 'moveResource').mockReturnValue(NEVER);

      store.setSelectedCollection({ collectionName: 'app-translations', locales: ['en'] });
      await waitForSignals();
      store.selectFolder('common.buttons');
      await waitForSignals();
      expect(store.translations()).toEqual([row]);

      store.moveResource({ sourceKey: 'common.buttons.save', destinationFolderPath: 'archive' });

      expect(store.translations()).toEqual([]);
      expect(apiService.moveResource).toHaveBeenCalledWith('app-translations', 'common.buttons.save', 'archive.save');
    });
  });

  describe('Locale Filtering', () => {
    beforeEach(async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));
      store.setSelectedCollection({
        collectionName: 'test',
        locales: ['en', 'es', 'fr', 'de'],
      });
      await waitForSignals();
      // Switch to full mode so multi-locale tests are not affected by compact auto-selection
      store.setDensityMode('full');
      store.clearAllLocales();
    });

    it('should initialize with empty selectedLocales', () => {
      expect(store.selectedLocales()).toEqual([]);
    });

    it('should initialize with empty baseLocale', () => {
      expect(store.baseLocale()).toBe('');
    });

    it('should set base locale', () => {
      store.setBaseLocale('en');
      expect(store.baseLocale()).toBe('en');
    });

    it('should set selected locales', () => {
      store.setSelectedLocales(['en', 'es']);
      expect(store.selectedLocales()).toEqual(['en', 'es']);
    });

    it('should toggle locale on', () => {
      store.toggleLocale('en');
      expect(store.selectedLocales()).toContain('en');
    });

    it('should toggle locale off', () => {
      store.setSelectedLocales(['en', 'es']);
      store.toggleLocale('es');
      expect(store.selectedLocales()).toEqual(['en']);
    });

    it('should select all locales', () => {
      store.selectAllLocales();
      expect(store.selectedLocales()).toEqual(['en', 'es', 'fr', 'de']);
    });

    it('should clear all locales', () => {
      store.setSelectedLocales(['en', 'es']);
      store.clearAllLocales();
      expect(store.selectedLocales()).toEqual([]);
    });

    describe('Computed: isShowingAllLocales', () => {
      it('should return true when none selected', () => {
        expect(store.isShowingAllLocales()).toBe(true);
      });

      it('should return true when all selected', () => {
        store.setSelectedLocales(['en', 'es', 'fr', 'de']);
        expect(store.isShowingAllLocales()).toBe(true);
      });

      it('should return false when some selected', () => {
        store.setSelectedLocales(['en', 'es']);
        expect(store.isShowingAllLocales()).toBe(false);
      });
    });

    describe('Computed: localeFilterText', () => {
      it('should return "All locales" when none selected', () => {
        expect(store.localeFilterText()).toBe('All locales');
      });

      it('should return "All locales" when all selected', () => {
        store.setSelectedLocales(['en', 'es', 'fr', 'de']);
        expect(store.localeFilterText()).toBe('All locales');
      });

      it('should return locale code when one selected', () => {
        store.setSelectedLocales(['en']);
        expect(store.localeFilterText()).toBe('en');
      });

      it('should return count when multiple selected', () => {
        store.setSelectedLocales(['en', 'es']);
        expect(store.localeFilterText()).toBe('2 locales');
      });

      it('should name the displayed locale in compact mode, never "All locales"', () => {
        store.setBaseLocale('en');
        store.setDensityMode('compact');
        expect(store.localeFilterText()).toBe('en');

        store.setSelectedLocales(['fr']);
        expect(store.localeFilterText()).toBe('fr');
      });
    });

    describe('Computed: filteredLocales', () => {
      beforeEach(() => {
        store.setBaseLocale('en');
      });

      it('should always include base locale when no locales selected', () => {
        const filtered = store.filteredLocales();
        expect(filtered[0]).toBe('en');
        expect(filtered).toEqual(['en', 'es', 'fr', 'de']);
      });

      it('should always include base locale first when all selected', () => {
        store.setSelectedLocales(['en', 'es', 'fr', 'de']);
        const filtered = store.filteredLocales();
        expect(filtered[0]).toBe('en');
        expect(filtered).toEqual(['en', 'es', 'fr', 'de']);
      });

      it('should always include base locale first when other locales selected', () => {
        store.setSelectedLocales(['es', 'fr']);
        const filtered = store.filteredLocales();
        expect(filtered[0]).toBe('en');
        expect(filtered).toEqual(['en', 'es', 'fr']);
      });

      it('should show only base locale when only base is selected', () => {
        store.setSelectedLocales(['en']);
        const filtered = store.filteredLocales();
        expect(filtered).toEqual(['en']);
      });

      it('should handle base locale not in available locales', () => {
        store.setBaseLocale('ja');
        const filtered = store.filteredLocales();
        expect(filtered[0]).toBe('ja');
        expect(filtered).toContain('ja');
      });

      it('should handle empty base locale', () => {
        store.setBaseLocale('');
        const filtered = store.filteredLocales();
        expect(filtered).toEqual(['en', 'es', 'fr', 'de']);
      });
    });

    describe('Computed: filterableLocales', () => {
      beforeEach(() => {
        store.setBaseLocale('en');
      });

      it('should exclude base locale from filterable locales', () => {
        const filterable = store.filterableLocales();
        expect(filterable).toEqual(['es', 'fr', 'de']);
        expect(filterable).not.toContain('en');
      });

      it('should return all locales when no base locale set', () => {
        store.setBaseLocale('');
        const filterable = store.filterableLocales();
        expect(filterable).toEqual(['en', 'es', 'fr', 'de']);
      });

      it('should handle base locale not in available locales', () => {
        store.setBaseLocale('ja');
        const filterable = store.filterableLocales();
        expect(filterable).toEqual(['en', 'es', 'fr', 'de']);
      });
    });
  });

  describe('Search State', () => {
    beforeEach(async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));
      store.setSelectedCollection({
        collectionName: 'test',
        locales: ['en', 'es'],
      });
      await waitForSignals();
    });

    it('should initialize with empty search state', () => {
      expect(store.searchQuery()).toBe('');
      expect(store.isSearchMode()).toBe(false);
      expect(store.searchResults()).toEqual([]);
      expect(store.isSearchLoading()).toBe(false);
      expect(store.searchError()).toBeNull();
    });

    it('should set search query and enter search mode', () => {
      store.setSearchQuery('test query');

      expect(store.searchQuery()).toBe('test query');
      expect(store.isSearchMode()).toBe(true);
      expect(store.isDisabled()).toBe(true);
    });

    it('should exit search mode when query is empty', () => {
      store.setSearchQuery('test');
      store.setSearchQuery('');

      expect(store.isSearchMode()).toBe(false);
      expect(store.isDisabled()).toBe(false);
    });

    it('should clear search state', () => {
      store.setSearchQuery('test');
      store.clearSearch();

      expect(store.searchQuery()).toBe('');
      expect(store.isSearchMode()).toBe(false);
      expect(store.searchResults()).toEqual([]);
      expect(store.searchError()).toBeNull();
      expect(store.isDisabled()).toBe(false);
    });

    describe('Computed: displayedTranslations', () => {
      it('should return folder translations when not in search mode', async () => {
        vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockTreeRoot));

        store.loadRootFolders();

        await waitForSignals();

        expect(store.displayedTranslations()).toEqual(mockTreeRoot.resources);
      });

      it('should return search results when in search mode', () => {
        const mockSearchResults = [
          { ...summary('found', 'Found', { es: ['Encontrado', 'verified'] }), matchType: 'exact-key' as const },
        ];

        store.setSearchQuery('found');
        // Manually set search results for this test
        vi.spyOn(apiService, 'searchTranslations').mockReturnValue(
          of({
            query: 'found',
            results: mockSearchResults,
            totalFound: 1,
            limited: false,
          }),
        );

        // Trigger search
        store.searchTranslations('found');

        // The displayedTranslations should switch to search results when in search mode
        // Note: We can't wait for signals here since we're testing the computed property
        // so we'll verify the logic by checking isSearchMode
        expect(store.isSearchMode()).toBe(true);
      });
    });

    describe('searchTranslations rxMethod', () => {
      it('should search translations and update results', async () => {
        const mockSearchResults = [
          {
            ...summary('common.save', 'Save', { es: ['Guardar', 'verified'] }),
            matchType: 'partial-key' as const,
          },
        ];

        vi.spyOn(apiService, 'searchTranslations').mockReturnValue(
          of({
            query: 'save',
            results: mockSearchResults,
            totalFound: 1,
            limited: false,
          }),
        );

        store.searchTranslations('save');

        await waitForSignals();

        expect(store.searchResults()).toEqual(mockSearchResults);
        expect(store.isSearchLoading()).toBe(false);
        expect(store.searchError()).toBeNull();
      });

      it('should handle empty query', async () => {
        vi.spyOn(apiService, 'searchTranslations');

        store.searchTranslations('');

        await waitForSignals();

        expect(apiService.searchTranslations).not.toHaveBeenCalled();
        expect(store.isSearchLoading()).toBe(false);
      });

      it('should handle search errors', async () => {
        const error = new Error('Search failed');
        vi.spyOn(apiService, 'searchTranslations').mockReturnValue(throwError(() => error));

        store.searchTranslations('test');

        await waitForSignals();

        expect(store.isSearchLoading()).toBe(false);
        expect(store.searchError()).toBe('Search failed');
        expect(store.searchResults()).toEqual([]);
      });

      it('should set loading state during search', async () => {
        vi.spyOn(apiService, 'searchTranslations').mockReturnValue(
          of({
            query: 'test',
            results: [],
            totalFound: 0,
            limited: false,
          }),
        );

        store.searchTranslations('test');

        await waitForSignals();

        expect(store.isSearchLoading()).toBe(false);
      });
    });
  });

  describe('Status Counts', () => {
    // Deliberately overlapping: `alpha` is stale in one locale and new in
    // another, so a needs-work count that adds new + stale would report 3
    // resources where only 2 exist.
    const mockStatusTree: ResourceTreeDto = {
      path: '',
      resources: [
        summary('alpha', 'Alpha', {
          es: ['Alfa', 'stale'],
          fr: ['Alpha', 'new'],
          de: ['Alpha', 'verified'],
        }),
        summary('beta', 'Beta', {
          es: ['Beta', 'new'],
          fr: ['Beta', 'translated'],
          de: ['Beta', 'translated'],
        }),
        summary('gamma', 'Gamma', {
          es: ['Gamma', 'verified'],
          fr: ['Gamma', 'verified'],
          de: ['Gamma', 'verified'],
        }),
      ],
      children: [],
    };

    beforeEach(async () => {
      vi.spyOn(apiService, 'getCacheStatus').mockReturnValue(of(mockCacheReady));
      vi.spyOn(apiService, 'getResourceTree').mockReturnValue(of(mockStatusTree));
      store.setSelectedCollection({
        collectionName: 'test',
        locales: ['en', 'es', 'fr', 'de'],
      });
      await waitForSignals();
      store.setDensityMode('full');
      store.clearAllLocales();
    });

    it('should count resources, not status cells', () => {
      // `gamma` is verified in all three target locales but is one resource.
      expect(store.statusCounts().verified).toBe(2);
    });

    it('should count a resource under every status it carries', () => {
      expect(store.statusCounts()).toEqual({ new: 2, stale: 1, translated: 1, verified: 2 });
    });

    it('should count needs work as a union rather than a sum', () => {
      const { new: isNew, stale } = store.statusCounts();
      expect(isNew + stale).toBe(3);
      expect(store.needsWorkCount()).toBe(2);
    });

    it('should agree with the list a status filter actually produces', () => {
      for (const status of ['new', 'stale', 'translated', 'verified'] as const) {
        store.setSelectedStatuses([status]);
        expect(store.sortedTranslations().length).toBe(store.statusCounts()[status]);
      }
    });

    it('should agree with the list the needs-work shortcut produces', () => {
      store.selectNeedsWorkStatuses();
      expect(store.sortedTranslations().length).toBe(store.needsWorkCount());
    });

    it('should not collapse other counts when one status is selected', () => {
      store.setSelectedStatuses(['new']);
      expect(store.statusCounts()).toEqual({ new: 2, stale: 1, translated: 1, verified: 2 });
    });

    it('should narrow counts to the selected locales', () => {
      store.setSelectedLocales(['de']);
      expect(store.statusCounts()).toEqual({ new: 0, stale: 0, translated: 1, verified: 2 });
      expect(store.needsWorkCount()).toBe(0);
    });

    it('should report zero for every status when the folder is empty', () => {
      store.reset();
      expect(store.statusCounts()).toEqual({ new: 0, stale: 0, translated: 0, verified: 0 });
      expect(store.needsWorkCount()).toBe(0);
    });
  });
});
