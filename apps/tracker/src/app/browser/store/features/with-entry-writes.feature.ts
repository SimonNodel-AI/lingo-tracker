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
 * How a Resource entry is written from the UI.
 *
 * Every method takes the entry's full dot-delimited key (or a DTO carrying it)
 * and returns the API call, so the caller still owns its own error handling —
 * the editor's 409 conflict dialog, a failure toast. On success the store brings
 * its caches in line before the caller hears back.
 *
 * Both caches (the folder list and the search results) are keyed by each
 * entry's full key, so an entry is found the same way in either.
 */
export function withEntryWritesFeature<_>() {
  return signalStoreFeature(
    {
      state: type<{
        currentFolderPath: string;
        translations: ResourceSummaryDto[];
        searchResults: SearchResultDto[];
      }>(),
      // Provided by withTranslationsFeature, which composes before this feature.
      methods: type<{ selectFolder(path: string): void }>(),
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
        /** Creates an entry, then reloads the current folder so the list shows it in place. */
        createResource(collectionName: string, dto: CreateResourceDto): Observable<CreateResourceResponseDto> {
          return api.createResource(collectionName, dto).pipe(tap(() => store.selectFolder(store.currentFolderPath())));
        },

        /**
         * Updates the entry `dto.key` names. A DTO with a `moveTo` (the collection
         * root included) moves the entry, so it leaves the caches. A DTO without
         * one is patched in place.
         */
        updateResource(collectionName: string, dto: UpdateResourceDto): Observable<UpdateResourceResponseDto> {
          return api.updateResource(collectionName, dto).pipe(
            tap((response) => {
              if (dto.moveTo !== undefined) {
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
