import { computed, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import type {
  CreateCollectionDto,
  LingoTrackerCollectionDto,
  LingoTrackerConfigDto,
  PreferredTermRuleErrorDto,
  UpdateCollectionDto,
  UpdateConfigDto,
} from '@simoncodes-ca/data-transfer';
import { catchError, of, pipe, switchMap, tap } from 'rxjs';
import { TRACKER_TOKENS } from '../../../i18n-types/tracker-resources';
import { ApiError, apiErrorMessage } from '../../shared/api-error/api-error';
import { CollectionsApiService } from '../services/collections-api.service';
import { withBundlesFeature } from './features/with-bundles.feature';

/**
 * State interface for the Collections store.
 */
interface CollectionsState {
  /** Full LingoTracker configuration including global settings and collections */
  config: LingoTrackerConfigDto | null;

  /** Loading state for async operations */
  isLoading: boolean;

  /** Error message if an operation fails */
  error: string | null;

  /**
   * Per-row preferred-terminology errors from the last failed `updateGlobalConfig`, indexed
   * by row of the submitted list. Empty unless the server rejected the rules with a 400.
   */
  configRuleErrors: PreferredTermRuleErrorDto[];
}

/** True for a value shaped like one row of `PreferredTermRulesErrorResponseDto['errors']`. */
function isPreferredTermRuleErrorDto(value: unknown): value is PreferredTermRuleErrorDto {
  if (typeof value !== 'object' || value === null) return false;
  const { index, field, code, message } = value as Record<string, unknown>;
  return (
    typeof index === 'number' && typeof field === 'string' && typeof code === 'string' && typeof message === 'string'
  );
}

/**
 * The per-row rule errors of a rejected `PUT /api/config`. The API's config controller is the
 * only source of an `invalid` answer with details on that route, and its `errors` are
 * `PreferredTermRuleErrorDto[]` (`PreferredTermRulesErrorResponseDto`). Anything that does not
 * carry the DTO's required fields is dropped rather than trusted.
 */
function extractRuleErrors(error: unknown): PreferredTermRuleErrorDto[] {
  if (!(error instanceof ApiError) || error.kind !== 'invalid') return [];
  return error.details.filter(isPreferredTermRuleErrorDto);
}

/**
 * Initial state for the Collections store.
 */
const initialState: CollectionsState = {
  config: null,
  isLoading: false,
  error: null,
  configRuleErrors: [],
};

/**
 * Signal store for managing collections state.
 *
 * @example
 * // In component
 * export class CollectionsManager {
 *   readonly store = inject(CollectionsStore);
 *
 *   ngOnInit() {
 *     this.store.loadCollections();
 *   }
 * }
 */
export const CollectionsStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ config }) => ({
    /**
     * Converts collections Record to array of [name, config] tuples for iteration.
     */
    collectionEntries: computed(() => {
      const cfg = config();
      if (!cfg?.collections) return [];
      return Object.entries(cfg.collections).map(([name, collection]) => ({ name, config: collection }) as const);
    }),

    /**
     * Converts collections to array with resolved locales for each collection.
     * Collections inherit global locales unless they specify their own.
     */
    collectionEntriesWithLocales: computed(() => {
      const cfg = config();
      if (!cfg?.collections) return [];
      return Object.entries(cfg.collections).map(([name, collection]) => {
        const coll = collection as LingoTrackerCollectionDto;
        return {
          name,
          config: coll,
          locales: coll.locales || cfg.locales,
          baseLocale: coll.baseLocale || cfg.baseLocale,
        };
      });
    }),

    /**
     * Returns true if there are any collections.
     */
    hasCollections: computed(() => {
      const cfg = config();
      return cfg?.collections ? Object.keys(cfg.collections).length > 0 : false;
    }),

    /**
     * Returns the collections object for direct access.
     */
    collections: computed(() => config()?.collections || {}),
  })),
  withMethods((store) => {
    const api = inject(CollectionsApiService);
    const transloco = inject(TranslocoService);

    return {
      /**
       * Loads all collections from the API configuration.
       */
      loadCollections: rxMethod<void>(
        pipe(
          tap(() => patchState(store, { isLoading: true, error: null })),
          switchMap(() =>
            api.getConfig().pipe(
              tap((configData) => {
                patchState(store, {
                  config: configData,
                  isLoading: false,
                  error: null,
                });
              }),
              catchError((error: unknown) => {
                const errorMessage = apiErrorMessage(
                  error,
                  transloco.translate(TRACKER_TOKENS.COLLECTIONS.TOAST.LOADFAILED),
                );
                patchState(store, {
                  isLoading: false,
                  error: errorMessage,
                });
                return of(null);
              }),
            ),
          ),
        ),
      ),

      /**
       * Creates a new collection and reloads the configuration.
       */
      createCollection: rxMethod<CreateCollectionDto>(
        pipe(
          tap(() => patchState(store, { isLoading: true, error: null })),
          switchMap((data) =>
            api.createCollection(data).pipe(
              tap(() => {
                // Reload collections after successful creation
                patchState(store, { isLoading: false });
              }),
              switchMap(() => api.getConfig()),
              tap((configData) => {
                patchState(store, {
                  config: configData,
                  error: null,
                });
              }),
              catchError((error: unknown) => {
                const errorMessage = apiErrorMessage(
                  error,
                  transloco.translate(TRACKER_TOKENS.COLLECTIONS.TOAST.CREATEFAILED),
                );
                patchState(store, {
                  isLoading: false,
                  error: errorMessage,
                });
                return of(null);
              }),
            ),
          ),
        ),
      ),

      /**
       * Updates an existing collection and reloads the configuration.
       */
      updateCollection: rxMethod<{
        oldName: string;
        newName?: string;
        collection: LingoTrackerCollectionDto;
      }>(
        pipe(
          tap(() => patchState(store, { isLoading: true, error: null })),
          switchMap(({ oldName, newName, collection }) => {
            const updateDto: UpdateCollectionDto = {
              name: newName,
              collection,
            };
            return api.updateCollection(oldName, updateDto).pipe(
              tap(() => {
                // Reload collections after successful update
                patchState(store, { isLoading: false });
              }),
              switchMap(() => api.getConfig()),
              tap((configData) => {
                patchState(store, {
                  config: configData,
                  error: null,
                });
              }),
              catchError((error: unknown) => {
                const errorMessage = apiErrorMessage(
                  error,
                  transloco.translate(TRACKER_TOKENS.COLLECTIONS.TOAST.UPDATEFAILED),
                );
                patchState(store, {
                  isLoading: false,
                  error: errorMessage,
                });
                return of(null);
              }),
            );
          }),
        ),
      ),

      /**
       * Updates global configuration fields (e.g., protected terms) and reloads.
       */
      updateGlobalConfig: rxMethod<UpdateConfigDto>(
        pipe(
          tap(() => patchState(store, { isLoading: true, error: null, configRuleErrors: [] })),
          switchMap((dto) =>
            api.updateConfig(dto).pipe(
              tap(() => {
                patchState(store, { isLoading: false });
              }),
              switchMap(() => api.getConfig()),
              tap((configData) => {
                patchState(store, {
                  config: configData,
                  error: null,
                });
              }),
              catchError((error: unknown) => {
                const errorMessage = apiErrorMessage(
                  error,
                  transloco.translate(TRACKER_TOKENS.COLLECTIONS.TOAST.UPDATEFAILED),
                );
                patchState(store, {
                  isLoading: false,
                  error: errorMessage,
                  configRuleErrors: extractRuleErrors(error),
                });
                return of(null);
              }),
            ),
          ),
        ),
      ),

      /**
       * Deletes a collection and reloads the configuration.
       */
      deleteCollection: rxMethod<string>(
        pipe(
          tap(() => patchState(store, { isLoading: true, error: null })),
          switchMap((name) =>
            api.deleteCollection(name).pipe(
              tap(() => {
                // Reload collections after successful deletion
                patchState(store, { isLoading: false });
              }),
              switchMap(() => api.getConfig()),
              tap((configData) => {
                patchState(store, {
                  config: configData,
                  error: null,
                });
              }),
              catchError((error: unknown) => {
                const errorMessage = apiErrorMessage(
                  error,
                  transloco.translate(TRACKER_TOKENS.COLLECTIONS.TOAST.DELETEFAILED),
                );
                patchState(store, {
                  isLoading: false,
                  error: errorMessage,
                });
                return of(null);
              }),
            ),
          ),
        ),
      ),

      /**
       * Sets an error message.
       */
      setError(message: string): void {
        patchState(store, { error: message });
      },

      /**
       * Clears the error message.
       */
      clearError(): void {
        patchState(store, { error: null });
      },
    };
  }),
  withBundlesFeature(),
);
