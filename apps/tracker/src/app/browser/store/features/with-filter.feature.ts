import { computed } from '@angular/core';
import { patchState, signalStoreFeature, type, withComputed, withMethods, withState } from '@ngrx/signals';
import type { TranslationStatus } from '@simoncodes-ca/data-transfer';

export interface FilterState {
  selectedLocales: string[];
  selectedStatuses: TranslationStatus[];
  sortField: 'key' | 'status';
  sortDirection: 'asc' | 'desc';
}

/**
 * What the locale filter trigger reports, as data: the component words it. `locale` names
 * the one locale on screen (a single selection, or whatever compact shows); `count` is a
 * partial selection of two or more.
 */
export type LocaleFilterLabel = { kind: 'all' } | { kind: 'locale'; locale: string } | { kind: 'count'; count: number };

export const initialFilterState: FilterState = {
  selectedLocales: [],
  selectedStatuses: [],
  sortField: 'key',
  sortDirection: 'asc',
};

/**
 * The one locale a compact row shows: the single selection when there is one,
 * otherwise the base locale, otherwise the collection's first locale. Compact
 * never shows a pair, so this is also what the locale filter must report.
 */
function resolveCompactDisplayLocale(selected: string[], available: string[], base: string): string {
  const picked = selected.find((locale) => available.includes(locale));
  if (picked) return picked;
  if (base && available.includes(base)) return base;
  return available[0] ?? base;
}

export function withFilterFeature<_>() {
  return signalStoreFeature(
    {
      state: type<{
        availableLocales: string[];
        baseLocale: string;
        densityMode: string;
        compactLocale: string | undefined;
        compactLocaleManuallyChanged: boolean;
      }>(),
    },
    withState(initialFilterState),
    withComputed(({ selectedLocales, selectedStatuses, availableLocales, baseLocale, densityMode }) => ({
      isShowingAllLocales: computed(() => {
        const selected = selectedLocales();
        const available = availableLocales();
        return selected.length === 0 || selected.length === available.length;
      }),

      localeFilterLabel: computed((): LocaleFilterLabel => {
        const selected = selectedLocales();
        const available = availableLocales();

        // Compact shows exactly one locale, so "all locales" would be a lie about
        // what is on screen. Name the locale the rows are actually showing.
        if (densityMode() === 'compact') {
          return { kind: 'locale', locale: resolveCompactDisplayLocale(selected, available, baseLocale()) };
        }

        if (selected.length === 0 || selected.length === available.length) return { kind: 'all' };
        if (selected.length === 1) return { kind: 'locale', locale: selected[0] };
        return { kind: 'count', count: selected.length };
      }),

      filteredLocales: computed(() => {
        const selected = selectedLocales();
        const available = availableLocales();
        const base = baseLocale();

        const result: string[] = base ? [base] : [];
        const nonBaseAvailable = available.filter((locale) => locale !== base);
        const selectedNonBase = selected.filter((locale) => locale !== base);

        if (selected.length === 0) result.push(...nonBaseAvailable);
        else result.push(...selectedNonBase);

        return result;
      }),

      /**
       * The single locale a compact row displays.
       *
       * Compact shows one value per row, never a pair. The selection is the
       * single-select locale filter; when nothing is selected the row shows the
       * base locale, because that is the string the developer wrote and arrived
       * looking for. A collection with no base locale among its files falls back
       * to its first locale so the row is never blank.
       */
      compactDisplayLocale: computed(() =>
        resolveCompactDisplayLocale(selectedLocales(), availableLocales(), baseLocale()),
      ),

      filterableLocales: computed(() => {
        const available = availableLocales();
        const base = baseLocale();
        return available.filter((locale) => locale !== base);
      }),

      hasStatusFilter: computed(() => selectedStatuses().length > 0),
    })),
    withMethods((store) => ({
      setSelectedLocales(locales: string[]): void {
        const isCompactMode = store.densityMode() === 'compact';
        patchState(store, {
          selectedLocales: locales,
          // In compact the selection *is* the compact locale, so it is remembered
          // as soon as it changes — not only when the user leaves compact. That is
          // what lets a reload land on the locale they were looking at.
          compactLocale: isCompactMode ? locales.at(0) : store.compactLocale(),
          compactLocaleManuallyChanged: isCompactMode ? true : store.compactLocaleManuallyChanged(),
        });
      },

      toggleLocale(locale: string): void {
        const current = store.selectedLocales();
        const isCompactMode = store.densityMode() === 'compact';
        const newLocales = current.includes(locale) ? current.filter((l) => l !== locale) : [...current, locale];

        patchState(store, {
          selectedLocales: newLocales,
          compactLocale: isCompactMode ? newLocales.at(0) : store.compactLocale(),
          compactLocaleManuallyChanged: isCompactMode ? true : store.compactLocaleManuallyChanged(),
        });
      },

      selectAllLocales(): void {
        patchState(store, { selectedLocales: [...store.availableLocales()] });
      },

      clearAllLocales(): void {
        patchState(store, { selectedLocales: [] });
      },

      setSortField(field: 'key' | 'status'): void {
        patchState(store, { sortField: field });
      },

      toggleSortDirection(): void {
        patchState(store, {
          sortDirection: store.sortDirection() === 'asc' ? 'desc' : 'asc',
        });
      },

      setSelectedStatuses(statuses: TranslationStatus[]): void {
        patchState(store, { selectedStatuses: statuses });
      },

      toggleStatus(status: TranslationStatus): void {
        const current = store.selectedStatuses();
        const newStatuses = current.includes(status) ? current.filter((s) => s !== status) : [...current, status];
        patchState(store, { selectedStatuses: newStatuses });
      },

      selectNeedsWorkStatuses(): void {
        patchState(store, { selectedStatuses: ['new', 'stale'] });
      },

      clearAllStatuses(): void {
        patchState(store, { selectedStatuses: [] });
      },
    })),
  );
}
