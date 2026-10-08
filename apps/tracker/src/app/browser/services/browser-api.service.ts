import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, type HttpResponse } from '@angular/common/http';
import { concatWith, ignoreElements, map, type Observable, defer, switchMap } from 'rxjs';
import { CollectionIndexNotReadyError, INDEX_NOT_READY_MESSAGE, IndexReadiness } from './index-readiness';
import type {
  ResourceTreeDto,
  TreeStatusResponseDto,
  SearchResultsDto,
  SearchTranslationsDto,
  CacheStatusDto,
  CreateResourceDto,
  CreateResourceResponseDto,
  UpdateResourceDto,
  UpdateResourceResponseDto,
  DeleteResourceDto,
  DeleteResourceResponseDto,
  CreateFolderDto,
  CreateFolderResponseDto,
  DeleteFolderDto,
  DeleteFolderResponseDto,
  MoveResourceDto,
  MoveResourceResponseDto,
  MoveFolderDto,
  MoveFolderResponseDto,
  TranslateResourceDto,
  TranslateResourceResponseDto,
} from '@simoncodes-ca/data-transfer';

function treeStatusMessage(body: ResourceTreeDto | TreeStatusResponseDto | null): string {
  const status = body && 'message' in body ? body : null;
  return status?.message || INDEX_NOT_READY_MESSAGE;
}

/**
 * API service for browser-related operations.
 */
@Injectable({
  providedIn: 'root',
})
export class BrowserApiService {
  readonly #http = inject(HttpClient);
  readonly #indexReadiness = inject(IndexReadiness);
  readonly #baseUrl = '/api/collections';

  /**
   * Gets the cache status for a collection.
   *
   * @param collectionName - Name of the collection
   * @returns Observable of CacheStatusDto
   */
  getCacheStatus(collectionName: string): Observable<CacheStatusDto> {
    const encodedName = encodeURIComponent(collectionName);
    return this.#http.get<CacheStatusDto>(`${this.#baseUrl}/${encodedName}/resources/cache/status`);
  }

  /**
   * Gets the resource tree (or the subtree at `path`) for a collection.
   *
   * While the collection is still being indexed the endpoint answers HTTP 202 with a
   * status body instead of a tree. Index Readiness waits up to five seconds for readiness,
   * then this service requests the tree once more on readiness or at the deadline.
   * A second 202 fails with CollectionIndexNotReadyError. Polling failures have that
   * error type too; tree-request HTTP failures pass through without retry.
   *
   * @param collectionName - Name of the collection
   * @param path - Folder path (empty string for root)
   * @param includeNested - Whether to include nested resources in the resources array
   */
  getResourceTree(collectionName: string, path = '', includeNested = false): Observable<ResourceTreeDto> {
    const encodedName = encodeURIComponent(collectionName);
    const params = new HttpParams().set('path', path).set('includeNested', includeNested.toString());

    const request = () =>
      this.#http.get<ResourceTreeDto | TreeStatusResponseDto>(`${this.#baseUrl}/${encodedName}/resources/tree`, {
        params,
        observe: 'response',
      });
    const treeBody = (response: HttpResponse<ResourceTreeDto | TreeStatusResponseDto>) => {
      if (response.status === 202) {
        throw new CollectionIndexNotReadyError(treeStatusMessage(response.body));
      }
      return response.body as ResourceTreeDto;
    };

    return request().pipe(
      switchMap((response) =>
        response.status === 202
          ? this.#indexReadiness
              .whenReady(() => this.getCacheStatus(collectionName), 'treeRead', treeStatusMessage(response.body))
              .pipe(ignoreElements(), concatWith(defer(request).pipe(map(treeBody))))
          : [treeBody(response)],
      ),
    );
  }

  /**
   * Searches translations within a collection.
   *
   * @param collectionName - Name of the collection to search
   * @param query - Search query string
   * @param maxResults - Maximum results to return (default: 100)
   * @param mode - `text` (default): keys and values; `similar`: base values similar to the query, ranked by similarity
   * @returns Observable of search results
   */
  searchTranslations(
    collectionName: string,
    query: string,
    maxResults = 100,
    mode?: SearchTranslationsDto['mode'],
  ): Observable<SearchResultsDto> {
    let params = new HttpParams().set('query', query).set('maxResults', maxResults.toString());
    if (mode) {
      params = params.set('mode', mode);
    }

    const encodedName = encodeURIComponent(collectionName);
    return this.#http.get<SearchResultsDto>(`${this.#baseUrl}/${encodedName}/resources/search`, { params });
  }

  /**
   * Creates a new translation resource.
   *
   * @param collectionName - Name of the collection
   * @param dto - Resource creation data
   * @returns Observable of creation response
   */
  createResource(collectionName: string, dto: CreateResourceDto): Observable<CreateResourceResponseDto> {
    const encodedName = encodeURIComponent(collectionName);
    return this.#http.post<CreateResourceResponseDto>(`${this.#baseUrl}/${encodedName}/resources`, dto);
  }

  /**
   * Updates an existing translation resource.
   *
   * @param collectionName - Name of the collection
   * @param dto - Resource update data
   * @returns Observable of update response
   */
  updateResource(collectionName: string, dto: UpdateResourceDto): Observable<UpdateResourceResponseDto> {
    const encodedName = encodeURIComponent(collectionName);
    return this.#http.patch<UpdateResourceResponseDto>(`${this.#baseUrl}/${encodedName}/resources`, dto);
  }

  /**
   * Deletes one or more translation resources.
   *
   * @param collectionName - Name of the collection
   * @param resourceKeys - Array of resource keys to delete
   * @returns Observable of deletion response
   */
  deleteResource(collectionName: string, resourceKeys: string[]): Observable<DeleteResourceResponseDto> {
    const encodedName = encodeURIComponent(collectionName);
    const dto: DeleteResourceDto = { keys: resourceKeys };
    return this.#http.request<DeleteResourceResponseDto>('DELETE', `${this.#baseUrl}/${encodedName}/resources`, {
      body: dto,
    });
  }

  /**
   * Creates a new folder in a collection.
   *
   * @param collectionName - Name of the collection
   * @param folderName - Name of the folder to create
   * @param parentPath - Optional parent path where folder should be created
   * @returns Observable of folder creation response
   */
  createFolder(collectionName: string, folderName: string, parentPath?: string): Observable<CreateFolderResponseDto> {
    const encodedName = encodeURIComponent(collectionName);
    const dto: CreateFolderDto = {
      folderName,
      ...(parentPath !== undefined && { parentPath }),
    };
    return this.#http.post<CreateFolderResponseDto>(`${this.#baseUrl}/${encodedName}/folders`, dto);
  }

  /**
   * Deletes a folder and all its resources from a collection.
   *
   * @param collectionName - Name of the collection
   * @param folderPath - Dot-delimited folder path to delete
   * @returns Observable of folder deletion response
   */
  deleteFolder(collectionName: string, folderPath: string): Observable<DeleteFolderResponseDto> {
    const encodedName = encodeURIComponent(collectionName);
    const dto: DeleteFolderDto = { folderPath };
    return this.#http.request<DeleteFolderResponseDto>('DELETE', `${this.#baseUrl}/${encodedName}/folders`, {
      body: dto,
    });
  }

  /**
   * Moves a translation resource to a different folder.
   *
   * @param collectionName - Name of the collection
   * @param sourceKey - Full key of the resource to move
   * @param destinationKey - Full destination key (including folder path and entry name)
   * @returns Observable of move response
   */
  moveResource(collectionName: string, sourceKey: string, destinationKey: string): Observable<MoveResourceResponseDto> {
    const encodedName = encodeURIComponent(collectionName);
    const dto: MoveResourceDto = {
      moves: [
        {
          source: sourceKey,
          destination: destinationKey,
        },
      ],
    };
    return this.#http.post<MoveResourceResponseDto>(`${this.#baseUrl}/${encodedName}/resources/move`, dto);
  }

  /**
   * Moves a folder and all its contents to a different location.
   *
   * @param collectionName - Name of the collection
   * @param sourceFolderPath - Dot-delimited source folder path
   * @param destinationFolderPath - Dot-delimited destination folder path
   * @returns Observable of move response
   */
  moveFolder(
    collectionName: string,
    sourceFolderPath: string,
    destinationFolderPath: string,
  ): Observable<MoveFolderResponseDto> {
    const encodedName = encodeURIComponent(collectionName);
    const dto: MoveFolderDto = {
      sourceFolderPath,
      destinationFolderPath,
      nestUnderDestination: true,
    };
    return this.#http.post<MoveFolderResponseDto>(`${this.#baseUrl}/${encodedName}/folders/move`, dto);
  }

  /**
   * Auto-translates new and stale locales for a resource using the configured translation provider.
   *
   * @param collectionName - Name of the collection containing the resource
   * @param key - Full dot-delimited key of the resource to translate
   * @returns Observable of translate response containing the updated resource
   */
  translateResource(collectionName: string, key: string): Observable<TranslateResourceResponseDto> {
    const encodedName = encodeURIComponent(collectionName);
    const dto: TranslateResourceDto = { key };
    return this.#http.post<TranslateResourceResponseDto>(`${this.#baseUrl}/${encodedName}/resources/translate`, dto);
  }
}
