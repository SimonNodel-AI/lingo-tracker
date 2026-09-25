import type { ResourceSummaryTarget, TranslationStatus } from '@simoncodes-ca/domain';

/**
 * The status the Tracker shows, filters, counts and sorts a target by: the stored status, or `new` for a
 * target that needs work without one (the round-one rule: an entry without metadata is treated as `new`
 * everywhere). Presentation only; nothing is stored.
 */
export function displayStatus(target: ResourceSummaryTarget | undefined): TranslationStatus | undefined {
  return target?.status ?? (target?.needsWork ? 'new' : undefined);
}
