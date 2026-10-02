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
import { catchError, map, type Observable, of, tap } from 'rxjs';
import { BrowserApiService } from '../../services/browser-api.service';
import { captureSession } from '../session-guard';
import { doesUpdateMoveEntry } from '../does-update-move-entry';
import {
  type DeleteResourceOutcome,
  deleteOutcome,
  type TranslateResourceOutcome,
  translateOutcome,
} from '../resource-write-outcome';

/**
 * How a Resource entry is written from the UI.
 *
 * Every method takes the entry's full dot-delimited key (or a DTO carrying it).
 * `createResource` and `updateResource` return the API call, so the caller owns its
 * own error handling (the editor's 409 conflict dialog). `deleteResource` and
 * `translateResource` return an outcome (`resource-write-outcome.ts`) that never
 * errors; the row actions decide its toast. On success the store brings
 * its caches in line before the caller hears back, but only in the Browser
 * Session (`sessionId`) that was open when the call was made: a write whose
 * response arrives after another collection has opened (the translation editor
 * dialog's `updateResource` subscription can outlive the browser) still resolves
 * for the caller, but does not patch or drop a row in the session that replaced
 * it.
 *
 * Both caches (the folder list and the search results) are keyed by each
 * entry's full key, so an entry is found the same way in either.
 */
export function withEntryWritesFeature<_>() {
  return signalStoreFeature(
    {
      state: type<{
        sessionId: number;
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

      return {
        /** Creates an entry, then reloads the List Scope so the list shows it in place. */
        createResource(collectionName: string, dto: CreateResourceDto): Observable<CreateResourceResponseDto> {
          const inSession = captureSession(store);
          // The caller still gets its response; only the store write is session-guarded.
          return api.createResource(collectionName, dto).pipe(tap(() => inSession() && store.reloadList()));
        },

        /**
         * Updates the entry `dto.key` names. A DTO with a `moveTo` (the collection
         * root included) moves the entry, so it leaves the caches. A DTO without
         * one is patched in place.
         */
        updateResource(collectionName: string, dto: UpdateResourceDto): Observable<UpdateResourceResponseDto> {
          const inSession = captureSession(store);
          // The caller still gets its response; only the store write is session-guarded.
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
        },

        /**
         * Deletes one entry and drops it from the caches once the server confirms it. Never errors:
         * a failed request is the `refused` outcome.
         */
        deleteResource(collectionName: string, fullKey: string): Observable<DeleteResourceOutcome> {
          const inSession = captureSession(store);
          // The caller still gets its outcome; only the store write is session-guarded.
          return api.deleteResource(collectionName, [fullKey]).pipe(
            tap((response) => {
              if (inSession() && response.entriesDeleted > 0) {
                dropEntry(fullKey);
              }
            }),
            map(deleteOutcome),
            catchError((error: unknown) => of<DeleteResourceOutcome>({ kind: 'refused', error })),
          );
        },

        /**
         * Auto-translates one entry and patches the caches with the result. Never errors: a failed
         * request is the `refused` outcome.
         */
        translateResource(collectionName: string, fullKey: string): Observable<TranslateResourceOutcome> {
          const inSession = captureSession(store);
          // The caller still gets its outcome; only the store write is session-guarded.
          return api.translateResource(collectionName, fullKey).pipe(
            tap((response) => inSession() && patchEntry(fullKey, response.resource)),
            map(translateOutcome),
            catchError((error: unknown) => of<TranslateResourceOutcome>({ kind: 'refused', error })),
          );
        },
      };
    }),
  );
}
