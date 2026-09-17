import * as path from 'node:path';
import type {
  BundleDefinition,
  BundlePlan,
  CollectionBundleDefinition,
  EntrySelectionRule,
  GenerateBundleResult,
} from '@simoncodes-ca/core';
import { getBundleOutputPath } from '@simoncodes-ca/core';
import type {
  BundleDefinitionDto,
  BundleDryRunResultDto,
  BundleGenerateJobResultDto,
  CollectionBundleDefinitionDto,
  EntrySelectionRuleDto,
} from '@simoncodes-ca/data-transfer';

/** Upper bound on conflict keys returned by a dry run so huge bundles stay cheap to serialise. */
export const MAX_CONFLICT_KEYS = 50;

export function mapBundleDefinitionToDto(definition: BundleDefinition): BundleDefinitionDto {
  const dto: BundleDefinitionDto = {
    bundleName: definition.bundleName,
    dist: definition.dist,
    collections:
      definition.collections === 'All'
        ? 'All'
        : definition.collections.map((collection) => mapCollectionDefinitionToDto(collection)),
  };

  if (definition.typeDistFile !== undefined) dto.typeDistFile = definition.typeDistFile;
  if (definition.tokenCasing !== undefined) dto.tokenCasing = definition.tokenCasing;
  if (definition.tokenConstantName !== undefined) dto.tokenConstantName = definition.tokenConstantName;
  if (definition.transformICUToTransloco !== undefined) {
    dto.transformICUToTransloco = definition.transformICUToTransloco;
  }

  return dto;
}

function mapCollectionDefinitionToDto(collection: CollectionBundleDefinition): CollectionBundleDefinitionDto {
  const dto: CollectionBundleDefinitionDto = {
    name: collection.name,
    entriesSelectionRules:
      collection.entriesSelectionRules === 'All'
        ? 'All'
        : collection.entriesSelectionRules.map((rule) => mapRuleToDto(rule)),
  };

  if (collection.bundledKeyPrefix !== undefined) dto.bundledKeyPrefix = collection.bundledKeyPrefix;
  if (collection.mergeStrategy !== undefined) dto.mergeStrategy = collection.mergeStrategy;

  return dto;
}

function mapRuleToDto(rule: EntrySelectionRule): EntrySelectionRuleDto {
  const dto: EntrySelectionRuleDto = { matchingPattern: rule.matchingPattern };

  if (rule.matchingTags !== undefined) dto.matchingTags = [...rule.matchingTags];
  if (rule.matchingTagOperator !== undefined) dto.matchingTagOperator = rule.matchingTagOperator;

  return dto;
}

/**
 * Maps an incoming DTO to a core definition. Strings are trimmed and empty or
 * undefined optionals are dropped so nothing spurious lands in the config file.
 * Structural validation (required fields, unknown collections, …) is left to
 * `validateBundleDefinition`; this mapper only normalises what it is given.
 */
export function mapDtoToBundleDefinition(dto: BundleDefinitionDto): BundleDefinition {
  const definition: BundleDefinition = {
    bundleName: trimString(dto.bundleName),
    dist: trimString(dto.dist),
    collections: Array.isArray(dto.collections)
      ? dto.collections.map((collection) => mapDtoToCollectionDefinition(collection))
      : dto.collections,
  };

  const typeDistFile = optionalString(dto.typeDistFile);
  if (typeDistFile !== undefined) definition.typeDistFile = typeDistFile;

  if (dto.tokenCasing !== undefined) definition.tokenCasing = dto.tokenCasing;

  const tokenConstantName = optionalString(dto.tokenConstantName);
  if (tokenConstantName !== undefined) definition.tokenConstantName = tokenConstantName;

  if (typeof dto.transformICUToTransloco === 'boolean') {
    definition.transformICUToTransloco = dto.transformICUToTransloco;
  }

  return definition;
}

function mapDtoToCollectionDefinition(dto: CollectionBundleDefinitionDto): CollectionBundleDefinition {
  const collection: CollectionBundleDefinition = {
    name: trimString(dto.name),
    entriesSelectionRules: Array.isArray(dto.entriesSelectionRules)
      ? dto.entriesSelectionRules.map((rule) => mapDtoToRule(rule))
      : dto.entriesSelectionRules,
  };

  const bundledKeyPrefix = optionalString(dto.bundledKeyPrefix);
  if (bundledKeyPrefix !== undefined) collection.bundledKeyPrefix = bundledKeyPrefix;

  if (dto.mergeStrategy !== undefined) collection.mergeStrategy = dto.mergeStrategy;

  return collection;
}

function mapDtoToRule(dto: EntrySelectionRuleDto): EntrySelectionRule {
  const rule: EntrySelectionRule = { matchingPattern: trimString(dto.matchingPattern) };

  if (Array.isArray(dto.matchingTags)) {
    const tags = dto.matchingTags.map((tag) => trimString(tag)).filter((tag) => tag.length > 0);
    if (tags.length > 0) rule.matchingTags = tags;
  }

  if (dto.matchingTagOperator !== undefined) rule.matchingTagOperator = dto.matchingTagOperator;

  return rule;
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalString(value: unknown): string | undefined {
  const trimmed = trimString(value);
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Maps a dry-run plan to its DTO, dropping absolute paths and capping the conflict lists. */
export function mapBundlePlanToDto(plan: BundlePlan): BundleDryRunResultDto {
  return {
    name: plan.bundleKey,
    locales: [...plan.locales],
    files: plan.files.map((file) => ({
      path: file.path,
      kind: file.kind,
      ...(file.locale !== undefined && { locale: file.locale }),
      exists: file.exists,
      keysCount: file.keysCount,
    })),
    keysPerLocale: { ...plan.keysPerLocale },
    conflictsCount: plan.conflictsCount,
    conflictKeys: plan.conflictKeys.slice(0, MAX_CONFLICT_KEYS),
    hierarchicalConflicts: plan.hierarchicalConflicts.slice(0, MAX_CONFLICT_KEYS),
    ...(plan.exampleKey && { exampleKey: { ...plan.exampleKey } }),
    warnings: [...plan.warnings],
  };
}

/**
 * Maps a finished `generateBundle` run to the job result DTO. Core reports a
 * file count; the DTO carries paths, rebuilt from the processed locales and the
 * bundle definition so the UI can list what was written. Core resolves the
 * types file to an absolute path, so every path is normalised relative to `cwd`.
 */
export function mapGenerateBundleResultToJobResult(
  result: GenerateBundleResult,
  bundleDefinition: BundleDefinition,
  cwd: string = process.cwd(),
): BundleGenerateJobResultDto {
  const filesGenerated = result.localesProcessed.map((locale) =>
    toProjectRelative(getBundleOutputPath(bundleDefinition, locale), cwd),
  );
  const types = result.typeGenerationResult;
  const typeDistFile =
    types?.fileGenerated && types.typeDistFile ? toProjectRelative(types.typeDistFile, cwd) : undefined;

  if (typeDistFile !== undefined) {
    filesGenerated.push(typeDistFile);
  }

  return {
    filesGenerated,
    keysPerLocale: { ...result.keysPerLocale },
    warnings: [...result.warnings],
    localesProcessed: [...result.localesProcessed],
    ...(typeDistFile !== undefined && { typeDistFile }),
    ...(types?.fileGenerated && { typesKeysCount: types.keysCount }),
  };
}

/** Returns `filePath` relative to `cwd` (posix separators) when it lives inside `cwd`; otherwise unchanged. */
function toProjectRelative(filePath: string, cwd: string): string {
  const normalized = path.isAbsolute(filePath) ? path.relative(cwd, filePath) : path.normalize(filePath);
  if (normalized.startsWith('..')) {
    return filePath;
  }
  return normalized.split(path.sep).join('/');
}
