import { inject } from '@angular/core';
import { signalStoreFeature, type, withMethods } from '@ngrx/signals';
import type {
  CreateResourceDto,
  CreateResourceResponseDto,
  ResourceSummaryDto,
  UpdateResourceDto,
  UpdateResourceResponseDto,
} from '@simoncodes-ca/data-transfer';
import { catchError, defer, from, map, type Observable, of, switchMap, tap } from 'rxjs';
import { BrowserApiService } from '../../services/browser-api.service';
import { doesUpdateMoveEntry } from '../does-update-move-entry';
import {
  type DeleteResourceOutcome,
  decideDeleteResource,
  decideTranslateResource,
  deleteOutcome,
  deleteRefusal,
  type RequestedEntryDeleteOutcome,
  type TranslateResourceOutcome,
  translateOutcome,
  translateRefusal,
} from '../resource-write-outcome';
import { captureSession } from '../session-guard';

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
      }>(),
      methods: type<{
        reloadList(): void;
        replaceEntry(key: string, resource: ResourceSummaryDto): void;
        removeEntry(key: string): void;
      }>(),
    },
    withMethods((store) => {
      const api = inject(BrowserApiService);

      function deleteResource(fullKey: string): Observable<DeleteResourceOutcome> {
        return defer(() => {
          if (store.isReadOnly()) return of(decideDeleteResource({ kind: 'read-only' }));
          const collection = store.selectedCollection();
          if (!collection) return of(decideDeleteResource({ kind: 'no-collection' }));
          const inSession = captureSession(store);
          return api.deleteResource(collection, [fullKey]).pipe(
            map((response) => {
              if (!inSession()) return decideDeleteResource({ kind: 'stale-session' });
              if (response.entriesDeleted > 0) store.removeEntry(fullKey);
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
                  store.removeEntry(dto.key);
                } else if (response.resource) {
                  store.replaceEntry(dto.key, response.resource);
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
                store.replaceEntry(fullKey, response.resource);
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
