import { resolve } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { FoldersController } from './folders.controller';
import { ConfigService } from '../../config/config.service';
import { CollectionIndex } from '../../cache/collection-index.service';
import { toHttpException } from '../../errors/lingo-tracker-exception.filter';
import * as core from '@simoncodes-ca/core';

// Mock the core module
jest.mock('@simoncodes-ca/core', () => {
  const actual = jest.requireActual('@simoncodes-ca/core');
  return {
    ...actual,
    createFolder: jest.fn(),
    deleteFolder: jest.fn(),
    moveFolder: jest.fn(),
  };
});

describe('FoldersController', () => {
  let foldersModule: TestingModule;
  let foldersController: FoldersController;
  let _configService: ConfigService;

  const mockConfig = {
    exportFolder: 'dist/lingo-export',
    importFolder: 'dist/lingo-import',
    baseLocale: 'en',
    locales: ['en', 'fr', 'es'],
    collections: {
      'test-collection': {
        translationsFolder: './translations/test',
        baseLocale: 'en',
        locales: ['en', 'fr', 'es'],
      },
      'another-collection': {
        translationsFolder: './translations/another',
        baseLocale: 'en',
        locales: ['en', 'fr'],
      },
    },
  };

  const mockIndex = { apply: jest.fn() };

  beforeEach(async () => {
    foldersModule = await Test.createTestingModule({
      controllers: [FoldersController],
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
      ],
    }).compile();

    foldersController = foldersModule.get<FoldersController>(FoldersController);
    _configService = foldersModule.get<ConfigService>(ConfigService);

    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  describe('POST /folders/move', () => {
    it('should successfully move a folder within the same collection', async () => {
      const moveFolderDto = {
        sourceFolderPath: 'apps.common.buttons',
        destinationFolderPath: 'apps.shared',
      };

      const mockMoveResult = {
        movedCount: 5,
        foldersDeleted: 1,
        warnings: [],
        errors: [],
      };

      (core.moveFolder as jest.Mock).mockResolvedValue(mockMoveResult);

      const result = await foldersController.move('test-collection', moveFolderDto);

      expect(core.moveFolder).toHaveBeenCalledWith(resolve('./translations/test'), {
        sourceFolderPath: 'apps.common.buttons',
        destinationFolderPath: 'apps.shared',
        override: undefined,
        nestUnderDestination: undefined,
        destinationTranslationsFolder: undefined,
      });

      expect(result).toEqual({
        movedCount: 5,
        foldersDeleted: 1,
        warnings: [],
        errors: [],
      });
    });

    it('should successfully move a folder with override option', async () => {
      const moveFolderDto = {
        sourceFolderPath: 'apps.buttons',
        destinationFolderPath: 'apps.actions',
        override: true,
      };

      const mockMoveResult = {
        movedCount: 3,
        foldersDeleted: 1,
        warnings: [],
        errors: [],
      };

      (core.moveFolder as jest.Mock).mockResolvedValue(mockMoveResult);

      const result = await foldersController.move('test-collection', moveFolderDto);

      expect(core.moveFolder).toHaveBeenCalledWith(resolve('./translations/test'), {
        sourceFolderPath: 'apps.buttons',
        destinationFolderPath: 'apps.actions',
        override: true,
        nestUnderDestination: undefined,
        destinationTranslationsFolder: undefined,
      });

      expect(result.movedCount).toBe(3);
      expect(result.foldersDeleted).toBe(1);
    });

    it('should handle cross-collection moves', async () => {
      const moveFolderDto = {
        sourceFolderPath: 'apps.buttons',
        destinationFolderPath: 'shared.buttons',
        toCollection: 'another-collection',
      };

      const mockMoveResult = {
        movedCount: 2,
        foldersDeleted: 1,
        warnings: [],
        errors: [],
      };

      (core.moveFolder as jest.Mock).mockResolvedValue(mockMoveResult);

      const result = await foldersController.move('test-collection', moveFolderDto);

      expect(core.moveFolder).toHaveBeenCalledWith(resolve('./translations/test'), {
        sourceFolderPath: 'apps.buttons',
        destinationFolderPath: 'shared.buttons',
        override: undefined,
        nestUnderDestination: undefined,
        destinationTranslationsFolder: resolve('./translations/another'),
      });

      expect(result.movedCount).toBe(2);
    });

    it('should throw NotFoundException when source collection not found', async () => {
      const moveFolderDto = {
        sourceFolderPath: 'apps.buttons',
        destinationFolderPath: 'apps.actions',
      };

      await expect(foldersController.move('nonexistent-collection', moveFolderDto)).rejects.toThrow(NotFoundException);

      expect(core.moveFolder).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when destination collection not found', async () => {
      const moveFolderDto = {
        sourceFolderPath: 'apps.buttons',
        destinationFolderPath: 'apps.actions',
        toCollection: 'nonexistent-collection',
      };

      await expect(foldersController.move('test-collection', moveFolderDto)).rejects.toThrow(NotFoundException);

      expect(core.moveFolder).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when destination collection is read-only', async () => {
      jest.spyOn(_configService, 'getConfig').mockReturnValue({
        ...mockConfig,
        collections: {
          ...mockConfig.collections,
          vendor: { translationsFolder: './translations/vendor', readOnly: true },
        },
      });
      const moveFolderDto = {
        sourceFolderPath: 'apps.buttons',
        destinationFolderPath: 'apps.actions',
        toCollection: 'vendor',
      };

      const move = foldersController.move('test-collection', moveFolderDto);
      await expect(move).rejects.toThrow(ForbiddenException);
      await expect(move).rejects.toThrow('Collection "vendor" is read-only. Its resources cannot be modified.');

      expect(core.moveFolder).not.toHaveBeenCalled();
    });

    it('should throw HttpException for validation errors (missing fields)', async () => {
      const moveFolderDto = {
        sourceFolderPath: '',
        destinationFolderPath: 'apps.actions',
      };

      await expect(foldersController.move('test-collection', moveFolderDto)).rejects.toThrow(HttpException);

      expect(core.moveFolder).not.toHaveBeenCalled();
    });

    it('should throw HttpException for circular dependency errors', async () => {
      const moveFolderDto = {
        sourceFolderPath: 'apps.common',
        destinationFolderPath: 'apps.common.buttons',
      };

      const mockMoveResult = {
        movedCount: 0,
        foldersDeleted: 0,
        warnings: [],
        errors: ['Cannot move folder into its own descendant'],
      };

      (core.moveFolder as jest.Mock).mockResolvedValue(mockMoveResult);

      await expect(foldersController.move('test-collection', moveFolderDto)).rejects.toThrow(HttpException);

      expect(core.moveFolder).toHaveBeenCalled();
    });

    it('should throw HttpException for invalid path segments', async () => {
      const moveFolderDto = {
        sourceFolderPath: 'apps.invalid@char',
        destinationFolderPath: 'apps.actions',
      };

      const mockMoveResult = {
        movedCount: 0,
        foldersDeleted: 0,
        warnings: [],
        errors: ['Invalid source folder path segment "invalid@char"'],
      };

      (core.moveFolder as jest.Mock).mockResolvedValue(mockMoveResult);

      await expect(foldersController.move('test-collection', moveFolderDto)).rejects.toThrow(HttpException);
    });

    it('should report a move of an empty folder', async () => {
      const moveFolderDto = {
        sourceFolderPath: 'apps.empty',
        destinationFolderPath: 'apps.shared',
      };

      const mockMoveResult = {
        movedCount: 0,
        foldersDeleted: 1,
        warnings: ['No resources found in source folder'],
        errors: [],
      };

      (core.moveFolder as jest.Mock).mockResolvedValue(mockMoveResult);

      const result = await foldersController.move('test-collection', moveFolderDto);

      expect(result.movedCount).toBe(0);
      expect(result.foldersDeleted).toBe(1);
      expect(result.warnings).toHaveLength(1);
    });

    it('should return warnings and errors from core function', async () => {
      const moveFolderDto = {
        sourceFolderPath: 'apps.buttons',
        destinationFolderPath: 'apps.actions',
      };

      const mockMoveResult = {
        movedCount: 3,
        foldersDeleted: 0,
        warnings: ['Resources moved but failed to delete source folder: Permission denied'],
        errors: [],
      };

      (core.moveFolder as jest.Mock).mockResolvedValue(mockMoveResult);

      const result = await foldersController.move('test-collection', moveFolderDto);

      expect(result.movedCount).toBe(3);
      expect(result.foldersDeleted).toBe(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('failed to delete source folder');
    });

    it('should handle URL-encoded collection names', async () => {
      const moveFolderDto = {
        sourceFolderPath: 'apps.buttons',
        destinationFolderPath: 'apps.actions',
      };

      const mockMoveResult = {
        movedCount: 1,
        foldersDeleted: 1,
        warnings: [],
        errors: [],
      };

      (core.moveFolder as jest.Mock).mockResolvedValue(mockMoveResult);

      await foldersController.move('test%2Dcollection', moveFolderDto);

      expect(core.moveFolder).toHaveBeenCalledWith(resolve('./translations/test'), expect.any(Object));
    });
  });

  describe('POST /folders (create)', () => {
    it('should successfully create a folder', async () => {
      const createFolderDto = {
        folderName: 'buttons',
        parentPath: 'apps.common',
      };

      const mockCreateResult = {
        folderPath: 'apps.common.buttons',
        created: true,
      };

      (core.createFolder as jest.Mock).mockReturnValue(mockCreateResult);

      const result = await foldersController.create('test-collection', createFolderDto);

      expect(core.createFolder).toHaveBeenCalledWith(resolve('./translations/test'), {
        folderName: 'buttons',
        parentPath: 'apps.common',
      });

      expect(result.created).toBe(true);
      expect(result.folderPath).toBe('apps.common.buttons');
    });

    it('lets an invalid folder name propagate; the exception filter answers 400', async () => {
      (core.createFolder as jest.Mock).mockImplementation(() => {
        throw new core.InvalidFolderPathError('folder name', 'bad name');
      });

      const error = await foldersController
        .create('test-collection', { folderName: 'bad name' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(core.InvalidFolderPathError);
      const http = toHttpException(error);
      expect(http.getStatus()).toBe(400);
      expect(http.message).toBe(
        'Validation error: Invalid folder name segment "bad name". Segments must match pattern [A-Za-z0-9_-]+',
      );
    });
  });

  describe('DELETE /folders', () => {
    it('should successfully delete a folder', async () => {
      const deleteFolderDto = {
        folderPath: 'apps.common.buttons',
      };

      const mockDeleteResult = {
        folderPath: 'apps.common.buttons',
        deleted: true,
        resourcesDeleted: 5,
      };

      (core.deleteFolder as jest.Mock).mockReturnValue(mockDeleteResult);

      const result = await foldersController.delete('test-collection', deleteFolderDto);

      expect(core.deleteFolder).toHaveBeenCalledWith(resolve('./translations/test'), {
        folderPath: 'apps.common.buttons',
      });

      expect(result.deleted).toBe(true);
      expect(result.resourcesDeleted).toBe(5);
    });
  });
});
