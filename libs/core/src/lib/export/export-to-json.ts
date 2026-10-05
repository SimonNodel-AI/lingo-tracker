import { buildKeyTree } from '@simoncodes-ca/domain';
import type { ExportOptions, ExportResult, FilteredResource } from './types';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeJsonFile } from '../file-io/json-file-operations';

/**
 * Exports resources to JSON format.
 */
export function exportToJson(resources: FilteredResource[], options: ExportOptions, baseLocale?: string): ExportResult {
  const result: ExportResult = {
    format: 'json',
    filesCreated: [],
    resourcesExported: 0,
    warnings: [],
    errors: [],
    collections: options.collections || [],
    locales: options.locales || [],
    outputDirectory: options.outputDirectory,
    omittedResources: [],
    malformedFiles: [],
    hierarchicalConflicts: [],
  };

  // Group resources by locale
  const resourcesByLocale = new Map<string, FilteredResource[]>();
  for (const resource of resources) {
    if (!resourcesByLocale.has(resource.locale)) {
      resourcesByLocale.set(resource.locale, []);
    }
    resourcesByLocale.get(resource.locale)?.push(resource);
  }

  for (const [locale, localeResources] of resourcesByLocale.entries()) {
    try {
      if (options.onProgress) {
        options.onProgress(`Processing ${locale} (${localeResources.length} resources)`);
      }

      const filename = getFilename(locale, options, baseLocale);
      const filePath = path.join(options.outputDirectory, filename);

      let content: Record<string, unknown>;
      let conflicts: string[] = [];
      let keysCount: number;

      if (options.jsonStructure === 'flat') {
        content = buildFlatStructure(localeResources, options);
        keysCount = Object.keys(content).length;
      } else {
        // Default to hierarchical
        const built = buildHierarchicalStructure(localeResources, options);
        content = built.tree;
        conflicts = built.conflicts;
        keysCount = built.keysCount;
      }

      if (conflicts.length > 0) {
        result.hierarchicalConflicts.push(...conflicts.map((c) => `[${locale}] ${c}`));
      }

      if (fs.existsSync(filePath)) {
        result.warnings.push(`Overwriting existing file: ${filename}`);
      }

      if (!options.dryRun) {
        if (options.onProgress) {
          options.onProgress(`Writing ${filePath}`);
        }
        writeJsonFile({ filePath, data: content });
      }

      result.filesCreated.push(filename);
      result.resourcesExported += keysCount;
    } catch (error) {
      result.errors.push(`Failed to export locale ${locale}: ${(error as Error).message}`);
    }
  }

  return result;
}

function getFilename(locale: string, options: ExportOptions, baseLocale?: string): string {
  if (options.filenamePattern) {
    let name = options.filenamePattern
      .replace('{locale}', locale)
      .replace('{target}', locale) // Alias for locale in JSON context
      .replace('{date}', new Date().toISOString().split('T')[0]);

    if (baseLocale) {
      name = name.replace('{source}', baseLocale);
    }

    if (!name.endsWith('.json')) {
      name += '.json';
    }
    return name;
  }
  return `${locale}.json`;
}

export function buildFlatStructure(resources: FilteredResource[], options: ExportOptions): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const res of resources) {
    result[res.key] = formatValue(res, options);
  }

  return result;
}

export function buildHierarchicalStructure(
  resources: FilteredResource[],
  options: ExportOptions,
): { tree: Record<string, unknown>; conflicts: string[]; keysCount: number } {
  let keysCount = 0;
  const built = buildKeyTree(
    resources.map((resource) => [resource.key, resource] as const),
    {
      leaf: (resource) => {
        keysCount++;
        return formatValue(resource, options);
      },
    },
  );
  const keys = [...new Set(resources.map((resource) => resource.key))].sort();
  const conflicts = built.conflicts.map(
    (key) =>
      `${key} has a value and child keys; skipped ${keys.filter((child) => child.startsWith(`${key}.`)).join(', ')}`,
  );
  return { tree: built.tree, conflicts, keysCount };
}

function formatValue(resource: FilteredResource, options: ExportOptions): unknown {
  const useRich =
    options.richJson || options.includeBase || options.includeComment || options.includeStatus || options.includeTags;

  if (useRich) {
    const richObj: Record<string, unknown> = {
      value: resource.value,
    };

    if (options.includeBase && resource.baseValue) {
      richObj[options.basePropertyName ?? 'baseValue'] = resource.baseValue;
    }

    if (options.includeComment && resource.comment) {
      richObj['comment'] = resource.comment;
    }

    if (options.includeStatus) {
      richObj['status'] = resource.status;
    }

    if (options.includeTags && resource.tags && resource.tags.length > 0) {
      richObj['tags'] = resource.tags;
    }

    if (resource.protectedTermsFound?.length) {
      richObj['doNotTranslate'] = resource.protectedTermsFound;
    }

    return richObj;
  }

  return resource.value;
}
