import { resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import * as core from '@simoncodes-ca/core';
import {
  CollectionAlreadyExistsError,
  CollectionNotFoundError,
  CollectionRenameBundleConflictError,
  CollectionRequiredByBundleError,
  InvalidCollectionError,
} from '@simoncodes-ca/core';
import type { CreateCollectionDto, UpdateCollectionDto } from '@simoncodes-ca/data-transfer';
import { CollectionIndex } from '../cache/collection-index.service';
import { ConfigService } from '../config/config.service';
import { toHttpException } from '../errors/lingo-tracker-exception.filter';
import { CollectionsController } from './collections.controller';

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

describe('CollectionsController', () => {
  let collectionsModule: TestingModule;
  let collectionsController: CollectionsController;

  const mockConfig = {
    baseLocale: 'en',
    locales: ['en'],
    collections: {
      'test-collection': { translationsFolder: './translations/test' },
      'old-name': { translationsFolder: './translations/old' },
      'My%Collection': { translationsFolder: './translations/my' },
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
        mutations: [],
      });

      const result = await collectionsController.deleteCollection('test-collection');

      expect(result).toEqual({
        message: 'Collection "test-collection" deleted successfully',
      });
      expect(deleteCollectionByName).toHaveBeenCalledWith('test-collection');
    });

    it('passes the route param through verbatim', async () => {
      const deleteCollectionByName = core.deleteCollectionByName as jest.Mock;
      deleteCollectionByName.mockReturnValue({
        message: 'Collection "My Collection" deleted successfully',
        mutations: [],
      });

      const result = await collectionsController.deleteCollection('My%Collection');

      expect(result).toEqual({
        message: 'Collection "My Collection" deleted successfully',
      });
      expect(deleteCollectionByName).toHaveBeenCalledWith('My%Collection');
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

    it('answers a refused deletion with 409 and leaves the index alone', async () => {
      (core.deleteCollectionByName as jest.Mock).mockImplementation(() => {
        throw new CollectionRequiredByBundleError('test-collection', ['main']);
      });

      const error = await collectionsController.deleteCollection('test-collection').catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(CollectionRequiredByBundleError);
      expect(toHttpException(error).getStatus()).toBe(409);
      expect(toHttpException(error).getResponse()).toEqual({
        message:
          'Collection "test-collection" is the only collection of bundle(s) "main". Remove it from those bundles or delete them first.',
        error: 'Conflict',
        statusCode: 409,
      });
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
      (core.deleteCollectionByName as jest.Mock).mockReturnValue({
        message: 'Collection "test-collection" deleted successfully',
        mutations: [{ kind: 'reindex', translationsFolder: resolve('./translations/test') }],
      });

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
      expect(addCollection).toHaveBeenCalledWith('new-collection', dto.collection, { protectedTerms: undefined });
    });

    it.each([
      ['no body', undefined, 'request body must be an object'],
      ['no name', { collection: { translationsFolder: './x' } }, 'name must be a non-empty string'],
      ['a blank name', { name: ' ', collection: { translationsFolder: './x' } }, 'name must be a non-empty string'],
      ['no collection', { name: 'new' }, 'collection must be an object'],
      ['an array collection', { name: 'new', collection: [] }, 'collection must be an object'],
    ])('answers 400 for %s, before core is called', async (_label, body, message) => {
      const error = await collectionsController
        .createCollection(body as unknown as CreateCollectionDto)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe(message);
      expect(core.addCollection).not.toHaveBeenCalled();
    });

    it.each([
      ['tags', { translationsFolder: './x', tags: null }],
      ['translationsFolder', { translationsFolder: null }],
      ['translation', { translationsFolder: './x', translation: null }],
    ])('keeps the 400 and message for a null %s field from core', async (field, collection) => {
      (core.addCollection as jest.Mock).mockImplementation((_name, body: object) => core.assertCollectionFields(body));
      const error = await collectionsController
        .createCollection({ name: 'new', collection } as unknown as CreateCollectionDto)
        .catch((caught: unknown) => caught);
      expect(toHttpException(error).getResponse()).toMatchObject({
        statusCode: 400,
        message: `collection.${field} must not be null`,
      });
    });

    it('keeps the 400 and message for a non-string translationsFolder from core', async () => {
      (core.addCollection as jest.Mock).mockImplementation((_name, body: object) => core.assertCollectionFields(body));
      const error = await collectionsController
        .createCollection({ name: 'new', collection: { translationsFolder: 1 } } as unknown as CreateCollectionDto)
        .catch((caught: unknown) => caught);
      expect(toHttpException(error).getResponse()).toMatchObject({
        statusCode: 400,
        message: 'collection.translationsFolder must be a string',
      });
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
    it('answers a rename onto a dangling bundle reference with 409', async () => {
      (core.updateCollection as jest.Mock).mockImplementation(() => {
        throw new CollectionRenameBundleConflictError('test-collection', 'legacy', ['main']);
      });

      const error = await collectionsController
        .updateCollectionByName('test-collection', {
          name: 'legacy',
          collection: { translationsFolder: './translations/test' },
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(CollectionRenameBundleConflictError);
      expect(toHttpException(error).getStatus()).toBe(409);
      expect(toHttpException(error).getResponse()).toEqual({
        message:
          'Cannot rename collection "test-collection" to "legacy": bundle(s) "main" already reference "legacy". Remove those references first.',
        error: 'Conflict',
        statusCode: 409,
      });
      expect(mockIndex.apply).not.toHaveBeenCalled();
    });

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
      expect(updateCollection).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'old-name' }),
        expect.objectContaining({ write: expect.any(Function) }),
        'new-name',
        dto.collection,
        { protectedTerms: undefined },
      );
    });

    it('passes the route param through verbatim', async () => {
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

      await collectionsController.updateCollectionByName('My%Collection', dto as unknown as UpdateCollectionDto);

      expect(updateCollection).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My%Collection' }),
        expect.objectContaining({ write: expect.any(Function) }),
        'My Collection',
        dto.collection,
        { protectedTerms: undefined },
      );
    });

    it.each([
      ['a blank name', { name: '', collection: { translationsFolder: './x' } }, 'name must be a non-empty string'],
      ['a non-string name', { name: 1, collection: { translationsFolder: './x' } }, 'name must be a non-empty string'],
      ['no collection', {}, 'collection must be an object'],
    ])('answers 400 for %s, before core is called', async (_label, body, message) => {
      const error = await collectionsController
        .updateCollectionByName('old-name', body as unknown as UpdateCollectionDto)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe(message);
      expect(core.updateCollection).not.toHaveBeenCalled();
    });

    it.each([
      ['translationsFolder', { translationsFolder: null }],
      ['locales', { translationsFolder: './x', locales: null }],
      ['translation', { translationsFolder: './x', translation: null }],
    ])('keeps the 400 and message for a null %s update field from core', async (field, collection) => {
      (core.updateCollection as jest.Mock).mockImplementation((_opened, _write, _name, patch: object) =>
        core.assertCollectionFields(patch),
      );
      const error = await collectionsController
        .updateCollectionByName('old-name', { collection } as unknown as UpdateCollectionDto)
        .catch((caught: unknown) => caught);
      expect(toHttpException(error).getResponse()).toMatchObject({
        statusCode: 400,
        message: `collection.${field} must not be null`,
      });
    });

    it('checks malformed terms before an unknown update target', async () => {
      const configService = collectionsModule.get<ConfigService>(ConfigService);
      const error = await collectionsController
        .updateCollectionByName('unknown', {
          collection: {
            translationsFolder: './x',
            protectedTerms: ['valid', 42] as unknown as string[],
          },
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(InvalidCollectionError);
      expect(toHttpException(error).getStatus()).toBe(400);
      expect(configService.getConfig).not.toHaveBeenCalled();
      expect(core.updateCollection).not.toHaveBeenCalled();
    });

    it('answers 400 for a null field before looking up an unknown collection', async () => {
      const configService = collectionsModule.get<ConfigService>(ConfigService);
      const error = await collectionsController
        .updateCollectionByName('unknown', {
          collection: { translationsFolder: './x', locales: null },
        } as unknown as UpdateCollectionDto)
        .catch((caught: unknown) => caught);

      expect(toHttpException(error).getResponse()).toMatchObject({
        statusCode: 400,
        message: 'collection.locales must not be null',
      });
      expect(configService.getConfig).not.toHaveBeenCalled();
      expect(core.updateCollection).not.toHaveBeenCalled();
    });

    it('writes the protected terms under the current name when the body does not rename', async () => {
      (core.updateCollection as jest.Mock).mockResolvedValue({ message: 'ok', mutations: [] });

      await collectionsController.updateCollectionByName('test-collection', {
        collection: { translationsFolder: './translations/test', protectedTerms: ['iPhone'] },
      });

      expect(core.updateCollection).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test-collection' }),
        expect.objectContaining({ write: expect.any(Function) }),
        undefined,
        expect.anything(),
        { protectedTerms: ['iPhone'] },
      );
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

    it('applies the collection mutations returned by core', async () => {
      const localeMutation = { kind: 'reindex', translationsFolder: resolve('./translations/test') };
      (core.updateCollection as jest.Mock).mockResolvedValue({
        message: 'Collection "test-collection" updated successfully',
        mutations: [localeMutation],
      });

      const dto: UpdateCollectionDto = { collection: { translationsFolder: './translations/test' } };
      await collectionsController.updateCollectionByName('test-collection', dto);

      expect(mockIndex.apply).toHaveBeenCalledWith([localeMutation]);
    });
  });
});
