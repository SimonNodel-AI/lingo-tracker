import { patchState, signalStoreFeature, type, withMethods } from '@ngrx/signals';
import {
  type CollectionSettings,
  collectionNeedsReopen,
  sameCollectionSettings,
} from '../../../collections/store/collection-settings';
import type { CollectionResetRegistry } from '../collection-reset';
import type { RootState } from '../root-state';

/** The root fields a collection's settings set: the settings themselves and their projections. */
function settingsState(settings: CollectionSettings): Partial<RootState> {
  return {
    collectionSettings: settings,
    selectedCollection: settings.name,
    availableLocales: [...settings.locales],
    baseLocale: settings.baseLocale,
    isReadOnly: settings.readOnly,
  };
}

/**
 * The Browser Session: the one path that opens a collection in the browser.
 *
 * The store is root-provided, so it outlives the route. Opening a collection therefore
 * runs every reset registered by `withCollectionState`, applies the resolved collection settings, restores the
 * collection's saved view preferences, and starts index polling.
 *
 * Every open bumps `sessionId`. Loaders capture it when they start (`session-guard.ts`), so a
 * response from a collection that is no longer open, or from an earlier open of this one, is
 * dropped instead of written into the session that replaced it.
 *
 * Re-entering the open collection is not an open: the user keeps their place (folder, search,
 * expansion). Only its settings are brought up to date, by `updateSettings` — which reopens
 * instead when the edit changes what data is valid (see its own doc comment).
 */
export function withBrowserSessionFeature<_>() {
  return signalStoreFeature(
    {
      state: type<RootState>(),
      props: type<CollectionResetRegistry>(),
      methods: type<{
        restoreViewPreferences(collectionName: string): void;
        checkCacheStatus(): void;
        _cancelListLoads(): void;
      }>(),
    },
    withMethods((store) => {
      /** Stops list loads, bumps the session, resets every feature, applies `settings`, restores prefs, starts polling. */
      function open(settings: CollectionSettings): void {
        const sessionId = store.sessionId() + 1;
        // A list load of the previous session (and its not-ready retries) stops here, not later.
        store._cancelListLoads();
        // Resets and the settings/sessionId patch are synchronous, so computed signals/effects do not observe intermediate state.
        for (const { reset } of store._collectionResets) reset();
        patchState(store, { sessionId, ...settingsState(settings) });

        store.restoreViewPreferences(settings.name);
        store.checkCacheStatus();
      }

      return {
        openCollection: open,

        /**
         * Brings the open collection's settings up to date after its config changed, keeping
         * everything the user has on screen where that is still valid. Settings equal to the
         * current ones, as on an unrelated config reload, change nothing. Settings for another
         * collection are ignored: switching is `openCollection`.
         *
         * A change to `locales`, `baseLocale` or `translationsFolder` invalidates data cached
         * under the old settings — the folder tree, translations, filter selections, the
         * cache-status check — so it goes through `openCollection` instead: a fresh session,
         * with the collection's saved view preferences restored against its current locales. A
         * `readOnly` or `translationEnabled` change alone does not touch cached data, so it is
         * patched in place.
         */
        updateSettings(settings: CollectionSettings): void {
          const current = store.collectionSettings();
          if (!current || current.name !== settings.name || sameCollectionSettings(current, settings)) return;

          if (collectionNeedsReopen(current, settings)) {
            open(settings);
            return;
          }

          patchState(store, settingsState(settings));
        },
      };
    }),
  );
}
