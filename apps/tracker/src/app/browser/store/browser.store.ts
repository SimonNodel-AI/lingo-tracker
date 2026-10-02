import { computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { initialRootState } from './root-state';
import { withListScopeFeature } from './features/with-list-scope.feature';
import { withCacheStatusFeature } from './features/with-cache-status.feature';
import { withFilterFeature } from './features/with-filter.feature';
import { withViewPreferencesFeature } from './features/with-view-preferences.feature';
import { withTranslationsFeature } from './features/with-translations.feature';
import { withFolderTreeFeature } from './features/with-folder-tree.feature';
import { withFolderTreeInteractionsFeature } from './features/with-folder-tree-interactions.feature';
import { withEntryWritesFeature } from './features/with-entry-writes.feature';
import { withFolderWritesFeature } from './features/with-folder-writes.feature';
import { withBrowserSessionFeature } from './features/with-browser-session.feature';

export const BrowserStore = signalStore(
  { providedIn: 'root' },
  withState(initialRootState),
  withListScopeFeature(),
  withFilterFeature(),
  withTranslationsFeature(),
  withEntryWritesFeature(),
  withFolderTreeFeature(),
  withFolderWritesFeature(),
  withCacheStatusFeature(),
  withViewPreferencesFeature(),
  withBrowserSessionFeature(),
  withComputed((store) => {
    /** Folder navigation and moves are locked: a search is shown, or a move is in flight. */
    const isDisabled = computed(() => store.isSearchMode() || store.isMoving());
    return {
      isDisabled,
      /** Editing affordances are locked: `isDisabled`, or the collection is read-only. */
      effectiveDisabled: computed(() => isDisabled() || store.isReadOnly()),
      /** What the list's error view shows: the list's own failed load, else any other failure. */
      listErrorMessage: computed(() => store.listError() ?? store.error()),
    };
  }),
  withFolderTreeInteractionsFeature(),
  withMethods((store) => ({
    clearError(): void {
      patchState(store, { error: null, listError: null });
    },

    /**
     * The list's Retry: clears the error on screen and loads the List Scope again, and the folder
     * tree too when it never loaded.
     */
    retryLoad(): void {
      patchState(store, { error: null });
      store.reloadList();
      if (!store.folderTreeLoaded()) store.loadRootFolders();
    },
  })),
);
