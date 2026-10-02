import { Controller, Post, Delete } from '@nestjs/common';
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
import { RouteCollection } from '../route-collection';
import { createFolderBody, deleteFolderBody, moveFolderBody } from '../../validation/dto-schemas';
import { ValidBody } from '../../validation/valid-body';

@Controller('collections/:collectionName/folders')
export class FoldersController {
  constructor(
    private readonly configService: ConfigService,
    private readonly index: CollectionIndex,
  ) {}

  @Post()
  async create(
    @RouteCollection() collection: Collection,
    @ValidBody(createFolderBody) createFolderDto: CreateFolderDto,
  ): Promise<CreateFolderResponseDto> {
    const result = createFolder(
      collection,
      {
        folderName: createFolderDto.folderName,
        parentPath: createFolderDto.parentPath,
      },
      { onMutation: this.index.sink },
    );

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
    @ValidBody(deleteFolderBody) deleteFolderDto: DeleteFolderDto,
  ): Promise<DeleteFolderResponseDto> {
    const result = deleteFolder(
      collection,
      {
        folderPath: deleteFolderDto.folderPath,
      },
      { onMutation: this.index.sink },
    );

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
    @ValidBody(moveFolderBody) moveFolderDto: MoveFolderDto,
  ): Promise<MoveFolderResponseDto> {
    // Cross-collection moves need the config to resolve the destination.
    const config = this.configService.getConfig();

    const result = await moveFolder(
      collection,
      {
        sourceFolderPath: moveFolderDto.sourceFolderPath,
        destinationFolderPath: moveFolderDto.destinationFolderPath,
        override: moveFolderDto.override,
        nestUnderDestination: moveFolderDto.nestUnderDestination,
        toCollection: moveFolderDto.toCollection,
      },
      { config, onMutation: this.index.sink },
    );

    return {
      movedCount: result.movedCount,
      foldersDeleted: result.foldersDeleted,
      warnings: result.warnings,
      errors: result.errors,
    };
  }
}
