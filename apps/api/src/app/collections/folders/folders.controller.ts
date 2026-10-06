import { Controller, Post, Delete } from '@nestjs/common';
import { type Collection, createFolder, deleteFolder, executeMove } from '@simoncodes-ca/core';
import type {
  CreateFolderDto,
  CreateFolderResponseDto,
  DeleteFolderDto,
  DeleteFolderResponseDto,
  MoveFolderDto,
  MoveFolderResponseDto,
} from '@simoncodes-ca/data-transfer';
import {
  mapCreateFolderResultToDto,
  mapDeleteFolderResultToDto,
  mapMoveFolderResultToDto,
} from '../../mappers/folder-response.mapper';
import { ConfigService } from '../../config/config.service';
import { RouteCollection } from '../route-collection';
import { createFolderBody, deleteFolderBody, moveFolderBody } from '../../validation/dto-schemas';
import { ValidBody } from '../../validation/valid-body';

@Controller('collections/:collectionName/folders')
export class FoldersController {
  constructor(private readonly configService: ConfigService) {}

  @Post()
  async create(
    @RouteCollection() collection: Collection,
    @ValidBody(createFolderBody) createFolderDto: CreateFolderDto,
  ): Promise<CreateFolderResponseDto> {
    const result = createFolder(collection, createFolderDto);

    return mapCreateFolderResultToDto(result, createFolderDto.folderName);
  }

  /** Failures are typed core errors: a missing folder answers 404, a malformed path 400. */
  @Delete()
  async delete(
    @RouteCollection() collection: Collection,
    @ValidBody(deleteFolderBody) deleteFolderDto: DeleteFolderDto,
  ): Promise<DeleteFolderResponseDto> {
    const result = deleteFolder(collection, deleteFolderDto);

    return mapDeleteFolderResultToDto(result);
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

    const result = executeMove(
      collection,
      {
        kind: 'folder',
        source: moveFolderDto.sourceFolderPath,
        destination: moveFolderDto.destinationFolderPath,
        override: moveFolderDto.override,
        toCollection: moveFolderDto.toCollection,
        nestUnderDestination: moveFolderDto.nestUnderDestination,
      },
      { config },
    );

    return mapMoveFolderResultToDto(result);
  }
}
