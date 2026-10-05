import {
  mapCreateFolderResultToDto,
  mapDeleteFolderResultToDto,
  mapMoveFolderResultToDto,
} from './folder-response.mapper';

describe('folder response mapping', () => {
  it('uses the resolved address and submitted name for a loaded empty tree, even when the folder exists', () => {
    for (const created of [true, false]) {
      const dto = mapCreateFolderResultToDto(
        { folderAddress: 'apps.common.buttons', folderPath: '/translations/apps/common/buttons', created },
        'common.buttons',
      );
      expect(dto).toStrictEqual({
        folderPath: '/translations/apps/common/buttons',
        created,
        folder: {
          name: 'common.buttons',
          fullPath: 'apps.common.buttons',
          loaded: true,
          tree: { path: 'apps.common.buttons', resources: [], children: [] },
        },
      });
      expect(Object.keys(dto)).toEqual(['folderPath', 'created', 'folder']);
    }
  });

  it('adds the folder deletion success marker and preserves the response field order', () => {
    const dto = mapDeleteFolderResultToDto({ folderPath: 'apps.common', resourcesDeleted: 2 });
    expect(dto).toStrictEqual({ deleted: true, folderPath: 'apps.common', resourcesDeleted: 2 });
    expect(Object.keys(dto)).toEqual(['deleted', 'folderPath', 'resourcesDeleted']);
  });

  it('omits internal outcome and keeps folder counts and diagnostic arrays for successful and failed moves', () => {
    for (const result of [
      { outcome: 'succeeded' as const, movedCount: 2, foldersDeleted: 1, warnings: [], errors: [] },
      { outcome: 'failed' as const, movedCount: 0, warnings: ['Warning'], errors: ['Failed'] },
    ]) {
      const dto = mapMoveFolderResultToDto(result);
      expect(dto).toStrictEqual({
        movedCount: result.movedCount,
        foldersDeleted: 'foldersDeleted' in result ? result.foldersDeleted : 0,
        warnings: result.warnings,
        errors: result.errors,
      });
      expect(Object.keys(dto)).toEqual(['movedCount', 'foldersDeleted', 'warnings', 'errors']);
      expect(dto.warnings).toBe(result.warnings);
      expect(dto.errors).toBe(result.errors);
    }
  });
});
