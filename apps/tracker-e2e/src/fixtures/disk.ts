import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface CollectionConfig {
  translationsFolder: string;
  baseLocale?: string;
  locales?: string[];
  exportFolder?: string;
  importFolder?: string;
  readOnly?: boolean;
  tags?: string[];
}

export interface ProjectConfig {
  baseLocale: string;
  locales: string[];
  exportFolder: string;
  importFolder: string;
  collections: Record<string, CollectionConfig>;
  [key: string]: unknown;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export function readConfig(projectRoot: string): Promise<ProjectConfig> {
  return readJson(join(projectRoot, '.lingo-tracker.json'));
}

export function readEntries(folder: string): Promise<Record<string, unknown>> {
  return readJson(join(folder, 'resource_entries.json'));
}

export function readMeta(folder: string): Promise<Record<string, unknown>> {
  return readJson(join(folder, 'tracker_meta.json'));
}
