import { type BundlePlan, type GenerateBundleResult, describeTypeOutcome } from '@simoncodes-ca/core';
import type { BundleDryRunResultDto, BundleGenerateJobResultDto } from '@simoncodes-ca/data-transfer';

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
 * Maps a finished `generateBundle` run to the job result DTO. Core reports
 * written paths directly; the DTO keeps the same fields for the Tracker.
 */
export function mapGenerateBundleResultToJobResult(result: GenerateBundleResult): BundleGenerateJobResultDto {
  const types = result.typeOutcome;
  const typeDistFile = types.status === 'written' ? types.path : undefined;
  const typeWarning = describeTypeOutcome(result.bundleKey, types);

  return {
    filesGenerated: [...result.writtenFiles],
    keysPerLocale: { ...result.keysPerLocale },
    warnings: [...result.warnings, ...(typeWarning ? [typeWarning] : [])],
    localesProcessed: [...result.localesProcessed],
    ...(typeDistFile !== undefined && { typeDistFile }),
    ...(types.status === 'written' && { typesKeysCount: types.keysCount }),
  };
}
