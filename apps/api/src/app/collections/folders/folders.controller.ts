import { Controller, Post, Delete, Param, Body, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { createFolder, deleteFolder, moveFolder } from '@simoncodes-ca/core';
import type {
  CreateFolderDto,
  CreateFolderResponseDto,
  FolderNodeDto,
  DeleteFolderDto,
  DeleteFolderResponseDto,
  MoveFolderDto,
  MoveFolderResponseDto,
} from '@simoncodes-ca/data-transfer';
import { ConfigService } from '../../config/config.service';
import { CollectionIndex } from '../../cache/collection-index.service';
import { WritableCollectionGuard } from '../guards/writable-collection.guard';
import { openDestinationCollection, openRouteCollection } from '../open-route-collection';

@UseGuards(WritableCollectionGuard)
@Controller('collections/:collectionName/folders')
export class FoldersController {
  constructor(
    private readonly configService: ConfigService,
    private readonly index: CollectionIndex,
  ) {}

  @Post()
  async create(
    @Param('collectionName') collectionName: string,
    @Body() createFolderDto: CreateFolderDto,
  ): Promise<CreateFolderResponseDto> {
    const { translationsFolder } = openRouteCollection(this.configService.getConfig(), collectionName);

    const result = createFolder(translationsFolder, {
      folderName: createFolderDto.folderName,
      parentPath: createFolderDto.parentPath,
    });

    this.index.apply(result.mutations);

    // Build the folder node for the frontend to insert into tree
    const fullPath = createFolderDto.parentPath
      ? `${createFolderDto.parentPath}.${createFolderDto.folderName}`
      : createFolderDto.folderName;

    const folderNode: FolderNodeDto = {
      name: createFolderDto.folderName,
      fullPath,
      loaded: true,
      tree: {
        path: fullPath,
        resources: [],
        children: [],
      },
    };

    return {
      folderPath: result.folderPath,
      created: result.created,
      folder: folderNode,
    };
  }

  /** Core `deleteFolder` reports every failure in `error`, so this answers 200 even then. */
  @Delete()
  async delete(
    @Param('collectionName') collectionName: string,
    @Body() deleteFolderDto: DeleteFolderDto,
  ): Promise<DeleteFolderResponseDto> {
    const { translationsFolder } = openRouteCollection(this.configService.getConfig(), collectionName);

    const result = deleteFolder(translationsFolder, {
      folderPath: deleteFolderDto.folderPath,
    });

    this.index.apply(result.mutations);

    return {
      deleted: result.deleted,
      folderPath: result.folderPath,
      resourcesDeleted: result.resourcesDeleted,
      error: result.error,
    };
  }

  @Post('move')
  async move(
    @Param('collectionName') collectionName: string,
    @Body() moveFolderDto: MoveFolderDto,
  ): Promise<MoveFolderResponseDto> {
    const config = this.configService.getConfig();
    const { translationsFolder } = openRouteCollection(config, collectionName);

    if (
      !moveFolderDto.sourceFolderPath ||
      moveFolderDto.destinationFolderPath === undefined ||
      moveFolderDto.destinationFolderPath === null
    ) {
      throw new HttpException(
        'Invalid request: sourceFolderPath and destinationFolderPath are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Handle cross-collection moves
    const destinationTranslationsFolder = moveFolderDto.toCollection
      ? openDestinationCollection(config, moveFolderDto.toCollection).translationsFolder
      : undefined;

    // Perform the move. Core `moveFolder` never throws; it reports failures in `errors`.
    const result = await moveFolder(translationsFolder, {
      sourceFolderPath: moveFolderDto.sourceFolderPath,
      destinationFolderPath: moveFolderDto.destinationFolderPath,
      override: moveFolderDto.override,
      nestUnderDestination: moveFolderDto.nestUnderDestination,
      destinationTranslationsFolder,
    });

    this.index.apply(result.mutations);

    // Check for critical errors that should return 400
    const hasCriticalError = result.errors.some(
      (err) =>
        err.includes('Invalid') || err.includes('not found') || err.includes('circular') || err.includes('descendant'),
    );

    if (hasCriticalError && result.movedCount === 0) {
      throw new HttpException(`Validation error: ${result.errors.join(', ')}`, HttpStatus.BAD_REQUEST);
    }

    return {
      movedCount: result.movedCount,
      foldersDeleted: result.foldersDeleted,
      warnings: result.warnings,
      errors: result.errors,
    };
  }
}
