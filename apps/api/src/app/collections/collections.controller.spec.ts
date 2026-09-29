import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { resolve } from 'node:path';
import { CollectionsController } from './collections.controller';
import { ConfigService } from '../config/config.service';
import { CollectionIndex } from '../cache/collection-index.service';
import { toHttpException } from '../errors/lingo-tracker-exception.filter';
import * as core from '@simoncodes-ca/core';
import { CollectionAlreadyExistsError, CollectionNotFoundError } from '@simoncodes-ca/core';
import type { CreateCollectionDto, UpdateCollectionDto } from '@simoncodes-ca/data-transfer';

// Mock the core writes; keep the real config resolution and mutation helpers
jest.mock('@simoncodes-ca/core', () => {
  const actual = jest.requireActual('@simoncodes-ca/core');
  return {
    ...actual,
    deleteCollectionByName: jest.fn(),
    addCollection: jest.fn(),
    updateCollection: jest.fn(),
    setCollectionProtectedTerms: jest.fn(),
  };
});

// Mock the mapper
jest.mock('../mappers/collection.mapper', () => ({
  mapDtoToCollection: jest.fn((dto) => dto),
}));

describe('CollectionsController', () => {
  let collectionsModule: TestingModule;
  let collectionsController: CollectionsController;

  const mockConfig = {
    baseLocale: 'en',
    locales: ['en'],
    collections: {
      'test-collection': { translationsFolder: './translations/test' },
    },
  };
  const mockIndex = { apply: jest.fn() };

  beforeAll(async () => {
    collectionsModule = await Test.createTestingModule({
      controllers: [CollectionsController],
      providers: [
        { provide: ConfigService, useValue: { getConfig: jest.fn().mockReturnValue(mockConfig) } },
        { provide: CollectionIndex, useValue: mockIndex },
      ],
    }).compile();

    collectionsController = collectionsModule.get<CollectionsController>(CollectionsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('deleteCollection', () => {
    it('should successfully delete a collection', async () => {
      const deleteCollectionByName = core.deleteCollectionByName as jest.Mock;
      deleteCollectionByName.mockReturnValue({
        message: 'Collection "test-collection" deleted successfully',
      });

      const result = await collectionsController.deleteCollection('test-collection');

      expect(result).toEqual({
        message: 'Collection "test-collection" deleted successfully',
      });
      expect(deleteCollectionByName).toHaveBeenCalledWith('test-collection');
    });

    it('should URI decode collection names with special characters', async () => {
      const deleteCollectionByName = core.deleteCollectionByName as jest.Mock;
      deleteCollectionByName.mockReturnValue({
        message: 'Collection "My Collection" deleted successfully',
      });

      const result = await collectionsController.deleteCollection('My%20Collection');

      expect(result).toEqual({
        message: 'Collection "My Collection" deleted successfully',
      });
      expect(deleteCollectionByName).toHaveBeenCalledWith('My Collection');
    });

    it('lets CollectionNotFoundError through, which the filter answers with 404', async () => {
      const deleteCollectionByName = core.deleteCollectionByName as jest.Mock;
      deleteCollectionByName.mockImplementation(() => {
        throw new CollectionNotFoundError('non-existent');
      });

      const error = await collectionsController.deleteCollection('non-existent').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CollectionNotFoundError);
      expect(toHttpException(error).getStatus()).toBe(404);
      expect(mockIndex.apply).not.toHaveBeenCalled();
    });

    it('propagates an unexpected error and leaves the index alone', async () => {
      const deleteCollectionByName = core.deleteCollectionByName as jest.Mock;
      deleteCollectionByName.mockImplementation(() => {
        throw new Error('Failed to delete collection');
      });

      await expect(collectionsController.deleteCollection('test-collection')).rejects.toThrow(
        'Failed to delete collection',
      );
      expect(mockIndex.apply).not.toHaveBeenCalled();
    });

    it('drops the index entry for the deleted collection folder', async () => {
      (core.deleteCollectionByName as jest.Mock).mockReturnValue(undefined);

      await collectionsController.deleteCollection('test-collection');

      expect(mockIndex.apply).toHaveBeenCalledWith([
        { kind: 'reindex', translationsFolder: resolve('./translations/test') },
      ]);
    });
  });

  describe('createCollection', () => {
    it('should successfully create a collection', async () => {
      const addCollection = core.addCollection as jest.Mock;
      addCollection.mockReturnValue({
        message: 'Collection "new-collection" created successfully',
      });

      const dto = {
        name: 'new-collection',
        collection: {
          translationsFolder: './translations/new',
        },
      };

      const result = await collectionsController.createCollection(dto as unknown as CreateCollectionDto);

      expect(result).toEqual({
        message: 'Collection "new-collection" created successfully',
      });
      expect(addCollection).toHaveBeenCalledWith('new-collection', dto.collection);
    });

    it.each([
      ['no body', undefined, 'request body must be an object'],
      ['no name', { collection: { translationsFolder: './x' } }, 'name must be a non-empty string'],
      ['a blank name', { name: ' ', collection: { translationsFolder: './x' } }, 'name must be a non-empty string'],
      ['no collection', { name: 'new' }, 'collection must be an object'],
      ['an array collection', { name: 'new', collection: [] }, 'collection must be an object'],
      [
        'a non-string folder',
        { name: 'new', collection: { translationsFolder: 1 } },
        'collection.translationsFolder must be a string',
      ],
      [
        'null tags',
        { name: 'new', collection: { translationsFolder: './x', tags: null } },
        'collection.tags must not be null',
      ],
    ])('answers 400 for %s, before core is called', async (_label, body, message) => {
      const error = await collectionsController
        .createCollection(body as unknown as CreateCollectionDto)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe(message);
      expect(core.addCollection).not.toHaveBeenCalled();
    });

    it('lets CollectionAlreadyExistsError through, which the filter answers with 409', async () => {
      const addCollection = core.addCollection as jest.Mock;
      addCollection.mockImplementation(() => {
        throw new CollectionAlreadyExistsError('new-collection');
      });

      const dto = {
        name: 'new-collection',
        collection: {
          translationsFolder: './translations/new',
        },
      };

      const error = await collectionsController
        .createCollection(dto as unknown as CreateCollectionDto)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CollectionAlreadyExistsError);
      expect(toHttpException(error).getStatus()).toBe(409);
    });
  });

  describe('updateCollectionByName', () => {
    it('should successfully update a collection', async () => {
      const updateCollection = core.updateCollection as jest.Mock;
      updateCollection.mockReturnValue({
        message: 'Collection "old-name" updated to "new-name" successfully',
        mutations: [],
      });

      const dto = {
        name: 'new-name',
        collection: {
          translationsFolder: './translations/updated',
        },
      };

      const result = await collectionsController.updateCollectionByName(
        'old-name',
        dto as unknown as UpdateCollectionDto,
      );

      expect(result).toEqual({
        message: 'Collection "old-name" updated to "new-name" successfully',
      });
      expect(updateCollection).toHaveBeenCalledWith('old-name', 'new-name', dto.collection);
    });

    it('should URI decode collection names with special characters', async () => {
      const updateCollection = core.updateCollection as jest.Mock;
      updateCollection.mockReturnValue({
        message: 'Collection "My Collection" updated successfully',
        mutations: [],
      });

      const dto = {
        name: 'My Collection',
        collection: {
          translationsFolder: './translations/my',
        },
      };

      await collectionsController.updateCollectionByName('My%20Collection', dto as unknown as UpdateCollectionDto);

      expect(updateCollection).toHaveBeenCalledWith('My Collection', 'My Collection', dto.collection);
    });

    it.each([
      ['a blank name', { name: '', collection: { translationsFolder: './x' } }, 'name must be a non-empty string'],
      ['a non-string name', { name: 1, collection: { translationsFolder: './x' } }, 'name must be a non-empty string'],
      ['no collection', {}, 'collection must be an object'],
      ['a null folder', { collection: { translationsFolder: null } }, 'collection.translationsFolder must not be null'],
      [
        'null locales',
        { collection: { translationsFolder: './x', locales: null } },
        'collection.locales must not be null',
      ],
      [
        'a null translation',
        { collection: { translationsFolder: './x', translation: null } },
        'collection.translation must not be null',
      ],
    ])('answers 400 for %s, before core is called', async (_label, body, message) => {
      const error = await collectionsController
        .updateCollectionByName('old-name', body as unknown as UpdateCollectionDto)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe(message);
      expect(core.updateCollection).not.toHaveBeenCalled();
    });

    it('writes the protected terms under the current name when the body does not rename', async () => {
      (core.updateCollection as jest.Mock).mockResolvedValue({ message: 'ok', mutations: [] });

      await collectionsController.updateCollectionByName('test-collection', {
        collection: { translationsFolder: './translations/test', protectedTerms: ['iPhone'] },
      });

      expect(core.updateCollection).toHaveBeenCalledWith('test-collection', undefined, expect.anything());
      expect(core.setCollectionProtectedTerms).toHaveBeenCalledWith('test-collection', ['iPhone']);
    });

    it('lets CollectionNotFoundError through (404) and leaves the index alone', async () => {
      const updateCollection = core.updateCollection as jest.Mock;
      updateCollection.mockImplementation(() => {
        throw new CollectionNotFoundError('old-name');
      });

      const dto = {
        name: 'new-name',
        collection: {
          translationsFolder: './translations/updated',
        },
      };

      const error = await collectionsController
        .updateCollectionByName('old-name', dto as unknown as UpdateCollectionDto)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CollectionNotFoundError);
      expect(toHttpException(error).getStatus()).toBe(404);
      expect(mockIndex.apply).not.toHaveBeenCalled();
    });

    it('drops the index entry for the collection folder, after its locale mutations', async () => {
      const localeMutation = { kind: 'reindex', translationsFolder: resolve('./translations/test') };
      (core.updateCollection as jest.Mock).mockResolvedValue({
        message: 'Collection "test-collection" updated successfully',
        mutations: [localeMutation],
      });

      const dto: UpdateCollectionDto = { collection: { translationsFolder: './translations/test' } };
      await collectionsController.updateCollectionByName('test-collection', dto);

      expect(mockIndex.apply).toHaveBeenCalledWith([
        localeMutation,
        { kind: 'reindex', translationsFolder: resolve('./translations/test') },
      ]);
    });
  });
});
