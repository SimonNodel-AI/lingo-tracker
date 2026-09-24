import * as path from 'node:path';
import type { BundlePlan, GenerateBundleResult } from '@simoncodes-ca/core';
import type { BundleDryRunResultDto, BundleGenerateJobResultDto } from '@simoncodes-ca/data-transfer';
import { type BundleDefinition, bundleOutputFile } from '@simoncodes-ca/domain';

/** Upper bound on conflict keys returned by a dry run so huge bundles stay cheap to serialise. */
export const MAX_CONFLICT_KEYS = 50;

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
 * file count; the DTO carries paths, rebuilt from the processed locales with the
 * domain `bundleOutputFile` rule (the one core writes with) so the UI can list what was written. Core resolves the
 * types file to an absolute path, so every path is normalised relative to `cwd`.
 */
export function mapGenerateBundleResultToJobResult(
  result: GenerateBundleResult,
  bundleDefinition: BundleDefinition,
  cwd: string = process.cwd(),
): BundleGenerateJobResultDto {
  const filesGenerated = result.localesProcessed.map((locale) =>
    toProjectRelative(bundleOutputFile(bundleDefinition, locale), cwd),
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
