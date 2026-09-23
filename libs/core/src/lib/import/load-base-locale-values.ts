import { resolveResourcePaths } from '../resource/resource-file-paths';
import { openResourceFolder } from '../resource/resource-folder';
import type { ImportedResource } from './types';

/**
 * Loads base locale values for all imported resources from existing resource files.
 *
 * Groups resources by folder to minimize file reads. Used to provide base values
 * for ICU auto-fixing during import operations.
 *
 * @param resources - Array of imported resources to load base values for
 * @param translationsFolder - Absolute path of the translations folder
 * @returns Map of resource keys to their base locale values
 */
export function loadBaseLocaleValues(resources: ImportedResource[], translationsFolder: string): Map<string, string> {
  const baseValues = new Map<string, string>();

  // Group by folder to minimize file reads
  const folderToKeys = new Map<string, Array<{ key: string; entryKey: string }>>();

  for (const resource of resources) {
    const { folderPath, entryKey } = resolveResourcePaths({ key: resource.key, translationsFolder });

    let folderKeys = folderToKeys.get(folderPath);
    if (!folderKeys) {
      folderKeys = [];
      folderToKeys.set(folderPath, folderKeys);
    }

    folderKeys.push({ key: resource.key, entryKey });
  }

  // Load base values from each folder
  for (const [folderPath, keys] of folderToKeys.entries()) {
    try {
      const folder = openResourceFolder(folderPath);

      for (const { key, entryKey } of keys) {
        const source = folder.get(entryKey)?.entry.source;
        if (source) {
          baseValues.set(key, source);
        }
      }
    } catch {
      // ignore errors if files can't be parsed
    }
  }

  return baseValues;
}
