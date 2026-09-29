import { computed, inject } from '@angular/core';
import { signalStoreFeature, withState, withComputed, withMethods, patchState, type } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { EMPTY, type Observable, catchError, map, of, pipe, switchMap, tap } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import type { ResourceSummaryDto, SearchResultDto } from '@simoncodes-ca/data-transfer';
import { NotificationService } from '../../../shared/notification';
import { BrowserApiService, CollectionIndexNotReadyError } from '../../services/browser-api.service';
import { apiErrorMessage } from '../../../shared/api-error/api-error';
import { TRACKER_TOKENS } from '../../../../i18n-types/tracker-resources';
import { captureSession, type SessionCheck, withinSession } from '../session-guard';

/** What the translation list shows: one folder's resources, or the hits of one search query. */
export type ListScope = { kind: 'folder'; path: string } | { kind: 'search'; query: string };

export interface ListScopeState {
  listScope: ListScope;
  /** The folder's rows. Kept while a search is shown, so clearing the search returns to them. */
  translations: ResourceSummaryDto[];
  /** The folder `translations` were loaded for; `null` when they belong to no folder yet. */
  loadedFolderPath: string | null;
  searchResults: SearchResultDto[];
  /** A load of the List Scope is in flight: the one busy state of the list. */
  isListLoading: boolean;
  /** A load has succeeded in this Browser Session, so there is a list on screen to keep. */
  listLoaded: boolean;
  showNestedResources: boolean;
}

export const initialListScopeState: ListScopeState = {
  listScope: { kind: 'folder', path: '' },
  translations: [],
  loadedFolderPath: null,
  searchResults: [],
  isListLoading: false,
  listLoaded: false,
  showNestedResources: true,
};

/** One load of the List Scope, with everything captured when it was asked for. */
interface ListLoad {
  scope: ListScope;
  collection: string;
  includeNested: boolean;
  inSession: SessionCheck;
  /** What was on screen before, to go back to when the index is not ready (see `fail`). */
  shown: { listScope: ListScope; currentFolderPath: string };
}

/**
 * The List Scope: the one owner of what the translation list shows, and of every load of it.
 *
 * Other code asks it to show a folder (`showFolder`) or a query (`showQuery`), to go back to
 * the folder behind a search (`clearSearch`), or to load what it shows again (`reloadList`).
 * It writes `currentFolderPath`, the rows, and the busy flag; nothing else does.
 *
 * Every load runs through one `switchMap`, so the newest scope wins and an older load is
 * cancelled, not merely ignored: its HTTP request and any not-ready retries stop. The Browser
 * Session cancels the same way when it opens a collection (`_cancelListLoads`). One rule for a
 * failed load: when the index is not ready and a list has already loaded in this session, the
 * list keeps what it showed and a toast says why; any other failure is the list's `error`.
 */
export function withListScopeFeature<_>() {
  return signalStoreFeature(
    {
      state: type<{
        sessionId: number;
        selectedCollection: string | null;
        currentFolderPath: string;
        error: string | null;
      }>(),
    },
    withState(initialListScopeState),
    withComputed(({ listScope, isListLoading }) => ({
      isSearchMode: computed(() => listScope().kind === 'search'),
      searchQuery: computed(() => {
        const scope = listScope();
        return scope.kind === 'search' ? scope.query : '';
      }),
      /** The list's spinner: a folder load. A search keeps the rows up and spins in the search box. */
      isTranslationsLoading: computed(() => isListLoading() && listScope().kind === 'folder'),
      isSearchLoading: computed(() => isListLoading() && listScope().kind === 'search'),
    })),
    withMethods((store) => {
      const api = inject(BrowserApiService);
      const transloco = inject(TranslocoService);
      const notifications = inject(NotificationService);

      function request({ scope, collection, includeNested }: ListLoad): Observable<Partial<ListScopeState>> {
        if (scope.kind === 'folder') {
          return api
            .getResourceTree(collection, scope.path, includeNested)
            .pipe(map((tree) => ({ translations: tree.resources, loadedFolderPath: scope.path })));
        }
        return api.searchTranslations(collection, scope.query).pipe(map((found) => ({ searchResults: found.results })));
      }

      function fail(load: ListLoad, error: unknown): void {
        const fallback =
          load.scope.kind === 'folder'
            ? TRACKER_TOKENS.BROWSER.TOAST.LOADTRANSLATIONSFAILED
            : TRACKER_TOKENS.BROWSER.TOAST.SEARCHTRANSLATIONSFAILED;
        const message = apiErrorMessage(error, transloco.translate(fallback));
        // The index can go not-ready mid-session. Once a list is on screen, keep it and the scope
        // it shows, and toast: the `error` state would replace it.
        if (error instanceof CollectionIndexNotReadyError && store.listLoaded()) {
          patchState(store, { isListLoading: false, ...load.shown });
          notifications.error(message);
          return;
        }
        patchState(store, { isListLoading: false, error: message });
      }

      const runLoads = rxMethod<ListLoad | null>(
        pipe(
          switchMap((load) => {
            if (!load) return EMPTY;
            return request(load).pipe(
              withinSession(load.inSession),
              // `error` was cleared when the load started; clearing it again here would hide a failure of
              // the folder tree's own load, which runs beside the list's when a collection opens.
              tap((rows) => patchState(store, { ...rows, isListLoading: false, listLoaded: true })),
              catchError((error: unknown) => {
                fail(load, error);
                return of(null);
              }),
            );
          }),
        ),
      );

      /** Makes `scope` the one the list shows and loads it. */
      function show(scope: ListScope): void {
        const shown = { listScope: store.listScope(), currentFolderPath: store.currentFolderPath() };
        const collection = store.selectedCollection();
        patchState(store, {
          listScope: scope,
          ...(scope.kind === 'folder' && { currentFolderPath: scope.path }),
          // Hits of an earlier search must not stand in for this one's while it loads.
          ...(scope.kind === 'search' && shown.listScope.kind !== 'search' && { searchResults: [] }),
          isListLoading: collection !== null,
          error: null,
        });
        if (!collection) return;
        runLoads({
          scope,
          collection,
          includeNested: store.showNestedResources(),
          inSession: captureSession(store),
          shown,
        });
      }

      return {
        /** Shows one folder's resources (leaving a search, if one is shown). */
        showFolder(path: string): void {
          show({ kind: 'folder', path });
        },

        /** Shows the hits of a search query. A blank query is `clearSearch`. */
        showQuery(query: string): void {
          if (query.trim().length === 0) {
            this.clearSearch();
            return;
          }
          show({ kind: 'search', query });
        },

        /**
         * Goes back to the folder behind the search. Its rows are shown as they are when they
         * were loaded for that folder; otherwise (a search cut the folder's load short) it is loaded.
         */
        clearSearch(): void {
          const path = store.currentFolderPath();
          if (store.loadedFolderPath() !== path) {
            show({ kind: 'folder', path });
            return;
          }
          runLoads(null);
          patchState(store, { listScope: { kind: 'folder', path }, isListLoading: false, error: null });
        },

        /** Loads what the list shows again: after a write, or from the list's Retry. */
        reloadList(): void {
          show(store.listScope());
        },

        setNestedResources(value: boolean): void {
          if (value === store.showNestedResources()) return;
          // Rows loaded under the other setting no longer belong to any folder view.
          patchState(store, { showNestedResources: value, loadedFolderPath: null });
          if (store.listScope().kind === 'folder') this.reloadList();
        },

        /** Stops every load in flight. The Browser Session calls it when it opens a collection. */
        _cancelListLoads(): void {
          runLoads(null);
        },
      };
    }),
  );
}
