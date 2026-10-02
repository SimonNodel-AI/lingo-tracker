import { computed, effect } from '@angular/core';
import { signalStoreFeature, withComputed, withMethods, withHooks, patchState, type } from '@ngrx/signals';
import type { DensityMode } from '../../types/density-mode';
import type { ViewPreferences } from '../view-preferences.types';
import {
  restoreLocaleSelection,
  setDensity,
  type LocaleContext,
  type LocaleSelection,
  type SavedLocaleSelection,
} from '../locale-selection';
import type { TranslationStatus } from '@simoncodes-ca/data-transfer';

function storageKey(collectionName: string): string {
  return `lingo-tracker:view-prefs:${collectionName}`;
}

/** What an older Tracker may have saved: any field can be missing, and density may be the retired 'medium'. */
type SavedViewPreferences = Partial<Omit<ViewPreferences, 'densityMode'>> & SavedLocaleSelection;

function readFromLocalStorage(collectionName: string): SavedViewPreferences | undefined {
  try {
    const raw = localStorage.getItem(storageKey(collectionName));
    if (!raw) return undefined;
    return JSON.parse(raw) as SavedViewPreferences;
  } catch {
    return undefined;
  }
}

function writeToLocalStorage(collectionName: string, prefs: ViewPreferences): void {
  try {
    localStorage.setItem(storageKey(collectionName), JSON.stringify(prefs));
  } catch {
    // ignore localStorage failures
  }
}

export function withViewPreferencesFeature<_>() {
  return signalStoreFeature(
    {
      state: type<
        LocaleSelection &
          LocaleContext & {
            selectedCollection: string | null;
            showNestedResources: boolean;
            sortField: 'key' | 'status';
            sortDirection: 'asc' | 'desc';
            selectedStatuses: TranslationStatus[];
          }
      >(),
    },
    withComputed(({ densityMode }) => ({
      canShowMultipleLocales: computed(() => densityMode() !== 'compact'),
    })),
    withMethods((store) => ({
      setDensityMode(mode: DensityMode): void {
        patchState(
          store,
          setDensity(
            {
              densityMode: store.densityMode(),
              selectedLocales: store.selectedLocales(),
              compactLocale: store.compactLocale(),
              compactLocaleManuallyChanged: store.compactLocaleManuallyChanged(),
              nonCompactSelectedLocales: store.nonCompactSelectedLocales(),
            },
            mode,
            { availableLocales: store.availableLocales(), baseLocale: store.baseLocale() },
          ),
        );
      },

      /**
       * Applies the view preferences saved for a collection on top of the fresh state the
       * Browser Session has just set; a collection without any keeps the initial state. The
       * retired 'medium' density reads as 'compact'. In compact the one displayed locale is
       * resolved against the collection's locales, so a saved locale it no longer has cannot
       * leave the list blank. In full mode, a saved locale the collection no longer has (one
       * removed since the save) is dropped rather than kept selected, so it cannot leave a
       * stale column on screen or get written back to storage on the next save.
       */
      restoreViewPreferences(collectionName: string): void {
        const saved = readFromLocalStorage(collectionName);
        if (!saved) return;

        const restored = restoreLocaleSelection(saved, {
          availableLocales: store.availableLocales(),
          baseLocale: store.baseLocale(),
        });

        patchState(store, {
          ...restored,
          showNestedResources: saved.showNestedResources ?? store.showNestedResources(),
          sortField: saved.sortField ?? store.sortField(),
          sortDirection: saved.sortDirection ?? store.sortDirection(),
          selectedStatuses: saved.selectedStatuses ?? store.selectedStatuses(),
        });
      },
    })),
    withHooks({
      onInit(store) {
        effect(() => {
          const collection = store.selectedCollection();
          if (!collection) return;

          const prefs: ViewPreferences = {
            densityMode: store.densityMode(),
            selectedLocales: store.selectedLocales(),
            showNestedResources: store.showNestedResources(),
            compactLocale: store.compactLocale(),
            compactLocaleManuallyChanged: store.compactLocaleManuallyChanged(),
            sortField: store.sortField(),
            sortDirection: store.sortDirection(),
            selectedStatuses: store.selectedStatuses(),
          };

          writeToLocalStorage(collection, prefs);
        });
      },
    }),
  );
}
