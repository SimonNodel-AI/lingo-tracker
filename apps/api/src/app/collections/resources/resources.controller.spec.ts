import { resolve } from 'node:path';
import { HttpException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import * as core from '@simoncodes-ca/core';
import { TranslationError } from '@simoncodes-ca/core';
import type { ResourceTreeDto } from '@simoncodes-ca/data-transfer';
import type { TranslationStatus } from '@simoncodes-ca/domain';
import { CollectionIndex } from '../../cache/collection-index.service';
import { ConfigService } from '../../config/config.service';
import { toHttpException } from '../../errors/lingo-tracker-exception.filter';
import { TranslationJobService } from '../../translation-job/translation-job.service';
import { ResourcesController } from './resources.controller';

/** What the handler rejects with, as the HTTP exception the global exception filter answers with. */
const httpErrorOf = (promise: Promise<unknown>): Promise<HttpException> =>
  promise.then(() => {
    throw new Error('expected the handler to reject');
  }, toHttpException);

// Mock the core module
jest.mock('@simoncodes-ca/core', () => {
  const actual = jest.requireActual('@simoncodes-ca/core');
  return {
    ...actual,
    addResource: jest.fn(),
    deleteResource: jest.fn(),
    moveResource: jest.fn(),
    moveResourcesByPattern: jest.fn(),
    editResource: jest.fn(),
    translateExistingResource: jest.fn(),
    extractResourcesRecursively: jest.fn(),
  };
});

describe('ResourcesController', () => {
  let resourcesModule: TestingModule;
  let resourcesController: ResourcesController;
  let configService: ConfigService;

  const mockConfig = {
    exportFolder: 'dist/lingo-export',
    importFolder: 'dist/lingo-import',
    baseLocale: 'en',
    locales: ['en', 'fr-ca', 'es'],
    collections: {
      'test-collection': {
        translationsFolder: './translations/test',
        baseLocale: 'en',
        locales: ['en', 'fr-ca', 'es'],
      },
    },
  };

  const mockIndex = {
    tree: jest.fn(),
    search: jest.fn(),
    status: jest.fn(),
    apply: jest.fn(),
  };

  beforeEach(async () => {
    resourcesModule = await Test.createTestingModule({
      controllers: [ResourcesController],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            getConfig: jest.fn().mockReturnValue(mockConfig),
          },
        },
        {
          provide: CollectionIndex,
          useValue: mockIndex,
        },
        {
          provide: TranslationJobService,
          useValue: {
            startJob: jest.fn().mockReturnValue('mock-job-id'),
            getJob: jest.fn().mockReturnValue(null),
          },
        },
      ],
    }).compile();

    resourcesController = resourcesModule.get<ResourcesController>(ResourcesController);
    configService = resourcesModule.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createResources', () => {
    it('should successfully create a single resource', async () => {
      const addResource = core.addResource as jest.Mock;
      addResource.mockReturnValue({
        resolvedKey: 'app.button.ok',
        created: true,
      });

      const dto = {
        key: 'app.button.ok',
        baseValue: 'OK',
      };

      const result = await resourcesController.createResources('test-collection', dto);

      expect(result).toEqual({
        entriesCreated: 1,
        created: true,
      });
      expect(addResource).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-collection',
          translationsFolder: resolve('./translations/test'),
          baseLocale: 'en',
        }),
        {
          key: 'app.button.ok',
          baseValue: 'OK',
          comment: undefined,
          tags: undefined,
          targetFolder: undefined,
          translations: undefined,
        },
      );
    });

    it('should successfully create multiple resources (bulk operation)', async () => {
      const addResource = core.addResource as jest.Mock;
      addResource.mockReturnValueOnce({ resolvedKey: 'app.button.ok', created: true }).mockReturnValueOnce({
        resolvedKey: 'app.button.cancel',
        created: true,
      });

      const dtos = [
        { key: 'app.button.ok', baseValue: 'OK' },
        { key: 'app.button.cancel', baseValue: 'Cancel' },
      ];

      const result = await resourcesController.createResources('test-collection', dtos);

      expect(result).toEqual({
        entriesCreated: 2,
        created: true,
      });
      expect(addResource).toHaveBeenCalledTimes(2);
    });

    it('should handle idempotent repeat (update existing resource)', async () => {
      const addResource = core.addResource as jest.Mock;
      addResource.mockReturnValue({
        resolvedKey: 'app.button.ok',
        created: false,
      });

      const dto = {
        key: 'app.button.ok',
        baseValue: 'OK',
      };

      const result = await resourcesController.createResources('test-collection', dto);

      expect(result).toEqual({
        entriesCreated: 0,
        created: false,
      });
    });

    it('should aggregate results correctly when some resources are created and some are updated', async () => {
      const addResource = core.addResource as jest.Mock;
      addResource
        .mockReturnValueOnce({ resolvedKey: 'app.button.ok', created: true })
        .mockReturnValueOnce({
          resolvedKey: 'app.button.cancel',
          created: false,
        })
        .mockReturnValueOnce({ resolvedKey: 'app.button.save', created: true });

      const dtos = [
        { key: 'app.button.ok', baseValue: 'OK' },
        { key: 'app.button.cancel', baseValue: 'Cancel' },
        { key: 'app.button.save', baseValue: 'Save' },
      ];

      const result = await resourcesController.createResources('test-collection', dtos);

      expect(result).toEqual({
        entriesCreated: 2,
        created: true,
      });
      expect(addResource).toHaveBeenCalledTimes(3);
    });

    it('should URI decode collection names with special characters', async () => {
      const addResource = core.addResource as jest.Mock;
      addResource.mockReturnValue({
        resolvedKey: 'app.button.ok',
        created: true,
      });

      const configWithEncodedName = {
        ...mockConfig,
        collections: {
          'My Collection': {
            translationsFolder: './translations/my-collection',
          },
        },
      };
      jest.spyOn(configService, 'getConfig').mockReturnValue(configWithEncodedName);

      const dto = {
        key: 'app.button.ok',
        baseValue: 'OK',
      };

      await resourcesController.createResources('My%20Collection', dto);

      expect(addResource).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Collection',
          translationsFolder: resolve('./translations/my-collection'),
        }),
        expect.any(Object),
      );
    });

    it('should throw NotFoundException when collection does not exist', async () => {
      const configWithoutCollection = {
        ...mockConfig,
        collections: {},
      };
      jest.spyOn(configService, 'getConfig').mockReturnValue(configWithoutCollection);

      const dto = {
        key: 'app.button.ok',
        baseValue: 'OK',
      };

      await expect(resourcesController.createResources('non-existent', dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw HttpException when empty array is provided', async () => {
      await expect(resourcesController.createResources('test-collection', [])).rejects.toThrow(HttpException);
    });

    it('should answer 400 for invalid key validation', async () => {
      const message = 'Key validation: Invalid key segment "invalid@key". Segments must match pattern [A-Za-z0-9_-]+';
      const addResource = core.addResource as jest.Mock;
      addResource.mockImplementation(() => {
        throw new core.InvalidResourceKeyError('invalid@key', message);
      });

      const dto = {
        key: 'invalid@key',
        baseValue: 'OK',
      };

      await expect(resourcesController.createResources('test-collection', dto)).rejects.toThrow(
        core.InvalidResourceKeyError,
      );

      const error = await httpErrorOf(resourcesController.createResources('test-collection', dto));
      expect(error.getStatus()).toBe(400);
      expect(error.message).toBe(message);
    });

    it('should answer 400 for empty key', async () => {
      const addResource = core.addResource as jest.Mock;
      addResource.mockImplementation(() => {
        throw new core.InvalidResourceKeyError('', 'Key validation: Key cannot be empty');
      });

      const dto = {
        key: '',
        baseValue: 'OK',
      };

      const error = await httpErrorOf(resourcesController.createResources('test-collection', dto));
      expect(error.getStatus()).toBe(400);
    });

    it('should answer 502 when the translation provider fails during auto-translation', async () => {
      const addResource = core.addResource as jest.Mock;
      addResource.mockImplementation(() => {
        throw new TranslationError('Google Translate server error: backend down', 'SERVER_ERROR', true);
      });

      const error = await httpErrorOf(
        resourcesController.createResources('test-collection', { key: 'app.button.ok', baseValue: 'OK' }),
      );
      expect(error.getStatus()).toBe(502);
    });

    it('should answer a generic 500 that hides the message for unexpected errors', async () => {
      const addResource = core.addResource as jest.Mock;
      addResource.mockImplementation(() => {
        throw new Error('Unexpected file system error');
      });

      const dto = {
        key: 'app.button.ok',
        baseValue: 'OK',
      };

      await expect(resourcesController.createResources('test-collection', dto)).rejects.toThrow(
        'Unexpected file system error',
      );

      const error = await httpErrorOf(resourcesController.createResources('test-collection', dto));
      expect(error.getStatus()).toBe(500);
      expect(error.message).toBe('Internal server error');
    });

    it('should handle resource with all optional fields', async () => {
      const addResource = core.addResource as jest.Mock;
      addResource.mockReturnValue({
        resolvedKey: 'apps.common.buttons.cancel',
        created: true,
      });

      const dto = {
        key: 'cancel',
        baseValue: 'Cancel',
        comment: 'Cancel button is used to abort any operation',
        tags: ['ui', 'buttons'],
        targetFolder: 'apps.common.buttons',
      };

      const result = await resourcesController.createResources('test-collection', dto);

      expect(result).toEqual({
        entriesCreated: 1,
        created: true,
      });
      expect(addResource).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-collection',
          translationsFolder: resolve('./translations/test'),
          baseLocale: 'en',
        }),
        expect.objectContaining({
          key: 'cancel',
          baseValue: 'Cancel',
          comment: 'Cancel button is used to abort any operation',
          tags: ['ui', 'buttons'],
          targetFolder: 'apps.common.buttons',
        }),
      );
    });

    it('should handle resource with translations', async () => {
      const addResource = core.addResource as jest.Mock;
      addResource.mockReturnValue({
        resolvedKey: 'app.button.ok',
        created: true,
      });

      const dto = {
        key: 'app.button.ok',
        baseValue: 'OK',
        translations: [
          {
            locale: 'fr-ca',
            value: "D'accord",
            status: 'translated' as TranslationStatus,
          },
          {
            locale: 'es',
            value: 'De acuerdo',
            status: 'translated' as TranslationStatus,
          },
        ],
      };

      await resourcesController.createResources('test-collection', dto);

      expect(addResource).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test-collection', translationsFolder: resolve('./translations/test') }),
        expect.objectContaining({
          translations: [
            { locale: 'fr-ca', value: "D'accord", status: 'translated' },
            { locale: 'es', value: 'De acuerdo', status: 'translated' },
          ],
        }),
      );
    });
  });

  describe('delete', () => {
    it('should successfully delete an existing resource', async () => {
      const deleteResource = core.deleteResource as jest.Mock;
      deleteResource.mockReturnValue({
        entriesDeleted: 1,
        matchedKeys: ['app.button.ok'],
      });

      const dto = {
        keys: ['app.button.ok'],
      };

      const result = await resourcesController.delete('test-collection', dto);

      expect(result).toEqual({
        entriesDeleted: 1,
        errors: undefined,
      });
      expect(deleteResource).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test-collection', translationsFolder: resolve('./translations/test') }),
        { keys: ['app.button.ok'] },
      );
    });

    it('should successfully delete multiple resources (bulk operation)', async () => {
      const deleteResource = core.deleteResource as jest.Mock;
      deleteResource.mockReturnValue({
        entriesDeleted: 3,
        matchedKeys: ['app.button.ok', 'app.button.cancel', 'app.button.save'],
      });

      const dto = {
        keys: ['app.button.ok', 'app.button.cancel', 'app.button.save'],
      };

      const result = await resourcesController.delete('test-collection', dto);

      expect(result).toEqual({
        entriesDeleted: 3,
        errors: undefined,
      });
      expect(deleteResource).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test-collection', translationsFolder: resolve('./translations/test') }),
        { keys: ['app.button.ok', 'app.button.cancel', 'app.button.save'] },
      );
    });

    it('should handle partial failures with errors array', async () => {
      const deleteResource = core.deleteResource as jest.Mock;
      deleteResource.mockReturnValue({
        entriesDeleted: 2,
        matchedKeys: ['app.button.ok', 'app.button.cancel'],
        errors: [
          {
            key: 'app.button.invalid',
            error: 'Resource entry not found: app.button.invalid',
          },
        ],
      });

      const dto = {
        keys: ['app.button.ok', 'app.button.cancel', 'app.button.invalid'],
      };

      const result = await resourcesController.delete('test-collection', dto);

      expect(result).toEqual({
        entriesDeleted: 2,
        errors: [
          {
            key: 'app.button.invalid',
            error: 'Resource entry not found: app.button.invalid',
          },
        ],
      });
    });

    it('should URI decode collection names with special characters', async () => {
      const deleteResource = core.deleteResource as jest.Mock;
      deleteResource.mockReturnValue({ entriesDeleted: 1 });

      const configWithEncodedName = {
        ...mockConfig,
        collections: {
          'My Collection': {
            translationsFolder: './translations/my-collection',
          },
        },
      };
      jest.spyOn(configService, 'getConfig').mockReturnValue(configWithEncodedName);

      const dto = {
        keys: ['app.button.ok'],
      };

      await resourcesController.delete('My%20Collection', dto);

      expect(deleteResource).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My Collection', translationsFolder: resolve('./translations/my-collection') }),
        { keys: ['app.button.ok'] },
      );
    });

    it('should throw NotFoundException when collection does not exist', async () => {
      const configWithoutCollection = {
        ...mockConfig,
        collections: {},
      };
      jest.spyOn(configService, 'getConfig').mockReturnValue(configWithoutCollection);

      const dto = {
        keys: ['app.button.ok'],
      };

      await expect(resourcesController.delete('non-existent', dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw HttpException (400) for empty keys array', async () => {
      const dto = {
        keys: [],
      };

      await expect(resourcesController.delete('test-collection', dto)).rejects.toThrow(HttpException);

      try {
        await resourcesController.delete('test-collection', dto);
      } catch (error: any) {
        expect(error.status).toBe(400);
        expect(error.message).toContain('keys array is required');
      }
    });

    it('should throw HttpException (400) for missing keys array', async () => {
      const dto = {} as any;

      await expect(resourcesController.delete('test-collection', dto)).rejects.toThrow(HttpException);

      try {
        await resourcesController.delete('test-collection', dto);
      } catch (error: any) {
        expect(error.status).toBe(400);
      }
    });

    it('should answer 500 for unexpected errors', async () => {
      const deleteResource = core.deleteResource as jest.Mock;
      deleteResource.mockImplementation(() => {
        throw new Error('Unexpected file system error');
      });

      const dto = {
        keys: ['app.button.ok'],
      };

      const error = await httpErrorOf(resourcesController.delete('test-collection', dto));
      expect(error.getStatus()).toBe(500);
    });

    it('should successfully delete nested resource', async () => {
      const deleteResource = core.deleteResource as jest.Mock;
      deleteResource.mockReturnValue({
        entriesDeleted: 1,
        matchedKeys: ['apps.common.buttons.ok'],
      });

      const dto = {
        keys: ['apps.common.buttons.ok'],
      };

      const result = await resourcesController.delete('test-collection', dto);

      expect(result).toEqual({
        entriesDeleted: 1,
        errors: undefined,
      });
      expect(deleteResource).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test-collection', translationsFolder: resolve('./translations/test') }),
        { keys: ['apps.common.buttons.ok'] },
      );
    });
  });

  describe('move', () => {
    it('should successfully move resources', async () => {
      const moveResource = core.moveResource as jest.Mock;
      moveResource.mockReturnValue({
        movedCount: 1,
        warnings: [],
        errors: [],
      });

      const dto = {
        moves: [{ source: 'app.button.ok', destination: 'app.actions.ok' }],
      };

      const result = await resourcesController.move('test-collection', dto);

      expect(result).toEqual({
        movedCount: 1,
        warnings: [],
        errors: [],
      });
      expect(moveResource).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test-collection', translationsFolder: resolve('./translations/test') }),
        expect.objectContaining({
          source: 'app.button.ok',
          destination: 'app.actions.ok',
        }),
      );
    });

    it('should pass override flag', async () => {
      const moveResource = core.moveResource as jest.Mock;
      moveResource.mockReturnValue({
        movedCount: 1,
        warnings: [],
        errors: [],
      });

      const dto = {
        moves: [
          {
            source: 'app.button.ok',
            destination: 'app.actions.ok',
            override: true,
          },
        ],
      };

      await resourcesController.move('test-collection', dto);

      expect(moveResource).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test-collection', translationsFolder: resolve('./translations/test') }),
        expect.objectContaining({
          source: 'app.button.ok',
          destination: 'app.actions.ok',
          override: true,
        }),
      );
    });

    it('should aggregate results from multiple moves', async () => {
      const moveResource = core.moveResource as jest.Mock;
      moveResource.mockReturnValueOnce({ movedCount: 1, warnings: [], errors: [] }).mockReturnValueOnce({
        movedCount: 0,
        warnings: ['Exists'],
        errors: [],
      });

      const dto = {
        moves: [
          { source: 'a', destination: 'b' },
          { source: 'c', destination: 'd' },
        ],
      };

      const result = await resourcesController.move('test-collection', dto);

      expect(result.movedCount).toBe(1);
      expect(result.warnings).toContain('Exists');
      expect(moveResource).toHaveBeenCalledTimes(2);
    });

    it('should throw BadRequest if moves array is empty', async () => {
      const dto = { moves: [] };
      await expect(resourcesController.move('test-collection', dto)).rejects.toThrow(HttpException);
    });

    it('should throw BadRequest if moves is missing', async () => {
      const dto = {} as any;
      await expect(resourcesController.move('test-collection', dto)).rejects.toThrow(HttpException);
    });

    it('should handle cross-collection move', async () => {
      const moveResource = core.moveResource as jest.Mock;
      moveResource.mockReturnValue({
        movedCount: 1,
        warnings: [],
        errors: [],
      });

      const dto = {
        moves: [
          {
            source: 'app.button.ok',
            destination: 'app.actions.ok',
            toCollection: 'other-collection',
          },
        ],
      };

      // Mock config with other collection
      const configWithOtherCollection = {
        ...mockConfig,
        collections: {
          ...mockConfig.collections,
          'other-collection': {
            translationsFolder: './translations/other',
          },
        },
      };
      jest.spyOn(configService, 'getConfig').mockReturnValue(configWithOtherCollection);

      const result = await resourcesController.move('test-collection', dto);

      expect(result.movedCount).toBe(1);
      expect(moveResource).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test-collection', translationsFolder: resolve('./translations/test') }),
        expect.objectContaining({
          source: 'app.button.ok',
          destination: 'app.actions.ok',
          destinationCollection: expect.objectContaining({
            name: 'other-collection',
            translationsFolder: resolve('./translations/other'),
          }),
        }),
      );
    });

    it('should report error if destination collection not found', async () => {
      const moveResource = core.moveResource as jest.Mock;

      const dto = {
        moves: [
          {
            source: 'app.button.ok',
            destination: 'app.actions.ok',
            toCollection: 'non-existent',
          },
        ],
      };
      const result = await resourcesController.move('test-collection', dto);

      expect(result.movedCount).toBe(0);
      expect(result.errors).toContain('Destination collection "non-existent" not found');
      expect(moveResource).not.toHaveBeenCalled();
    });

    it('should report error if destination collection is read-only', async () => {
      const moveResource = core.moveResource as jest.Mock;
      jest.spyOn(configService, 'getConfig').mockReturnValue({
        ...mockConfig,
        collections: {
          ...mockConfig.collections,
          vendor: { translationsFolder: './translations/vendor', readOnly: true },
        },
      });

      const dto = {
        moves: [{ source: 'app.button.ok', destination: 'app.actions.ok', toCollection: 'vendor' }],
      };
      const result = await resourcesController.move('test-collection', dto);

      expect(result.movedCount).toBe(0);
      expect(result.errors).toContain('Collection "vendor" is read-only. Its resources cannot be modified.');
      expect(moveResource).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should successfully update a resource', async () => {
      const editResource = core.editResource as jest.Mock;
      editResource.mockReturnValue({
        resolvedKey: 'app.button.ok',
        updated: true,
      });

      const dto = {
        key: 'app.button.ok',
        baseValue: 'OK Updated',
      };

      const result = await resourcesController.update('test-collection', dto);

      expect(result).toEqual({
        resolvedKey: 'app.button.ok',
        updated: true,
        message: undefined,
      });
      expect(editResource).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-collection',
          translationsFolder: resolve('./translations/test'),
          baseLocale: 'en',
        }),
        'app.button.ok',
        {
          baseValue: 'OK Updated',
          comment: undefined,
          tags: undefined,
          translations: undefined,
          moveTo: undefined,
        },
      );
    });

    it('should return the updated resource addressed at its resolved key', async () => {
      const editResource = core.editResource as jest.Mock;
      editResource.mockReturnValue({
        resolvedKey: 'shared.ok',
        updated: true,
        entry: { key: 'ok', source: 'OK', translations: {}, metadata: { en: { checksum: 'a' } } },
      });

      const result = await resourcesController.update('test-collection', { key: 'app.button.ok', moveTo: 'shared' });

      expect(result.resource).toMatchObject({
        fullKey: 'shared.ok',
        folderPath: 'shared',
        entryKey: 'ok',
        base: { locale: 'en', value: 'OK' },
      });
    });

    it('should pass moveTo through to core', async () => {
      const editResource = core.editResource as jest.Mock;
      editResource.mockReturnValue({ resolvedKey: 'shared.ok', updated: true });

      await resourcesController.update('test-collection', {
        key: 'app.button.ok',
        moveTo: 'shared',
      });

      expect(editResource).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test-collection' }),
        'app.button.ok',
        expect.objectContaining({ moveTo: 'shared' }),
      );
    });

    it('should answer 409 when the destination resource already exists', async () => {
      const editResource = core.editResource as jest.Mock;
      editResource.mockRejectedValue(new core.ResourceAlreadyExistsError('shared.ok'));

      const error = await httpErrorOf(
        resourcesController.update('test-collection', { key: 'app.button.ok', moveTo: 'shared' }),
      );

      expect(error.getStatus()).toBe(409);
    });

    it('should return no-op message when no changes detected', async () => {
      const editResource = core.editResource as jest.Mock;
      editResource.mockReturnValue({
        resolvedKey: 'app.button.ok',
        updated: false,
        message: 'No changes detected',
      });

      const dto = {
        key: 'app.button.ok',
        baseValue: 'OK',
      };

      const result = await resourcesController.update('test-collection', dto);

      expect(result).toEqual({
        resolvedKey: 'app.button.ok',
        updated: false,
        message: 'No changes detected',
      });
    });

    it('should answer 404 when resource not found', async () => {
      const editResource = core.editResource as jest.Mock;
      editResource.mockImplementation(() => {
        throw new core.ResourceNotFoundError('app.button.missing');
      });

      const dto = {
        key: 'app.button.missing',
      };

      await expect(resourcesController.update('test-collection', dto)).rejects.toThrow(core.ResourceNotFoundError);

      const error = await httpErrorOf(resourcesController.update('test-collection', dto));
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe('Resource not found: app.button.missing');
    });

    it('should answer 400 for validation errors', async () => {
      const editResource = core.editResource as jest.Mock;
      editResource.mockImplementation(() => {
        throw new core.InvalidResourceKeyError('invalid..key', 'Key validation: Invalid key format "invalid..key"');
      });

      const dto = {
        key: 'invalid..key',
      };

      const error = await httpErrorOf(resourcesController.update('test-collection', dto));
      expect(error.getStatus()).toBe(400);
    });
  });

  describe('getTree', () => {
    const mockTreeNode = {
      folderPathSegments: [],
      resources: [
        {
          key: 'title',
          source: 'Title',
          translations: { es: 'Título' },
          metadata: {
            en: { checksum: 'a' },
            es: { status: 'new', checksum: '', baseChecksum: 'a' },
          },
        },
      ],
      children: [],
    };

    const mockResponse = () => ({ status: jest.fn().mockReturnThis() });

    it('should return the tree read from the index', async () => {
      mockIndex.tree.mockReturnValue({ status: 'ready', tree: mockTreeNode });
      const response = mockResponse();

      const tree = (await resourcesController.getTree(
        'test-collection',
        undefined,
        undefined,
        response as any,
      )) as ResourceTreeDto;

      expect(tree.path).toBe('');
      expect(tree.resources).toEqual([
        {
          fullKey: 'title',
          folderPath: '',
          entryKey: 'title',
          base: { locale: 'en', value: 'Title' },
          targets: [
            { locale: 'fr-ca', value: undefined, status: undefined, needsWork: true, sameAsBase: false },
            { locale: 'es', value: 'Título', status: 'new', needsWork: true, sameAsBase: false },
          ],
          tags: [],
          inheritedTags: [],
        },
      ]);
      expect(mockIndex.tree).toHaveBeenCalledWith(expect.objectContaining({ name: 'test-collection' }), '');
      expect(response.status).not.toHaveBeenCalled();
    });

    it('should pass the path to the index', async () => {
      mockIndex.tree.mockReturnValue({ status: 'ready', tree: { ...mockTreeNode, folderPathSegments: ['apps'] } });

      const tree = (await resourcesController.getTree(
        'test-collection',
        'apps',
        undefined,
        mockResponse() as any,
      )) as ResourceTreeDto;

      expect(tree.path).toBe('apps');
      expect(tree.resources.map((r) => [r.fullKey, r.folderPath, r.entryKey])).toEqual([
        ['apps.title', 'apps', 'title'],
      ]);
      expect(mockIndex.tree).toHaveBeenCalledWith(expect.anything(), 'apps');
    });

    it('should list every resource recursively when includeNested is set', async () => {
      const extractResourcesRecursively = core.extractResourcesRecursively as jest.Mock;
      mockIndex.tree.mockReturnValue({ status: 'ready', tree: mockTreeNode });
      extractResourcesRecursively.mockReturnValue([
        ...mockTreeNode.resources,
        {
          key: 'dialog.save',
          source: 'Save',
          translations: { es: 'Guardar' },
          metadata: {
            en: { checksum: 'b' },
            es: { status: 'new', checksum: '', baseChecksum: 'b' },
          },
        },
      ]);

      const tree = (await resourcesController.getTree(
        'test-collection',
        '',
        'true',
        mockResponse() as any,
      )) as ResourceTreeDto;

      expect(extractResourcesRecursively).toHaveBeenCalledWith(mockTreeNode);
      expect(tree.resources.map((r) => r.fullKey)).toEqual(['title', 'dialog.save']);
    });

    it('should give nested resources their full address below a non-root path', async () => {
      const extractResourcesRecursively = core.extractResourcesRecursively as jest.Mock;
      const appsNode = { ...mockTreeNode, folderPathSegments: ['apps'] };
      mockIndex.tree.mockReturnValue({ status: 'ready', tree: appsNode });
      extractResourcesRecursively.mockReturnValue([
        ...appsNode.resources,
        { key: 'dialog.save', source: 'Save', translations: {}, metadata: { en: { checksum: 'b' } } },
      ]);

      const tree = (await resourcesController.getTree(
        'test-collection',
        'apps',
        'true',
        mockResponse() as unknown as Response,
      )) as ResourceTreeDto;

      expect(tree.resources.map((r) => [r.fullKey, r.folderPath, r.entryKey])).toEqual([
        ['apps.title', 'apps', 'title'],
        ['apps.dialog.save', 'apps.dialog', 'save'],
      ]);
    });

    it.each([
      ['not-started', { status: 'not-ready', message: expect.stringContaining('indexing started') }],
      ['error', { status: 'not-ready', message: expect.stringContaining('re-indexing') }],
      ['indexing', { status: 'indexing', message: expect.stringContaining('currently being indexed') }],
    ])('should return 202 when the index is %s', async (status, expected) => {
      mockIndex.tree.mockReturnValue({ status });
      const response = mockResponse();

      const result = await resourcesController.getTree('test-collection', '', undefined, response as any);

      expect(response.status).toHaveBeenCalledWith(202);
      expect(result).toEqual(expected);
    });

    it('should return 404 when the path is not in the tree', async () => {
      mockIndex.tree.mockReturnValue({ status: 'ready', tree: null });

      await expect(
        resourcesController.getTree('test-collection', 'nonexistent.path', undefined, mockResponse() as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return 404 for non-existent collection', async () => {
      jest.spyOn(configService, 'getConfig').mockReturnValue({ ...mockConfig, collections: {} });

      await expect(resourcesController.getTree('nonexistent', '', undefined, mockResponse() as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return a generic 500 when reading the index throws', async () => {
      mockIndex.tree.mockImplementationOnce(() => {
        throw new Error('boom');
      });

      const error = await httpErrorOf(
        resourcesController.getTree('test-collection', '', undefined, mockResponse() as any),
      );
      expect(error.getStatus()).toBe(500);
      expect(error.message).toBe('Internal server error');
    });
  });

  describe('getCacheStatus', () => {
    it('should return the index status', async () => {
      const status = { status: 'ready', collectionName: 'test-collection', stats: { totalKeys: 42, localeCount: 3 } };
      mockIndex.status.mockReturnValue(status);

      await expect(resourcesController.getCacheStatus('test-collection')).resolves.toEqual(status);
    });

    it('should return 404 for non-existent collection', async () => {
      jest.spyOn(configService, 'getConfig').mockReturnValue({ ...mockConfig, collections: {} });

      await expect(resourcesController.getCacheStatus('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should URI decode collection names with special characters', async () => {
      jest.spyOn(configService, 'getConfig').mockReturnValue({
        ...mockConfig,
        collections: { 'My Collection': { translationsFolder: './translations/my-collection' } },
      });
      mockIndex.status.mockReturnValue({ status: 'ready', collectionName: 'My Collection' });

      await resourcesController.getCacheStatus('My%20Collection');

      expect(mockIndex.status).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Collection' }));
    });
  });

  describe('search', () => {
    it('should map the search results from the index', async () => {
      mockIndex.search.mockReturnValue([
        {
          key: 'app.title',
          source: 'LingoTracker',
          translations: { es: 'LingoTracker' },
          metadata: { en: { checksum: 'a' }, es: { status: 'translated', checksum: 'b', baseChecksum: 'a' } },
        },
      ]);

      const result = await resourcesController.search('test-collection', { query: 'lingo' });

      expect(result.query).toBe('lingo');
      expect(result.results.map((r) => [r.fullKey, r.folderPath, r.entryKey])).toEqual([['app.title', 'app', 'title']]);
      expect(result.results[0].base).toEqual({ locale: 'en', value: 'LingoTracker' });
      expect(result.results[0].targets.map((t) => [t.locale, t.status, t.sameAsBase])).toEqual([
        ['fr-ca', undefined, false],
        ['es', 'translated', true],
      ]);
      expect(result.limited).toBe(false);
      expect(mockIndex.search).toHaveBeenCalledWith(expect.objectContaining({ name: 'test-collection' }), 'lingo', 101);
    });

    it('should return empty results for empty query', async () => {
      const result = await resourcesController.search('test-collection', { query: '' });
      expect(result.results).toEqual([]);
      expect(mockIndex.search).not.toHaveBeenCalled();
    });

    it('should cap maxResults at 500 and report limited results', async () => {
      mockIndex.search.mockReturnValue(
        Array.from({ length: 501 }, (_, i) => ({ key: `k${i}`, source: 'x', translations: {}, metadata: {} })),
      );

      const result = await resourcesController.search('test-collection', { query: 'test', maxResults: 1000 });

      expect(mockIndex.search).toHaveBeenCalledWith(expect.anything(), 'test', 501);
      expect(result.limited).toBe(true);
      expect(result.results).toHaveLength(500);
    });
  });

  describe('translateResource', () => {
    const mockEntry = {
      key: 'save',
      source: 'Save',
      translations: { 'fr-ca': 'Sauvegarder', es: 'Guardar' },
      metadata: {
        en: { checksum: 'base_hash' },
        'fr-ca': { checksum: 'fr_hash', baseChecksum: 'base_hash', status: 'translated' },
        es: { checksum: 'es_hash', baseChecksum: 'base_hash', status: 'translated' },
      },
    };

    const configWithTranslation = {
      ...mockConfig,
      translation: {
        enabled: true,
        provider: 'google-translate',
        apiKeyEnv: 'GOOGLE_TRANSLATE_API_KEY',
      },
    };

    it('should return 422 when translation is not enabled for the collection', async () => {
      const translateExistingResource = core.translateExistingResource as jest.Mock;
      translateExistingResource.mockRejectedValue(new core.AutoTranslationDisabledError('test-collection'));

      const error = await httpErrorOf(
        resourcesController.translateResource('test-collection', { key: 'buttons.save' }),
      );

      expect(error.getStatus()).toBe(422);
    });

    it('should return 404 when the collection does not exist', async () => {
      (configService.getConfig as jest.Mock).mockReturnValue(configWithTranslation);

      await expect(
        resourcesController.translateResource('unknown-collection', { key: 'buttons.save' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return 404 when the resource does not exist', async () => {
      (configService.getConfig as jest.Mock).mockReturnValue(configWithTranslation);

      const translateExistingResource = core.translateExistingResource as jest.Mock;
      translateExistingResource.mockRejectedValue(new core.ResourceNotFoundError('buttons.save'));

      const error = await httpErrorOf(
        resourcesController.translateResource('test-collection', { key: 'buttons.save' }),
      );
      expect(error).toBeInstanceOf(NotFoundException);
    });

    it('should return 502 when the translation provider throws a TranslationError', async () => {
      (configService.getConfig as jest.Mock).mockReturnValue(configWithTranslation);

      const translateExistingResource = core.translateExistingResource as jest.Mock;
      translateExistingResource.mockRejectedValue(
        new TranslationError('Google Translate server error: backend down', 'SERVER_ERROR', true),
      );

      const error = await httpErrorOf(
        resourcesController.translateResource('test-collection', { key: 'buttons.save' }),
      );
      expect(error.getStatus()).toBe(502);
      expect(error.message).toBe('Translation provider error: Google Translate server error: backend down');
    });

    it('should return a TranslateResourceResponseDto with translated resource on success', async () => {
      (configService.getConfig as jest.Mock).mockReturnValue(configWithTranslation);

      const translateExistingResource = core.translateExistingResource as jest.Mock;
      translateExistingResource.mockResolvedValue({
        translatedCount: 2,
        skippedLocales: [],
        entry: mockEntry,
      });

      const result = await resourcesController.translateResource('test-collection', { key: 'buttons.save' });

      expect(result.translatedCount).toBe(2);
      expect(result.skippedLocales).toEqual([]);
      expect(result.resource).toMatchObject({ fullKey: 'buttons.save', folderPath: 'buttons', entryKey: 'save' });
      expect(result.resource.targets.map((t) => t.status)).toEqual(['translated', 'translated']);
    });

    it('should pass the opened collection and resource key to core', async () => {
      (configService.getConfig as jest.Mock).mockReturnValue(configWithTranslation);
      const translateExistingResource = core.translateExistingResource as jest.Mock;
      translateExistingResource.mockResolvedValue({
        translatedCount: 1,
        skippedLocales: [],
        entry: mockEntry,
      });

      await resourcesController.translateResource('test-collection', { key: 'buttons.save' });

      expect(translateExistingResource).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-collection',
          translationsFolder: resolve('./translations/test'),
        }),
        'buttons.save',
      );
    });

    it('should hand the translation mutations to the index', async () => {
      (configService.getConfig as jest.Mock).mockReturnValue(configWithTranslation);

      const mutations = [{ kind: 'upsert', translationsFolder: '/t', key: 'buttons.save', entry: mockEntry }];
      const translateExistingResource = core.translateExistingResource as jest.Mock;
      translateExistingResource.mockResolvedValue({
        translatedCount: 1,
        skippedLocales: [],
        entry: mockEntry,
        mutations,
      });

      await resourcesController.translateResource('test-collection', { key: 'buttons.save' });

      expect(mockIndex.apply).toHaveBeenCalledWith(mutations);
    });

    it('should include skipped locales in the response', async () => {
      (configService.getConfig as jest.Mock).mockReturnValue(configWithTranslation);

      const translateExistingResource = core.translateExistingResource as jest.Mock;
      translateExistingResource.mockResolvedValue({
        translatedCount: 0,
        skippedLocales: ['fr-ca', 'es'],
        entry: mockEntry,
      });

      const result = await resourcesController.translateResource('test-collection', { key: 'buttons.save' });

      expect(result.translatedCount).toBe(0);
      expect(result.skippedLocales).toEqual(['fr-ca', 'es']);
    });
  });

  describe('translateLocale (POST translate-locale)', () => {
    const configWithTranslation = {
      ...mockConfig,
      translation: {
        enabled: true,
        provider: 'google-translate',
        apiKeyEnv: 'GOOGLE_TRANSLATE_API_KEY',
      },
    };

    const mockJobDto = {
      jobId: 'mock-job-id',
      collectionName: 'test-collection',
      targetLocale: 'fr-ca',
      status: 'pending' as const,
      totalResources: 0,
      translatedCount: 0,
      failedCount: 0,
      skippedCount: 0,
    };

    it('should return 202 with a job DTO when valid', async () => {
      const translationJobService = resourcesModule.get<TranslationJobService>(TranslationJobService);
      (translationJobService.startJob as jest.Mock).mockReturnValue('mock-job-id');
      (translationJobService.getJob as jest.Mock).mockReturnValue(mockJobDto);
      (configService.getConfig as jest.Mock).mockReturnValue(configWithTranslation);

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };

      await resourcesController.translateLocale('test-collection', { locale: 'fr-ca' }, mockResponse as any);

      expect(mockResponse.status).toHaveBeenCalledWith(202);
      expect(mockResponse.json).toHaveBeenCalledWith(mockJobDto);
    });

    it('should return 404 when collection not found', async () => {
      (configService.getConfig as jest.Mock).mockReturnValue({ ...mockConfig, collections: {} });

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };

      await expect(
        resourcesController.translateLocale('unknown-collection', { locale: 'fr-ca' }, mockResponse as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return 422 when translation is not enabled for the collection', async () => {
      // mockConfig has no translation config — auto-translation is disabled by default
      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };

      try {
        await resourcesController.translateLocale('test-collection', { locale: 'fr-ca' }, mockResponse as any);
        fail('expected HttpException to be thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(422);
      }
    });

    it('should return 400 when locale equals the base locale', async () => {
      (configService.getConfig as jest.Mock).mockReturnValue(configWithTranslation);

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };

      try {
        await resourcesController.translateLocale('test-collection', { locale: 'en' }, mockResponse as any);
        fail('expected HttpException to be thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(400);
      }
    });

    it('should return 400 when locale is not in the collection locales list', async () => {
      (configService.getConfig as jest.Mock).mockReturnValue(configWithTranslation);

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };

      try {
        await resourcesController.translateLocale('test-collection', { locale: 'de' }, mockResponse as any);
        fail('expected HttpException to be thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(400);
      }
    });
  });

  describe('getTranslateLocaleJob (GET translate-locale/:jobId)', () => {
    const mockJobDto = {
      jobId: 'known-job-id',
      collectionName: 'test-collection',
      targetLocale: 'fr-ca',
      status: 'completed' as const,
      totalResources: 10,
      translatedCount: 9,
      failedCount: 1,
      skippedCount: 0,
    };

    it('should return the job DTO when found and collection matches', async () => {
      const translationJobService = resourcesModule.get<TranslationJobService>(TranslationJobService);
      (translationJobService.getJob as jest.Mock).mockReturnValue(mockJobDto);

      const result = await resourcesController.getTranslateLocaleJob('test-collection', 'known-job-id');

      expect(result).toEqual(mockJobDto);
    });

    it('should return 404 when job not found', async () => {
      const translationJobService = resourcesModule.get<TranslationJobService>(TranslationJobService);
      (translationJobService.getJob as jest.Mock).mockReturnValue(undefined);

      await expect(resourcesController.getTranslateLocaleJob('test-collection', 'unknown-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return 404 when job exists but collectionName does not match', async () => {
      const translationJobService = resourcesModule.get<TranslationJobService>(TranslationJobService);
      (translationJobService.getJob as jest.Mock).mockReturnValue({
        ...mockJobDto,
        collectionName: 'other-collection',
      });

      await expect(resourcesController.getTranslateLocaleJob('test-collection', 'known-job-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
