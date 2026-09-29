import { computed, type Signal } from '@angular/core';
import { signalStoreFeature, withComputed, type } from '@ngrx/signals';
import { sortTranslations } from '../../translations/utils/sort-translations';
import type { ResourceSummaryDto, SearchResultDto } from '@simoncodes-ca/data-transfer';
import { countByStatus, STATUS_PRECEDENCE, summaryTarget, type TranslationStatus } from '@simoncodes-ca/domain';
import { displayStatus } from '../../../shared/translation-status/display-status';

const NEEDS_WORK_STATUSES: readonly TranslationStatus[] = ['new', 'stale'];

/**
 * A resource is in scope for a status filter when any of the locales being
 * filtered on carries one of those statuses.
 *
 * Both the list and the per-status counts beside the filter toggles run through
 * here, so the two can never drift into disagreeing about what a status means.
 * It reads the `displayStatus`, so a locale with no metadata matches `new`.
 */
function matchesAnyStatus(
  item: ResourceSummaryDto,
  locales: readonly string[],
  statuses: readonly TranslationStatus[],
): boolean {
  const counts = countByStatus(locales.map((locale) => displayStatus(summaryTarget(item, locale))));
  return statuses.some((status) => counts[status] > 0);
}

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
      // Provided by withListScopeFeature, which composes before this feature.
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
    withComputed(
      ({ translations, isSearchMode, searchResults, selectedStatuses, _statusLocales, sortField, sortDirection }) => ({
        isEmpty: computed(() => translations().length === 0),

        translationCount: computed(() => translations().length),

        hasTranslations: computed(() => translations().length > 0),

        displayedTranslations: computed(() => (isSearchMode() ? searchResults() : translations())),

        sortedTranslations: computed(() => {
          const items = isSearchMode() ? searchResults() : translations();
          const statuses = selectedStatuses();

          const locales = _statusLocales();

          const filteredItems =
            statuses.length > 0 ? items.filter((item) => matchesAnyStatus(item, locales, statuses)) : items;

          return sortTranslations(filteredItems, sortField(), sortDirection(), locales);
        }),

        /**
         * How many resources each status would leave on screen if it were the only
         * status selected — not how many status cells exist.
         *
         * The status filter shows these beside its toggles, so the number has to
         * answer the question the user is actually asking before they click: "how
         * much is behind this?". That means counting through `matchesAnyStatus`,
         * the same predicate `sortedTranslations` filters with, so a count can
         * never promise a row the list then declines to show.
         *
         * Deliberately computed over the status-unfiltered set, so selecting one
         * status does not collapse the other three counts to zero and strand the
         * user with no way to judge where to go next. A resource with a `stale`
         * German entry and a `new` Japanese one counts once under each, so the
         * four counts can legitimately sum past the total.
         */
        statusCounts: computed(() => {
          const items = isSearchMode() ? searchResults() : translations();
          const locales = _statusLocales();

          const counts: Record<TranslationStatus, number> = { new: 0, stale: 0, translated: 0, verified: 0 };
          for (const item of items) {
            for (const status of STATUS_PRECEDENCE) {
              if (matchesAnyStatus(item, locales, [status])) counts[status]++;
            }
          }
          return counts;
        }),

        /**
         * Resources with anything unfinished in the filtered locales: the rows the
         * needs-work shortcut (`new` + `stale`) shows, a locale with no metadata
         * included. Counted as a union rather than `new + stale`, because a resource
         * that is new in one locale and stale in another is one row, not two.
         */
        needsWorkCount: computed(() => {
          const items = isSearchMode() ? searchResults() : translations();
          const locales = _statusLocales();
          return items.filter((item) => matchesAnyStatus(item, locales, NEEDS_WORK_STATUSES)).length;
        }),
      }),
    ),
  );
}
