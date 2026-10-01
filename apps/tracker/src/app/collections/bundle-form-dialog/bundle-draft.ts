import {
  bundleOutputFile,
  hasBundleCollections,
  hasBundleRules,
  normalizeBundleDefinition,
} from '@simoncodes-ca/domain';
import type {
  BundleDefinitionDto,
  BundleDryRunRequestDto,
  CollectionBundleDefinitionDto,
  EntrySelectionRuleDto,
  TokenCasingDto,
} from '@simoncodes-ca/data-transfer';

export type BundleSection = 'output' | 'collections' | `coll:${number}` | 'types' | 'options';
export type MergeStrategy = 'merge' | 'override';
export type TagOperator = 'Any' | 'All';
export type TokenCasingChoice = 'inherit' | TokenCasingDto;
export type IcuChoice = 'inherit' | 'on' | 'off';

export interface BundleDraftRule {
  matchingPattern: string;
  matchingTags: string[];
  matchingTagOperator: TagOperator;
}

export interface BundleDraftCollection {
  name: string;
  bundledKeyPrefix: string;
  mergeStrategy: MergeStrategy;
  allEntries: boolean;
  rules: BundleDraftRule[];
}

/** The form's raw choices, including values hidden by its toggles. */
export interface BundleDraft {
  name: string;
  dist: string;
  bundleName: string;
  allCollections: boolean;
  collections: BundleDraftCollection[];
  typesEnabled: boolean;
  typeDistFile: string;
  tokenCasing: TokenCasingChoice;
  tokenConstantName: string;
  transformICUToTransloco: IcuChoice;
}

export interface PreviewFolder {
  readonly path: string;
  readonly pathParts: readonly string[];
  readonly files: readonly PreviewFile[];
}

interface PreviewFile {
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

export function toDraft(
  definition: BundleDefinitionDto | undefined,
  allCollectionNames: readonly string[],
): BundleDraft {
  const bundle = definition === undefined ? undefined : normalizeBundleDefinition(definition);
  const collections = bundle?.collections;
  const selected = Array.isArray(collections) ? collections.map(toDraftCollection) : [];
  const first = allCollectionNames[0];
  if (collections !== 'All' && selected.length === 0 && first) {
    selected.push(toDraftCollection({ name: first, entriesSelectionRules: 'All' }));
  }

  return {
    name: '',
    dist: bundle?.dist ?? '',
    bundleName: bundle?.bundleName ?? '',
    allCollections: collections === 'All',
    collections: selected,
    typesEnabled: Boolean(bundle?.typeDistFile),
    typeDistFile: bundle?.typeDistFile ?? '',
    tokenCasing: bundle?.tokenCasing ?? 'inherit',
    tokenConstantName: bundle?.tokenConstantName ?? '',
    transformICUToTransloco:
      bundle?.transformICUToTransloco === undefined ? 'inherit' : bundle.transformICUToTransloco ? 'on' : 'off',
  };
}

function toDraftCollection(collection: CollectionBundleDefinitionDto): BundleDraftCollection {
  return {
    name: collection.name,
    bundledKeyPrefix: collection.bundledKeyPrefix ?? '',
    mergeStrategy: collection.mergeStrategy ?? 'merge',
    allEntries: collection.entriesSelectionRules === 'All',
    rules: Array.isArray(collection.entriesSelectionRules) ? collection.entriesSelectionRules.map(toDraftRule) : [],
  };
}

function toDraftRule(rule: EntrySelectionRuleDto): BundleDraftRule {
  return {
    matchingPattern: rule.matchingPattern,
    matchingTags: [...(rule.matchingTags ?? [])],
    matchingTagOperator: rule.matchingTagOperator ?? 'Any',
  };
}

export function toDefinition(draft: BundleDraft): BundleDefinitionDto {
  const collections: BundleDefinitionDto['collections'] = draft.allCollections
    ? 'All'
    : draft.collections.map((collection) => {
        const prefix = collection.bundledKeyPrefix.trim();
        const entriesSelectionRules: CollectionBundleDefinitionDto['entriesSelectionRules'] = collection.allEntries
          ? 'All'
          : collection.rules.map((rule) => ({
              matchingPattern: rule.matchingPattern.trim(),
              ...(rule.matchingTags.length > 0
                ? { matchingTags: [...rule.matchingTags], matchingTagOperator: rule.matchingTagOperator }
                : {}),
            }));
        return {
          name: collection.name,
          ...(prefix ? { bundledKeyPrefix: prefix } : {}),
          entriesSelectionRules,
          ...(collection.mergeStrategy === 'override' ? { mergeStrategy: 'override' as const } : {}),
        };
      });

  const typeDistFile = draft.typeDistFile.trim();
  const tokenConstantName = draft.tokenConstantName.trim();
  const typesOn = draft.typesEnabled && typeDistFile.length > 0;

  return {
    bundleName: draft.bundleName.trim(),
    dist: draft.dist.trim(),
    collections,
    ...(typesOn ? { typeDistFile } : {}),
    ...(typesOn && draft.tokenCasing !== 'inherit' ? { tokenCasing: draft.tokenCasing } : {}),
    ...(typesOn && tokenConstantName ? { tokenConstantName } : {}),
    ...(draft.transformICUToTransloco !== 'inherit'
      ? { transformICUToTransloco: draft.transformICUToTransloco === 'on' }
      : {}),
  };
}

export function dryRunRequest(draft: BundleDraft): BundleDryRunRequestDto | undefined {
  const name = draft.name.trim();
  if (!name || !draft.dist.trim() || !draft.bundleName.trim()) return undefined;
  return { name, bundle: toDefinition(draft) };
}

export function outputSummary(draft: BundleDraft): string {
  if (!draft.dist.trim() && !draft.bundleName.trim()) return '';
  return bundleOutputFile({ dist: draft.dist.trim(), bundleName: draft.bundleName.trim() }, LOCALE_PLACEHOLDER);
}

export function typeFileName(draft: BundleDraft): string {
  if (!draft.typesEnabled) return '';
  return draft.typeDistFile.trim().split('/').pop() ?? '';
}

export function patternFiles(draft: BundleDraft, locales: readonly string[]): string[] {
  const bundleName = draft.bundleName.trim();
  if (!bundleName) return [];
  return locales.map((locale) => bundleOutputFile({ dist: '', bundleName }, locale));
}

export function outputFiles(draft: BundleDraft, locales: readonly string[]): string[] {
  const bundleName = draft.bundleName.trim();
  if (!bundleName) return [];
  return locales.map((locale) => bundleOutputFile({ dist: draft.dist.trim(), bundleName }, locale));
}

export function localTree(draft: BundleDraft, locales: readonly string[]): readonly PreviewFolder[] {
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

export function plannedTree(files: readonly PreviewPath[]): readonly PreviewFolder[] {
  return groupIntoFolders(files.map((file) => ({ ...file, path: stripDotSlash(file.path) })));
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

export function splitAfterSeparators(value: string, separators: RegExp): readonly string[] {
  return value.length === 0 ? [] : value.split(separators);
}

/** Keep the form's error keys while using the domain definition rules. */
export function collectionsRequired(allCollections: boolean, count: number): boolean {
  return !hasBundleCollections(allCollections ? 'All' : Array.from({ length: count }, () => null));
}

export function rulesRequired(allEntries: boolean, count: number): boolean {
  return !hasBundleRules(allEntries ? 'All' : Array.from({ length: count }, () => null));
}

/** Reveal invalid fields in the same order as the dialog's navigation rail. */
export function firstErrorSection(
  errors: ReadonlySet<BundleSection>,
  collectionCount: number,
): BundleSection | undefined {
  const order: BundleSection[] = [
    'output',
    'collections',
    ...Array.from({ length: collectionCount }, (_, index) => `coll:${index}` as const),
    'types',
  ];
  return order.find((section) => errors.has(section));
}
