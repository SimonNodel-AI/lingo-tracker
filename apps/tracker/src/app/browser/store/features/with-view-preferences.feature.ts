import { computed, effect } from '@angular/core';
import { signalStoreFeature, withComputed, withMethods, withHooks, patchState, type } from '@ngrx/signals';
import type { DensityMode } from '../../types/density-mode';
import type { ViewPreferences } from '../view-preferences.types';
import { computeDensityModeTransition, resolveCompactLocale } from '../density-mode.utils';
import type { TranslationStatus } from '@simoncodes-ca/data-transfer';

function storageKey(collectionName: string): string {
  return `lingo-tracker:view-prefs:${collectionName}`;
}

/** What an older Tracker may have saved: any field can be missing, and density may be the retired 'medium'. */
type SavedViewPreferences = Partial<Omit<ViewPreferences, 'densityMode'>> & { densityMode?: DensityMode | 'medium' };

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
      state: type<{
        selectedCollection: string | null;
        densityMode: DensityMode;
        selectedLocales: string[];
        showNestedResources: boolean;
        sortField: 'key' | 'status';
        sortDirection: 'asc' | 'desc';
        selectedStatuses: TranslationStatus[];
        availableLocales: string[];
        baseLocale: string;
        compactLocale: string | undefined;
        compactLocaleManuallyChanged: boolean;
        nonCompactSelectedLocales: string[];
      }>(),
    },
    withComputed(({ densityMode }) => ({
      canShowMultipleLocales: computed(() => densityMode() !== 'compact'),
    })),
    withMethods((store) => ({
      setDensityMode(mode: DensityMode): void {
        const transition = computeDensityModeTransition(mode, {
          currentDensityMode: store.densityMode(),
          currentSelectedLocales: store.selectedLocales(),
          availableLocales: store.availableLocales(),
          baseLocale: store.baseLocale(),
          compactLocale: store.compactLocale(),
          compactLocaleManuallyChanged: store.compactLocaleManuallyChanged(),
          nonCompactSelectedLocales: store.nonCompactSelectedLocales(),
        });

        patchState(store, {
          densityMode: mode,
          selectedLocales: transition.selectedLocales,
          compactLocale: transition.compactLocale,
          compactLocaleManuallyChanged: transition.compactLocaleManuallyChanged,
          nonCompactSelectedLocales: transition.nonCompactSelectedLocales,
        });
      },

      /**
       * Applies the view preferences saved for a collection on top of the fresh state the
       * Browser Session has just set; a collection without any keeps the initial state. The
       * retired 'medium' density reads as 'compact'. In compact the one displayed locale is
       * resolved against the collection's locales, so a saved locale it no longer has cannot
       * leave the list blank.
       */
      restoreViewPreferences(collectionName: string): void {
        const saved = readFromLocalStorage(collectionName);
        if (!saved) return;

        const densityMode: DensityMode = saved.densityMode === 'full' ? 'full' : 'compact';
        const savedSelectedLocales = saved.selectedLocales ?? [];
        const selectedLocales =
          densityMode === 'compact'
            ? resolveCompactLocale({
                savedCompactLocale: saved.compactLocale,
                currentSelectedLocales: savedSelectedLocales,
                availableLocales: store.availableLocales(),
                baseLocale: store.baseLocale(),
              })
            : savedSelectedLocales;

        patchState(store, {
          densityMode,
          selectedLocales,
          showNestedResources: saved.showNestedResources ?? store.showNestedResources(),
          compactLocale: saved.compactLocale,
          compactLocaleManuallyChanged: saved.compactLocaleManuallyChanged ?? false,
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
