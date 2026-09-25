import { Test, type TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { resolve } from 'node:path';
import { CollectionsController } from './collections.controller';
import { ConfigService } from '../config/config.service';
import { CollectionIndex } from '../cache/collection-index.service';
import * as core from '@simoncodes-ca/core';
import type { UpdateCollectionDto } from '@simoncodes-ca/data-transfer';

// Mock the core writes; keep the real config resolution and mutation helpers
jest.mock('@simoncodes-ca/core', () => {
  const actual = jest.requireActual('@simoncodes-ca/core');
  return {
    ...actual,
    deleteCollectionByName: jest.fn(),
    addCollection: jest.fn(),
    updateCollection: jest.fn(),
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

    it('should throw HttpException when collection not found', async () => {
      const deleteCollectionByName = core.deleteCollectionByName as jest.Mock;
      deleteCollectionByName.mockImplementation(() => {
        throw new Error('Collection not found');
      });

      await expect(collectionsController.deleteCollection('non-existent')).rejects.toThrow(HttpException);
      expect(deleteCollectionByName).toHaveBeenCalledWith('non-existent');
    });

    it('should throw HttpException when deletion fails', async () => {
      const deleteCollectionByName = core.deleteCollectionByName as jest.Mock;
      deleteCollectionByName.mockImplementation(() => {
        throw new Error('Failed to delete collection');
      });

      await expect(collectionsController.deleteCollection('test-collection')).rejects.toThrow(HttpException);
      expect(deleteCollectionByName).toHaveBeenCalledWith('test-collection');
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

      const result = await collectionsController.createCollection(dto as any);

      expect(result).toEqual({
        message: 'Collection "new-collection" created successfully',
      });
      expect(addCollection).toHaveBeenCalledWith('new-collection', dto.collection);
    });

    it('should throw HttpException when creation fails', async () => {
      const addCollection = core.addCollection as jest.Mock;
      addCollection.mockImplementation(() => {
        throw new Error('Failed to create collection');
      });

      const dto = {
        name: 'new-collection',
        collection: {
          translationsFolder: './translations/new',
        },
      };

      await expect(collectionsController.createCollection(dto as any)).rejects.toThrow(HttpException);
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

      const result = await collectionsController.updateCollectionByName('old-name', dto as any);

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

      await collectionsController.updateCollectionByName('My%20Collection', dto as any);

      expect(updateCollection).toHaveBeenCalledWith('My Collection', 'My Collection', dto.collection);
    });

    it('should throw HttpException when update fails', async () => {
      const updateCollection = core.updateCollection as jest.Mock;
      updateCollection.mockImplementation(() => {
        throw new Error('Failed to update collection');
      });

      const dto = {
        name: 'new-name',
        collection: {
          translationsFolder: './translations/updated',
        },
      };

      await expect(collectionsController.updateCollectionByName('old-name', dto as any)).rejects.toThrow(HttpException);
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
