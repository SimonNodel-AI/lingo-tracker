import { Controller, Post, Delete, Body, HttpException, HttpStatus } from '@nestjs/common';
import { type Collection, createFolder, deleteFolder, moveFolder } from '@simoncodes-ca/core';
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
import { openDestinationCollection } from '../open-route-collection';
import { RouteCollection } from '../route-collection';

@Controller('collections/:collectionName/folders')
export class FoldersController {
  constructor(
    private readonly configService: ConfigService,
    private readonly index: CollectionIndex,
  ) {}

  @Post()
  async create(
    @RouteCollection() collection: Collection,
    @Body() createFolderDto: CreateFolderDto,
  ): Promise<CreateFolderResponseDto> {
    const result = createFolder(collection, {
      folderName: createFolderDto.folderName,
      parentPath: createFolderDto.parentPath,
    });

    this.index.apply(result.mutations);

    // Build the folder node for the frontend to insert into tree
    const fullPath = result.folderAddress;

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

  /** Failures are typed core errors: a missing folder answers 404, a malformed path 400. */
  @Delete()
  async delete(
    @RouteCollection() collection: Collection,
    @Body() deleteFolderDto: DeleteFolderDto,
  ): Promise<DeleteFolderResponseDto> {
    const result = deleteFolder(collection, {
      folderPath: deleteFolderDto.folderPath,
    });

    this.index.apply(result.mutations);

    return {
      deleted: true,
      folderPath: result.folderPath,
      resourcesDeleted: result.resourcesDeleted,
    };
  }

  /**
   * Bad input is a typed core error (400 for a malformed path or a move into the folder's own
   * descendant, 404 for a missing source folder). Per-resource failures come back in `errors`.
   */
  @Post('move')
  async move(
    @RouteCollection() collection: Collection,
    @Body() moveFolderDto: MoveFolderDto,
  ): Promise<MoveFolderResponseDto> {
    // Cross-collection moves need the config to resolve the destination.
    const config = this.configService.getConfig();

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

    const destinationCollection = moveFolderDto.toCollection
      ? openDestinationCollection(config, moveFolderDto.toCollection)
      : undefined;

    const result = await moveFolder(collection, {
      sourceFolderPath: moveFolderDto.sourceFolderPath,
      destinationFolderPath: moveFolderDto.destinationFolderPath,
      override: moveFolderDto.override,
      nestUnderDestination: moveFolderDto.nestUnderDestination,
      destinationCollection,
    });

    this.index.apply(result.mutations);

    return {
      movedCount: result.movedCount,
      foldersDeleted: result.foldersDeleted,
      warnings: result.warnings,
      errors: result.errors,
    };
  }
}
