import type { TranslationStatus } from '@simoncodes-ca/domain';
import type { ImportedResource, ImportRunOptions } from './types';

/**
 * Returns true when the imported resource's status field should be used as the resulting
 * translation status, rather than the strategy's default status.
 *
 * This is the case when:
 * - `preserveStatus` is explicitly `true` (all strategies, existing behaviour), OR
 * - the strategy is `'migration'` and `preserveStatus` has not been explicitly disabled
 *   (i.e. is `undefined`), which is the new default-on behaviour for migration imports.
 *
 * The check on `resource.status` ensures we only override when the source data actually
 * carries a status value — missing status fields fall through to strategy defaults.
 */
export function shouldUseSourceStatus(
  options: ImportRunOptions,
  resource: ImportedResource,
): resource is ImportedResource & { status: TranslationStatus } {
  if (!resource.status) {
    return false;
  }

  if (options.preserveStatus === true) {
    return true;
  }

  return options.strategy === 'migration' && options.preserveStatus !== false;
}

/**
 * Determines the translation status for a brand-new resource being created.
 *
 * For base locale imports, status is always `undefined` (base locale entries
 * carry no translation status). For target locale imports, the strategy and
 * any source status on the resource drive the result.
 *
 * @param options - Import options including strategy and preserveStatus flag
 * @param resource - The imported resource being created
 * @returns The translation status to assign, or `undefined` for base locale entries
 */
export function determineNewResourceStatus(options: ImportRunOptions, resource: ImportedResource): TranslationStatus {
  return shouldUseSourceStatus(options, resource) ? resource.status : 'translated';
}

/**
 * Returns the imported resource's status when it should be honoured (see {@link shouldUseSourceStatus}),
 * otherwise `undefined` so the strategy decides (see `resolveImportStatus` in domain).
 */
export function honouredSourceStatus(
  options: ImportRunOptions,
  resource: ImportedResource,
): TranslationStatus | undefined {
  return shouldUseSourceStatus(options, resource) ? resource.status : undefined;
}
