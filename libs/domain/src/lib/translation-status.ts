/**
 * Translation status for a resource in a specific locale.
 */
export const TRANSLATION_STATUSES = ['new', 'translated', 'stale', 'verified'] as const;

export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number];

export function isTranslationStatus(value: unknown): value is TranslationStatus {
  return TRANSLATION_STATUSES.some((status) => status === value);
}
