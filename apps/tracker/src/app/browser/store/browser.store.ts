import { computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { initialRootState } from './root-state';
import { withListScopeFeature } from './features/with-list-scope.feature';
import { withCacheStatusFeature } from './features/with-cache-status.feature';
import { withFilterFeature } from './features/with-filter.feature';
import { withViewPreferencesFeature } from './features/with-view-preferences.feature';
import { withTranslationsFeature } from './features/with-translations.feature';
import { withFolderTreeFeature } from './features/with-folder-tree.feature';
import { withEntryWritesFeature } from './features/with-entry-writes.feature';
import { withMovesFeature } from './features/with-moves.feature';
import { withBrowserSessionFeature } from './features/with-browser-session.feature';

export const BrowserStore = signalStore(
  { providedIn: 'root' },
  withState(initialRootState),
  withListScopeFeature(),
  withFilterFeature(),
  withTranslationsFeature(),
  withEntryWritesFeature(),
  withFolderTreeFeature(),
  withMovesFeature(),
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
    };
  }),
  withMethods((store) => ({
    clearError(): void {
      patchState(store, { error: null });
    },

    /** The list's Retry: loads the folder tree too when it never loaded, then the List Scope again. */
    retryLoad(): void {
      store.reloadList();
      if (!store.folderTreeLoaded()) store.loadRootFolders();
    },
  })),
);
