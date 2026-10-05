import type { CreateFolderResult, DeleteFolderResult, MoveResult } from '@simoncodes-ca/core';
import type {
  CreateFolderResponseDto,
  DeleteFolderResponseDto,
  MoveFolderResponseDto,
} from '@simoncodes-ca/data-transfer';
import { mapMoveResourcesResultToDto } from './resource-response.mapper';

/** Builds the loaded, empty node used for tree insertion, including already-existing folders. */
export function mapCreateFolderResultToDto(result: CreateFolderResult, folderName: string): CreateFolderResponseDto {
  return {
    folderPath: result.folderPath,
    created: result.created,
    folder: {
      name: folderName,
      fullPath: result.folderAddress,
      loaded: true,
      tree: { path: result.folderAddress, resources: [], children: [] },
    },
  };
}

/** Adds the success marker; core throws instead of returning a failed folder deletion. */
export function mapDeleteFolderResultToDto(result: DeleteFolderResult): DeleteFolderResponseDto {
  return { deleted: true, folderPath: result.folderPath, resourcesDeleted: result.resourcesDeleted };
}

/** Excludes internal outcome and supplies zero when core has no folder count. */
export function mapMoveFolderResultToDto(result: MoveResult): MoveFolderResponseDto {
  const { movedCount, warnings, errors } = mapMoveResourcesResultToDto(result);
  return {
    movedCount,
    foldersDeleted: result.foldersDeleted ?? 0,
    warnings,
    errors,
  };
}
