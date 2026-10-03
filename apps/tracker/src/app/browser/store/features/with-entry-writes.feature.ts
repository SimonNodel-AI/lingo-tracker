import { inject } from '@angular/core';
import { patchState, signalStoreFeature, type, withMethods } from '@ngrx/signals';
import type {
  CreateResourceDto,
  CreateResourceResponseDto,
  ResourceSummaryDto,
  SearchResultDto,
  UpdateResourceDto,
  UpdateResourceResponseDto,
} from '@simoncodes-ca/data-transfer';
import { catchError, defer, from, map, type Observable, of, switchMap, tap } from 'rxjs';
import { BrowserApiService } from '../../services/browser-api.service';
import { captureSession } from '../session-guard';
import { doesUpdateMoveEntry } from '../does-update-move-entry';
import {
  type DeleteResourceOutcome,
  deleteOutcome,
  decideDeleteResource,
  decideTranslateResource,
  deleteRefusal,
  translateRefusal,
  type RequestedEntryDeleteOutcome,
  type TranslateResourceOutcome,
  translateOutcome,
} from '../resource-write-outcome';

/**
 * Entry Writes owns the read-only rule, session validity and decided feedback for delete/translate.
 * Calls are cold. Create/update are pass-through for the editor's API response and error contract,
 * including 409 conflicts; Editor Submit enforces read-only for those writes.
 * They only update caches in their original Browser Session.
 * Both the folder list and search results are addressed by the entry's full key.
 */
export function withEntryWritesFeature<_>() {
  return signalStoreFeature(
    {
      state: type<{
        sessionId: number;
        selectedCollection: string | null;
        isReadOnly: boolean;
        translations: ResourceSummaryDto[];
        searchResults: SearchResultDto[];
      }>(),
      // Provided by withListScopeFeature, which composes before this feature.
      methods: type<{ reloadList(): void }>(),
    },
    withMethods((store) => {
      const api = inject(BrowserApiService);

      /** Replaces the cached entry with what the server now holds, in both caches. A cache without it is left as is. */
      function patchEntry(fullKey: string, resource: ResourceSummaryDto): void {
        const translations = store.translations();
        const searchResults = store.searchResults();
        patchState(store, {
          translations: translations.some((entry) => entry.fullKey === fullKey)
            ? translations.map((entry) => (entry.fullKey === fullKey ? resource : entry))
            : translations,
          searchResults: searchResults.some((result) => result.fullKey === fullKey)
            ? searchResults.map((result) => (result.fullKey === fullKey ? { ...result, ...resource } : result))
            : searchResults,
        });
      }

      /** Drops an entry that no longer lives where the caches show it. */
      function dropEntry(fullKey: string): void {
        patchState(store, {
          translations: store.translations().filter((entry) => entry.fullKey !== fullKey),
          searchResults: store.searchResults().filter((result) => result.fullKey !== fullKey),
        });
      }

      function deleteResource(fullKey: string): Observable<DeleteResourceOutcome> {
        return defer(() => {
          if (store.isReadOnly()) return of(decideDeleteResource({ kind: 'read-only' }));
          const collection = store.selectedCollection();
          if (!collection) return of(decideDeleteResource({ kind: 'no-collection' }));
          const inSession = captureSession(store);
          return api.deleteResource(collection, [fullKey]).pipe(
            map((response) => {
              if (!inSession()) return decideDeleteResource({ kind: 'stale-session' });
              if (response.entriesDeleted > 0) dropEntry(fullKey);
              return decideDeleteResource(deleteOutcome(response));
            }),
            catchError((error: unknown) =>
              of(inSession() ? deleteRefusal(error) : decideDeleteResource({ kind: 'stale-session' })),
            ),
          );
        });
      }

      return {
        /** Creates an entry, then reloads the List Scope so the list shows it in place. */
        createResource(collectionName: string, dto: CreateResourceDto): Observable<CreateResourceResponseDto> {
          return defer(() => {
            const inSession = captureSession(store);
            return api.createResource(collectionName, dto).pipe(tap(() => inSession() && store.reloadList()));
          });
        },

        /**
         * Updates the entry `dto.key` names. A DTO with a `moveTo` (the collection
         * root included) moves the entry, so it leaves the caches. A DTO without
         * one is patched in place.
         */
        updateResource(collectionName: string, dto: UpdateResourceDto): Observable<UpdateResourceResponseDto> {
          return defer(() => {
            const inSession = captureSession(store);
            return api.updateResource(collectionName, dto).pipe(
              tap((response) => {
                if (!inSession()) return;
                if (doesUpdateMoveEntry(dto)) {
                  dropEntry(dto.key);
                } else if (response.resource) {
                  patchEntry(dto.key, response.resource);
                }
              }),
            );
          });
        },

        /** Deletes one entry and returns its decided feedback, without an error channel. */
        deleteResource,

        /** The caller presents confirmation; the store owns guards and the eventual write. */
        requestEntryDelete(
          fullKey: string,
          confirm: (inSession: () => boolean) => Promise<boolean>,
        ): Observable<RequestedEntryDeleteOutcome> {
          return defer(() => {
            if (store.isReadOnly()) return of(decideDeleteResource({ kind: 'read-only' }));
            if (!store.selectedCollection()) return of(decideDeleteResource({ kind: 'no-collection' }));
            const inSession = captureSession(store);
            return from(confirm(inSession)).pipe(
              switchMap((yes) => {
                if (!inSession()) return of(decideDeleteResource({ kind: 'stale-session' }));
                if (!yes) return of({ kind: 'cancelled', feedback: null } as const);
                return deleteResource(fullKey);
              }),
            );
          });
        },

        /** Auto-translates one entry and returns the decided toasts in their existing order. */
        translateResource(fullKey: string): Observable<TranslateResourceOutcome> {
          return defer(() => {
            if (store.isReadOnly()) return of(decideTranslateResource({ kind: 'read-only' }));
            const collection = store.selectedCollection();
            if (!collection) return of(decideTranslateResource({ kind: 'no-collection' }));
            const inSession = captureSession(store);
            return api.translateResource(collection, fullKey).pipe(
              map((response) => {
                if (!inSession()) return decideTranslateResource({ kind: 'stale-session' });
                patchEntry(fullKey, response.resource);
                return decideTranslateResource(translateOutcome(response));
              }),
              catchError((error: unknown) =>
                of(inSession() ? translateRefusal(error) : decideTranslateResource({ kind: 'stale-session' })),
              ),
            );
          });
        },
      };
    }),
  );
}
