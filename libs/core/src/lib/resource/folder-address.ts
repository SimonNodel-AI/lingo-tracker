import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { isValidSegment } from '@simoncodes-ca/domain';
import type { FolderPathPart } from '../errors/error-messages';
import { InvalidFolderPathError } from '../errors/lingo-tracker-error';

/** A dot-delimited folder address. The empty address names the collection root. */
export function validateFolderAddress(address: string, part: FolderPathPart, allowRoot = true): string[] {
  if (address === '' && allowRoot) return [];
  const segments = address.split('.');
  for (const segment of segments) {
    if (!isValidSegment(segment)) throw new InvalidFolderPathError(part, segment);
  }
  return segments;
}

/** Resolve a folder address beneath a collection's translations folder. */
export function resolveFolderAddress(translationsFolder: string, address: string, cwd = process.cwd()): string {
  const segments = address === '' ? [] : address.split('.');
  return resolve(cwd, translationsFolder, ...segments);
}

/** Whether the addressed path exists (a file also counts as existing). */
export function folderAddressExists(translationsFolder: string, address: string, cwd = process.cwd()): boolean {
  return existsSync(resolveFolderAddress(translationsFolder, address, cwd));
}

/** Resolve an address once and check whether it names an existing directory. */
export function inspectFolderAddress(
  translationsFolder: string,
  address: string,
): { readonly absolutePath: string; readonly isDirectory: boolean } {
  const absolutePath = resolveFolderAddress(translationsFolder, address);
  return { absolutePath, isDirectory: existsSync(absolutePath) && statSync(absolutePath).isDirectory() };
}
