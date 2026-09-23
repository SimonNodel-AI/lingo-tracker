import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { createServiceFactory, type SpectatorService } from '@ngneat/spectator/vitest';
import type {
  CreateResourceDto,
  CreateResourceResponseDto,
  DeleteResourceResponseDto,
  ResourceTreeDto,
  SearchResultsDto,
  UpdateResourceDto,
  UpdateResourceResponseDto,
} from '@simoncodes-ca/data-transfer';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserApiService,
  CollectionIndexNotReadyError,
  TREE_NOT_READY_RETRIES,
  TREE_NOT_READY_RETRY_DELAY_MS,
} from './browser-api.service';

describe('BrowserApiService', () => {
  let service: BrowserApiService;
  let spectator: SpectatorService<BrowserApiService>;
  let httpMock: HttpTestingController;

  const createService = createServiceFactory({
    service: BrowserApiService,
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });

  beforeEach(() => {
    spectator = createService();
    service = spectator.service;
    httpMock = spectator.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('getResourceTree', () => {
    it('should fetch resource tree for collection with includeNested', async () => {
      const collectionName = 'my-collection';
      const folderPath = 'common.buttons';
      const includeNested = true;

      const mockResponse: ResourceTreeDto = {
        path: folderPath,
        resources: [],
        children: [],
      };

      const result$ = service.getResourceTree(collectionName, folderPath, includeNested);
      const resultPromise = firstValueFrom(result$);

      const req = httpMock.expectOne(
        `/api/collections/${encodeURIComponent(collectionName)}/resources/tree?path=${encodeURIComponent(
          folderPath,
        )}&includeNested=${includeNested}`,
      );
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);

      const data = await resultPromise;
      expect(data).toEqual(mockResponse);
    });

    it('should use empty path and false includeNested for root', async () => {
      const collectionName = 'my-collection';

      const mockResponse: ResourceTreeDto = {
        path: '',
        resources: [],
        children: [],
      };

      const result$ = service.getResourceTree(collectionName);

      // Trigger the HTTP call asynchronously
      queueMicrotask(() => {
        const req = httpMock.expectOne(
          `/api/collections/${encodeURIComponent(collectionName)}/resources/tree?path=&includeNested=false`,
        );
        req.flush(mockResponse);
      });

      const data = await firstValueFrom(result$);
      expect(data).toEqual(mockResponse);
    });

    describe('while the collection is being indexed', () => {
      const url = '/api/collections/c/resources/tree?path=&includeNested=false';
      const notReady = { status: 'indexing', message: 'Collection is currently being indexed.' };
      const tree: ResourceTreeDto = { path: '', resources: [], children: [] };

      beforeEach(() => vi.useFakeTimers());
      afterEach(() => vi.useRealTimers());

      it('asks again after a pause and hands the caller only the tree', () => {
        const received: ResourceTreeDto[] = [];
        service.getResourceTree('c').subscribe((value) => received.push(value));

        httpMock.expectOne(url).flush(notReady, { status: 202, statusText: 'Accepted' });
        httpMock.expectNone(url);

        vi.advanceTimersByTime(TREE_NOT_READY_RETRY_DELAY_MS);
        httpMock.expectOne(url).flush(tree);

        expect(received).toEqual([tree]);
      });

      it('gives up with CollectionIndexNotReadyError once the retries are spent', () => {
        let failure: unknown;
        service.getResourceTree('c').subscribe({
          error: (error: unknown) => {
            failure = error;
          },
        });

        for (let attempt = 0; attempt <= TREE_NOT_READY_RETRIES; attempt++) {
          httpMock.expectOne(url).flush(notReady, { status: 202, statusText: 'Accepted' });
          vi.advanceTimersByTime(TREE_NOT_READY_RETRY_DELAY_MS);
        }

        httpMock.expectNone(url);
        expect(failure).toBeInstanceOf(CollectionIndexNotReadyError);
        expect((failure as Error).message).toBe(notReady.message);
      });

      it('does not retry an HTTP error', () => {
        let failure: unknown;
        service.getResourceTree('c').subscribe({
          error: (error: unknown) => {
            failure = error;
          },
        });

        httpMock.expectOne(url).flush('boom', { status: 500, statusText: 'Server Error' });
        vi.advanceTimersByTime(TREE_NOT_READY_RETRY_DELAY_MS);

        httpMock.expectNone(url);
        expect(failure).toBeDefined();
        expect(failure).not.toBeInstanceOf(CollectionIndexNotReadyError);
      });
    });
  });

  describe('searchTranslations', () => {
    it('should search translations with query', async () => {
      const collectionName = 'my-collection';
      const query = 'button';
      const maxResults = 100;

      const mockResults: SearchResultsDto = {
        query: 'button',
        results: [
          {
            fullKey: 'common.buttons.save',
            folderPath: 'common.buttons',
            entryKey: 'save',
            base: { locale: 'en', value: 'Save' },
            targets: [{ locale: 'es', value: 'Guardar', status: 'verified', needsWork: false, sameAsBase: false }],
            tags: [],
            inheritedTags: [],
            matchType: 'partial-key',
          },
        ],
        totalFound: 1,
        limited: false,
      };

      const result$ = service.searchTranslations(collectionName, query, maxResults);

      // Trigger the HTTP call asynchronously
      queueMicrotask(() => {
        const req = httpMock.expectOne(
          (request) =>
            request.url === `/api/collections/${encodeURIComponent(collectionName)}/resources/search` &&
            request.params.get('query') === query &&
            request.params.get('maxResults') === maxResults.toString(),
        );
        expect(req.request.method).toBe('GET');
        req.flush(mockResults);
      });

      const data = await firstValueFrom(result$);
      expect(data).toEqual(mockResults);
    });

    it('should use default maxResults of 100', async () => {
      const collectionName = 'my-collection';
      const query = 'test';

      const mockResults: SearchResultsDto = {
        query: 'test',
        results: [],
        totalFound: 0,
        limited: false,
      };

      const result$ = service.searchTranslations(collectionName, query);

      queueMicrotask(() => {
        const req = httpMock.expectOne(
          (request) => request.url.includes('/search') && request.params.get('maxResults') === '100',
        );
        req.flush(mockResults);
      });

      const data = await firstValueFrom(result$);
      expect(data.query).toBe('test');
    });

    it('should handle empty search results', async () => {
      const collectionName = 'my-collection';
      const query = 'nonexistent';

      const mockResults: SearchResultsDto = {
        query: 'nonexistent',
        results: [],
        totalFound: 0,
        limited: false,
      };

      const result$ = service.searchTranslations(collectionName, query);

      queueMicrotask(() => {
        const req = httpMock.expectOne((r) => r.url.includes('/search'));
        req.flush(mockResults);
      });

      const data = await firstValueFrom(result$);
      expect(data.results).toEqual([]);
      expect(data.totalFound).toBe(0);
    });

    it('should properly encode collection name', async () => {
      const collectionName = 'my collection with spaces';
      const query = 'test';

      const mockResults: SearchResultsDto = {
        query: 'test',
        results: [],
        totalFound: 0,
        limited: false,
      };

      const result$ = service.searchTranslations(collectionName, query);

      queueMicrotask(() => {
        const req = httpMock.expectOne((request) => request.url.includes(encodeURIComponent(collectionName)));
        req.flush(mockResults);
      });

      await firstValueFrom(result$);
    });
  });

  describe('createResource', () => {
    it('should create resource with POST request', async () => {
      const collectionName = 'my-collection';
      const createDto: CreateResourceDto = {
        key: 'common.buttons.save',
        baseValue: 'Save',
        baseLocale: 'en',
      };

      const mockResponse: CreateResourceResponseDto = {
        resolvedKey: 'common.buttons.save',
        created: true,
      };

      const result$ = service.createResource(collectionName, createDto);

      queueMicrotask(() => {
        const req = httpMock.expectOne(`/api/collections/${encodeURIComponent(collectionName)}/resources`);
        expect(req.request.method).toBe('POST');
        expect(req.request.body).toEqual(createDto);
        req.flush(mockResponse);
      });

      const data = await firstValueFrom(result$);
      expect(data).toEqual(mockResponse);
    });

    it('should properly encode collection name', async () => {
      const collectionName = 'my collection';
      const createDto: CreateResourceDto = {
        key: 'test.key',
        baseValue: 'Test',
        baseLocale: 'en',
      };

      const mockResponse: CreateResourceResponseDto = {
        resolvedKey: 'test.key',
        created: true,
      };

      const result$ = service.createResource(collectionName, createDto);

      queueMicrotask(() => {
        const req = httpMock.expectOne(`/api/collections/my%20collection/resources`);
        req.flush(mockResponse);
      });

      await firstValueFrom(result$);
    });
  });

  describe('updateResource', () => {
    it('should update resource with PATCH request', async () => {
      const collectionName = 'my-collection';
      const updateDto: UpdateResourceDto = {
        key: 'common.buttons.save',
        baseValue: 'Save Changes',
        comment: 'Updated comment',
      };

      const mockResponse: UpdateResourceResponseDto = {
        resolvedKey: 'common.buttons.save',
        updated: true,
      };

      const result$ = service.updateResource(collectionName, updateDto);

      queueMicrotask(() => {
        const req = httpMock.expectOne(`/api/collections/${encodeURIComponent(collectionName)}/resources`);
        expect(req.request.method).toBe('PATCH');
        expect(req.request.body).toEqual(updateDto);
        req.flush(mockResponse);
      });

      const data = await firstValueFrom(result$);
      expect(data).toEqual(mockResponse);
    });

    it('should include locales in update request', async () => {
      const collectionName = 'my-collection';
      const updateDto: UpdateResourceDto = {
        key: 'common.greeting',
        baseValue: 'Hello',
        locales: {
          fr: { value: 'Bonjour' },
          es: { value: 'Hola' },
        },
      };

      const mockResponse: UpdateResourceResponseDto = {
        resolvedKey: 'common.greeting',
        updated: true,
      };

      const result$ = service.updateResource(collectionName, updateDto);

      queueMicrotask(() => {
        const req = httpMock.expectOne(`/api/collections/${encodeURIComponent(collectionName)}/resources`);
        expect(req.request.body).toEqual(updateDto);
        req.flush(mockResponse);
      });

      await firstValueFrom(result$);
    });

    it('should include targetFolder when moving resource', async () => {
      const collectionName = 'my-collection';
      const updateDto: UpdateResourceDto = {
        key: 'old.path.button',
        baseValue: 'Click Me',
        targetFolder: 'new.path',
      };

      const mockResponse: UpdateResourceResponseDto = {
        resolvedKey: 'new.path.button',
        updated: true,
      };

      const result$ = service.updateResource(collectionName, updateDto);

      queueMicrotask(() => {
        const req = httpMock.expectOne(`/api/collections/${encodeURIComponent(collectionName)}/resources`);
        expect(req.request.body).toEqual(updateDto);
        req.flush(mockResponse);
      });

      const data = await firstValueFrom(result$);
      expect(data).toEqual(mockResponse);
    });

    it('should properly encode collection name', async () => {
      const collectionName = 'my collection';
      const updateDto: UpdateResourceDto = {
        key: 'test.key',
        baseValue: 'Test',
      };

      const mockResponse: UpdateResourceResponseDto = {
        resolvedKey: 'test.key',
        updated: true,
      };

      const result$ = service.updateResource(collectionName, updateDto);

      queueMicrotask(() => {
        const req = httpMock.expectOne(`/api/collections/my%20collection/resources`);
        req.flush(mockResponse);
      });

      await firstValueFrom(result$);
    });
  });

  describe('deleteResource', () => {
    it('should delete resource with DELETE request', async () => {
      const collectionName = 'my-collection';
      const resourceKeys = ['common.buttons.save', 'common.buttons.cancel'];

      const mockResponse: DeleteResourceResponseDto = {
        entriesDeleted: 2,
        errors: [],
      };

      const result$ = service.deleteResource(collectionName, resourceKeys);

      queueMicrotask(() => {
        const req = httpMock.expectOne(`/api/collections/${encodeURIComponent(collectionName)}/resources`);
        expect(req.request.method).toBe('DELETE');
        expect(req.request.body).toEqual({ keys: resourceKeys });
        req.flush(mockResponse);
      });

      const data = await firstValueFrom(result$);
      expect(data).toEqual(mockResponse);
    });

    it('should handle single resource deletion', async () => {
      const collectionName = 'my-collection';
      const resourceKeys = ['common.buttons.save'];

      const mockResponse: DeleteResourceResponseDto = {
        entriesDeleted: 1,
        errors: [],
      };

      const result$ = service.deleteResource(collectionName, resourceKeys);

      queueMicrotask(() => {
        const req = httpMock.expectOne(`/api/collections/${encodeURIComponent(collectionName)}/resources`);
        expect(req.request.body).toEqual({ keys: resourceKeys });
        req.flush(mockResponse);
      });

      const data = await firstValueFrom(result$);
      expect(data.entriesDeleted).toBe(1);
    });

    it('should handle deletion errors', async () => {
      const collectionName = 'my-collection';
      const resourceKeys = ['nonexistent.key'];

      const mockResponse: DeleteResourceResponseDto = {
        entriesDeleted: 0,
        errors: ['Resource not found: nonexistent.key'],
      };

      const result$ = service.deleteResource(collectionName, resourceKeys);

      queueMicrotask(() => {
        const req = httpMock.expectOne(`/api/collections/${encodeURIComponent(collectionName)}/resources`);
        req.flush(mockResponse);
      });

      const data = await firstValueFrom(result$);
      expect(data.entriesDeleted).toBe(0);
      expect(data.errors?.length).toBe(1);
    });

    it('should properly encode collection name', async () => {
      const collectionName = 'my collection with spaces';
      const resourceKeys = ['test.key'];

      const mockResponse: DeleteResourceResponseDto = {
        entriesDeleted: 1,
        errors: [],
      };

      const result$ = service.deleteResource(collectionName, resourceKeys);

      queueMicrotask(() => {
        const req = httpMock.expectOne(`/api/collections/my%20collection%20with%20spaces/resources`);
        req.flush(mockResponse);
      });

      await firstValueFrom(result$);
    });
  });
});
