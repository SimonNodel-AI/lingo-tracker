import { inject } from '@angular/core';
import { patchState, signalStoreFeature, type, withMethods } from '@ngrx/signals';
import type {
  CreateResourceDto,
  CreateResourceResponseDto,
  DeleteResourceResponseDto,
  ResourceSummaryDto,
  SearchResultDto,
  TranslateResourceResponseDto,
  UpdateResourceDto,
  UpdateResourceResponseDto,
} from '@simoncodes-ca/data-transfer';
import { type Observable, tap } from 'rxjs';
import { BrowserApiService } from '../../services/browser-api.service';

/**
 * The key the folder list files an entry under: relative to the folder the list
 * shows (nested entries keep their sub-path), or undefined when the entry lies
 * outside that folder and so cannot be in the list.
 */
export function listKeyFor(fullKey: string, listFolderPath: string): string | undefined {
  if (!listFolderPath) {
    return fullKey;
  }
  const prefix = `${listFolderPath}.`;
  return fullKey.startsWith(prefix) ? fullKey.slice(prefix.length) : undefined;
}

/**
 * How a Resource entry is written from the UI.
 *
 * Every method takes the entry's full dot-delimited key (or a DTO carrying it)
 * and returns the API call, so the caller still owns its own error handling —
 * the editor's 409 conflict dialog, a failure toast. On success the store brings
 * its caches in line before the caller hears back.
 *
 * The caches are keyed by what they render: the folder list by the key relative
 * to its folder, search results by the full key. Callers never rewrite keys;
 * that happens here, once.
 */
export function withEntryWritesFeature<_>() {
  return signalStoreFeature(
    {
      state: type<{
        currentFolderPath: string;
        isSearchMode: boolean;
        translations: ResourceSummaryDto[];
        searchResults: SearchResultDto[];
      }>(),
      // Provided by withTranslationsFeature, which composes before this feature.
      methods: type<{ selectFolder(path: string): void }>(),
    },
    withMethods((store) => {
      const api = inject(BrowserApiService);

      /** Replaces the cached entry with what the server now holds, in both caches. */
      function patchEntry(fullKey: string, resource: ResourceSummaryDto): void {
        const listKey = listKeyFor(fullKey, store.currentFolderPath());
        if (listKey !== undefined) {
          patchState(store, {
            translations: store
              .translations()
              .map((entry) => (entry.key === listKey ? { ...resource, key: listKey } : entry)),
          });
        }

        if (store.isSearchMode()) {
          patchState(store, {
            searchResults: store
              .searchResults()
              .map((result) => (result.key === fullKey ? { ...result, ...resource, key: fullKey } : result)),
          });
        }
      }

      /** Drops an entry that no longer lives where the caches show it. */
      function dropEntry(fullKey: string): void {
        const listKey = listKeyFor(fullKey, store.currentFolderPath());
        if (listKey !== undefined) {
          patchState(store, { translations: store.translations().filter((entry) => entry.key !== listKey) });
        }

        if (store.isSearchMode()) {
          patchState(store, { searchResults: store.searchResults().filter((result) => result.key !== fullKey) });
        }
      }

      return {
        /** Creates an entry, then reloads the current folder so the list shows it in place. */
        createResource(collectionName: string, dto: CreateResourceDto): Observable<CreateResourceResponseDto> {
          return api.createResource(collectionName, dto).pipe(tap(() => store.selectFolder(store.currentFolderPath())));
        },

        /**
         * Updates the entry `dto.key` names. A DTO with a `targetFolder` moves the
         * entry, so it leaves the caches. A DTO without one, including a move to
         * the collection root (see `toUpdateDto`), is patched in place.
         */
        updateResource(collectionName: string, dto: UpdateResourceDto): Observable<UpdateResourceResponseDto> {
          return api.updateResource(collectionName, dto).pipe(
            tap((response) => {
              if (dto.targetFolder !== undefined) {
                dropEntry(dto.key);
              } else if (response.resource) {
                patchEntry(dto.key, response.resource);
              }
            }),
          );
        },

        /** Deletes one entry and drops it from the caches once the server confirms it. */
        deleteResource(collectionName: string, fullKey: string): Observable<DeleteResourceResponseDto> {
          return api.deleteResource(collectionName, [fullKey]).pipe(
            tap((response) => {
              if (response.entriesDeleted > 0) {
                dropEntry(fullKey);
              }
            }),
          );
        },

        /** Auto-translates one entry and patches the caches with the result. */
        translateResource(collectionName: string, fullKey: string): Observable<TranslateResourceResponseDto> {
          return api
            .translateResource(collectionName, fullKey)
            .pipe(tap((response) => patchEntry(fullKey, response.resource)));
        },
      };
    }),
  );
}
