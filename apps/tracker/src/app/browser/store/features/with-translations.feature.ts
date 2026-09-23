import { computed, inject } from '@angular/core';
import { signalStoreFeature, withState, withComputed, withMethods, patchState, type } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, tap, switchMap, catchError, of } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { BrowserApiService } from '../../services/browser-api.service';
import { sortTranslations } from '../../translations/utils/sort-translations';
import type { ResourceSummaryDto, SearchResultDto } from '@simoncodes-ca/data-transfer';
import { countByStatus, STATUS_PRECEDENCE, type TranslationStatus } from '@simoncodes-ca/domain';
import { toErrorMessage } from '../async-error.utils';
import { TRACKER_TOKENS } from '../../../../i18n-types/tracker-resources';

interface TranslationsState {
  translations: ResourceSummaryDto[];
  isTranslationsLoading: boolean;
  showNestedResources: boolean;
}

const initialTranslationsState: TranslationsState = {
  translations: [],
  isTranslationsLoading: false,
  showNestedResources: true,
};

const NEEDS_WORK_STATUSES: readonly TranslationStatus[] = ['new', 'stale'];

/**
 * A resource is in scope for a status filter when any of the locales being
 * filtered on carries one of those statuses.
 *
 * Both the list and the counts beside the filter toggles run through here, so
 * the two can never drift into disagreeing about what a status means.
 */
function matchesAnyStatus(
  item: { status?: Record<string, TranslationStatus | undefined> },
  locales: readonly string[],
  statuses: readonly TranslationStatus[],
): boolean {
  const counts = countByStatus(locales.map((locale) => item.status?.[locale]));
  return statuses.some((status) => counts[status] > 0);
}

export function withTranslationsFeature<_>() {
  return signalStoreFeature(
    {
      state: type<{
        selectedCollection: string | null;
        currentFolderPath: string;
        error: string | null;
        isSearchMode: boolean;
        searchResults: SearchResultDto[];
        selectedLocales: string[];
        availableLocales: string[];
        selectedStatuses: TranslationStatus[];
        sortField: 'key' | 'status';
        sortDirection: 'asc' | 'desc';
      }>(),
    },
    withState(initialTranslationsState),
    withComputed(
      ({
        translations,
        isSearchMode,
        searchResults,
        selectedStatuses,
        selectedLocales,
        availableLocales,
        sortField,
        sortDirection,
      }) => ({
        isEmpty: computed(() => translations().length === 0),

        translationCount: computed(() => translations().length),

        hasTranslations: computed(() => translations().length > 0),

        displayedTranslations: computed(() => (isSearchMode() ? searchResults() : translations())),

        sortedTranslations: computed(() => {
          const items = isSearchMode() ? searchResults() : translations();
          const statuses = selectedStatuses();

          let filteredItems = items;
          if (statuses.length > 0) {
            const localesForFiltering = selectedLocales().length > 0 ? selectedLocales() : availableLocales();
            filteredItems = items.filter((item) => matchesAnyStatus(item, localesForFiltering, statuses));
          }

          return sortTranslations(filteredItems, sortField(), sortDirection(), selectedLocales());
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
          const locales = selectedLocales().length > 0 ? selectedLocales() : availableLocales();

          const counts: Record<TranslationStatus, number> = { new: 0, stale: 0, translated: 0, verified: 0 };
          for (const item of items) {
            for (const status of STATUS_PRECEDENCE) {
              if (matchesAnyStatus(item, locales, [status])) counts[status]++;
            }
          }
          return counts;
        }),

        /**
         * Resources with anything unfinished in the filtered locales. Counted as a
         * union rather than `new + stale`, because a resource that is new in one
         * locale and stale in another is one row, not two.
         */
        needsWorkCount: computed(() => {
          const items = isSearchMode() ? searchResults() : translations();
          const locales = selectedLocales().length > 0 ? selectedLocales() : availableLocales();
          return items.filter((item) => matchesAnyStatus(item, locales, NEEDS_WORK_STATUSES)).length;
        }),
      }),
    ),
    withMethods((store) => {
      const api = inject(BrowserApiService);
      const transloco = inject(TranslocoService);

      return {
        selectFolder: rxMethod<string>(
          pipe(
            tap((path) =>
              patchState(store, {
                currentFolderPath: path,
                isTranslationsLoading: true,
                error: null,
              }),
            ),
            switchMap((path) => {
              const collection = store.selectedCollection();
              const includeNested = store.showNestedResources();
              if (!collection) {
                patchState(store, { isTranslationsLoading: false });
                return of(null);
              }

              return api.getResourceTree(collection, path, includeNested).pipe(
                tap((tree) => {
                  if ('resources' in tree) {
                    patchState(store, {
                      translations: tree.resources,
                      isTranslationsLoading: false,
                      error: null,
                    });
                  } else {
                    patchState(store, { isTranslationsLoading: false });
                  }
                }),
                catchError((error: unknown) => {
                  patchState(store, {
                    isTranslationsLoading: false,
                    error: toErrorMessage(
                      error,
                      transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.LOADTRANSLATIONSFAILED),
                    ),
                  });
                  return of(null);
                }),
              );
            }),
          ),
        ),

        setTranslationsLoading(value: boolean): void {
          patchState(store, { isTranslationsLoading: value });
        },

        setNestedResources(value: boolean): void {
          if (value === store.showNestedResources()) return;
          patchState(store, { showNestedResources: value });
          this.selectFolder(store.currentFolderPath());
        },
      };
    }),
  );
}
