import type { BundleDryRunResultDto } from '@simoncodes-ca/data-transfer';
import { bundleOutputFile } from '@simoncodes-ca/domain';

interface OutputDraft {
  readonly dist: string;
  readonly bundleName: string;
  readonly typesEnabled: boolean;
  readonly typeDistFile: string;
}

export interface BundleOutputPreview {
  readonly outputSummary: string;
  readonly patternFiles: readonly string[];
  readonly typeFileName: string;
  readonly folders: readonly PreviewFolder[];
}

export interface PreviewFolder {
  readonly path: string;
  readonly pathParts: readonly string[];
  readonly files: readonly PreviewFile[];
}

export interface PreviewFile {
  readonly name: string;
  readonly nameParts: readonly string[];
  readonly kind: 'bundle' | 'types';
  readonly exists: boolean | undefined;
}

interface PreviewPath {
  path: string;
  kind: PreviewFile['kind'];
  exists: boolean | undefined;
}

export const LOCALE_PLACEHOLDER = '{locale}';
const PATH_SEPARATORS = /(?<=[._\-/])/;

/** Projects draft output paths or an API plan into the dialog's file preview. */
export function bundleOutputPreview(input: {
  readonly draft: OutputDraft;
  readonly locales: readonly string[];
  readonly plan?: Pick<BundleDryRunResultDto, 'files'>;
}): BundleOutputPreview {
  const { draft, locales, plan } = input;
  return {
    outputSummary: outputSummary(draft),
    patternFiles: patternFiles(draft, locales),
    typeFileName: typeFileName(draft),
    folders: plan ? bundlePlannedOutputPreview(plan) : localTree(draft, locales),
  };
}

function outputSummary(draft: OutputDraft): string {
  if (!draft.dist.trim() && !draft.bundleName.trim()) return '';
  return bundleOutputFile({ dist: draft.dist.trim(), bundleName: draft.bundleName.trim() }, LOCALE_PLACEHOLDER);
}

function typeFileName(draft: OutputDraft): string {
  if (!draft.typesEnabled) return '';
  return draft.typeDistFile.trim().split('/').pop() ?? '';
}

function patternFiles(draft: OutputDraft, locales: readonly string[]): string[] {
  const bundleName = draft.bundleName.trim();
  if (!bundleName) return [];
  return locales.map((locale) => bundleOutputFile({ dist: '', bundleName }, locale));
}

function outputFiles(draft: OutputDraft, locales: readonly string[]): string[] {
  const bundleName = draft.bundleName.trim();
  if (!bundleName) return [];
  return locales.map((locale) => bundleOutputFile({ dist: draft.dist.trim(), bundleName }, locale));
}

function localTree(draft: OutputDraft, locales: readonly string[]): readonly PreviewFolder[] {
  const files: PreviewPath[] = outputFiles(draft, locales).map((path) => ({ path, kind: 'bundle', exists: undefined }));
  if (draft.typesEnabled && draft.typeDistFile.trim()) {
    files.push({ path: stripDotSlash(draft.typeDistFile.trim()), kind: 'types', exists: undefined });
  }
  return groupIntoFolders(files);
}

/** The API plan echoes configured type paths, so tidy those paths for the tree. */
function stripDotSlash(path: string): string {
  return path.replace(/^\.\//, '').replace(/\/+$/, '');
}

export function bundlePlannedOutputPreview(plan: Pick<BundleDryRunResultDto, 'files'>): readonly PreviewFolder[] {
  return groupIntoFolders(plan.files.map((file) => ({ ...file, path: stripDotSlash(file.path) })));
}

function groupIntoFolders(files: readonly PreviewPath[]): readonly PreviewFolder[] {
  const folders = new Map<string, PreviewFile[]>();
  for (const file of files) {
    const slash = file.path.lastIndexOf('/');
    const folder = slash >= 0 ? file.path.slice(0, slash) : '';
    const name = slash >= 0 ? file.path.slice(slash + 1) : file.path;
    const list = folders.get(folder) ?? [];
    list.push({ name, nameParts: splitAfterSeparators(name, PATH_SEPARATORS), kind: file.kind, exists: file.exists });
    folders.set(folder, list);
  }
  return [...folders.entries()].map(([path, files]) => ({
    path,
    pathParts: splitAfterSeparators(path, PATH_SEPARATORS),
    files,
  }));
}

function splitAfterSeparators(value: string, separators: RegExp): readonly string[] {
  return value.length === 0 ? [] : value.split(separators);
}
