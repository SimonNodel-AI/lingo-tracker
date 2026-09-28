import { patchState, signalStoreFeature, type, withMethods } from '@ngrx/signals';
import type { CollectionSettings } from '../../../collections/store/collection-settings';
import { initialRootState, type RootState } from '../root-state';
import { type CacheStatusState, initialCacheStatusState } from './with-cache-status.feature';
import { type FilterState, initialFilterState } from './with-filter.feature';
import { type FolderTreeState, initialFolderTreeState } from './with-folder-tree.feature';
import { initialSearchState, type SearchState } from './with-search.feature';
import { initialTranslationsState, type TranslationsState } from './with-translations.feature';

/** Everything the session resets: the root state plus every feature's own slice. */
type SessionState = RootState & SearchState & FilterState & TranslationsState & FolderTreeState & CacheStatusState;

/**
 * The Browser Session: the one path that opens a collection in the browser.
 *
 * The store is root-provided, so it outlives the route. Opening a collection therefore
 * starts every feature at its own initial state (each feature exports it; nothing here
 * names another feature's fields), applies the resolved collection settings, restores the
 * collection's saved view preferences, and starts index polling. Composes last, since it
 * calls into the view-preferences and cache-status features.
 */
export function withBrowserSessionFeature<_>() {
  return signalStoreFeature(
    {
      state: type<SessionState>(),
      methods: type<{ restoreViewPreferences(collectionName: string): void; checkCacheStatus(): void }>(),
    },
    withMethods((store) => ({
      openCollection(settings: CollectionSettings): void {
        patchState(
          store,
          initialRootState,
          initialSearchState,
          initialFilterState,
          initialTranslationsState,
          initialFolderTreeState,
          initialCacheStatusState,
          {
            selectedCollection: settings.name,
            availableLocales: [...settings.locales],
            baseLocale: settings.baseLocale,
            isReadOnly: settings.readOnly,
          },
        );

        store.restoreViewPreferences(settings.name);
        store.checkCacheStatus();
      },
    })),
  );
}
