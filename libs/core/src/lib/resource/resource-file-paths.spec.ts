import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { useTempDir } from '../../testing/temp-dir.spec-helpers';
import { InvalidResourceKeyError } from '../errors/lingo-tracker-error';
import { resolveResourcePaths, validateAndResolvePaths } from './resource-file-paths';

describe('resource file paths', () => {
  const dir = useTempDir('resource-paths-');

  it('resolves nested keys and a target folder without creating files', () => {
    const result = validateAndResolvePaths({
      key: 'buttons.ok',
      targetFolder: 'apps.common',
      translationsFolder: 'translations',
      cwd: dir(),
    });
    expect(result).toEqual({
      resolvedKey: 'apps.common.buttons.ok',
      entryKey: 'ok',
      folderPathSegments: ['apps', 'common', 'buttons'],
      folderPath: join(dir(), 'translations', 'apps', 'common', 'buttons'),
    });
    expect(existsSync(result.folderPath)).toBe(false);
  });

  it('keeps root entries in an absolute translations folder', () => {
    expect(resolveResourcePaths({ key: 'ok', translationsFolder: dir() })).toEqual({
      resolvedKey: 'ok',
      entryKey: 'ok',
      folderPathSegments: [],
      folderPath: dir(),
    });
  });

  it('uses the current working directory by default', () => {
    expect(validateAndResolvePaths({ key: 'ok', translationsFolder: 'translations' }).folderPath).toBe(
      join(process.cwd(), 'translations'),
    );
  });

  it('refuses invalid keys and target folders with typed errors', () => {
    for (const key of ['', 'a..b', '../escape']) {
      expect(() => validateAndResolvePaths({ key, translationsFolder: dir() })).toThrow(InvalidResourceKeyError);
    }
    expect(() => validateAndResolvePaths({ key: 'ok', targetFolder: '../escape', translationsFolder: dir() })).toThrow(
      InvalidResourceKeyError,
    );
  });
});
