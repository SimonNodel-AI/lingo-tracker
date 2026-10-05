import { computed, type Signal } from '@angular/core';
import { signalStoreFeature, type, withComputed } from '@ngrx/signals';
import type { ResourceSummaryDto, SearchResultDto } from '@simoncodes-ca/data-transfer';
import type { TranslationStatus } from '@simoncodes-ca/domain';
import { resourceStatusScope, translationListRows } from '../../translations/utils/translation-list-view';

/** The list as the user sees it: the List Scope's rows, filtered by status, sorted, and counted. */
export function withTranslationsFeature<_>() {
  return signalStoreFeature(
    {
      state: type<{
        translations: ResourceSummaryDto[];
        searchResults: SearchResultDto[];
        selectedLocales: string[];
        availableLocales: string[];
        selectedStatuses: TranslationStatus[];
        sortField: 'key' | 'status';
        sortDirection: 'asc' | 'desc';
      }>(),
      props: type<{ isSearchMode: Signal<boolean> }>(),
    },
    withComputed(({ selectedLocales, availableLocales }) => ({
      /**
       * The locales a status is read over: the selected ones, or every locale when
       * none is selected (the UI's "All locales"). The status filter, its counts,
       * the needs-work count and sort by status all read this one list.
       */
      _statusLocales: computed(() => (selectedLocales().length > 0 ? selectedLocales() : availableLocales())),
    })),
    withComputed(({ translations, isSearchMode, searchResults, _statusLocales }) => ({
      isEmpty: computed(() => translations().length === 0),

      translationCount: computed(() => translations().length),

      hasTranslations: computed(() => translations().length > 0),

      displayedTranslations: computed(() => (isSearchMode() ? searchResults() : translations())),

      _resourceStatusScope: computed(() =>
        resourceStatusScope(isSearchMode() ? searchResults() : translations(), _statusLocales()),
      ),
    })),
    withComputed(({ _resourceStatusScope, selectedStatuses, sortField, sortDirection }) => ({
      sortedTranslations: computed(() =>
        translationListRows(_resourceStatusScope(), {
          statuses: selectedStatuses(),
          sortField: sortField(),
          sortDirection: sortDirection(),
        }),
      ),
      statusCounts: computed(() => _resourceStatusScope().statusCounts),
      needsWorkCount: computed(() => _resourceStatusScope().needsWorkCount),
    })),
  );
}
