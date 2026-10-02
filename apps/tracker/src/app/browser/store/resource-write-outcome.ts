import type { DeleteResourceResponseDto, TranslateResourceResponseDto } from '@simoncodes-ca/data-transfer';

/** How a row's delete ended: the server removed the entry, found nothing to remove, or refused. */
export type DeleteResourceOutcome = { kind: 'deleted' } | { kind: 'not-deleted' } | { kind: 'refused'; error: unknown };

/**
 * How a row's auto-translate ended.
 * - `translated`: at least one locale was translated and none skipped.
 * - `up-to-date`: nothing to translate and nothing skipped.
 * - `partial`: some locales were skipped (ICU format), whether or not others were translated.
 * - `refused`: the request failed.
 */
export type TranslateResourceOutcome =
  | { kind: 'translated'; translatedCount: number }
  | { kind: 'up-to-date' }
  | { kind: 'partial'; translatedCount: number; skippedLocales: readonly string[] }
  | { kind: 'refused'; error: unknown };

export function deleteOutcome(response: DeleteResourceResponseDto): DeleteResourceOutcome {
  return { kind: response.entriesDeleted > 0 ? 'deleted' : 'not-deleted' };
}

export function translateOutcome({
  translatedCount,
  skippedLocales,
}: Pick<TranslateResourceResponseDto, 'translatedCount' | 'skippedLocales'>): TranslateResourceOutcome {
  if (skippedLocales.length > 0) return { kind: 'partial', translatedCount, skippedLocales };
  return translatedCount > 0 ? { kind: 'translated', translatedCount } : { kind: 'up-to-date' };
}
