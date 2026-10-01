import { isTranslationStatus, type TranslationStatus } from '@simoncodes-ca/domain';
import { InvalidTranslationStatusError } from '../errors/lingo-tracker-error';

/** Check a status received at a core write boundary, including values supplied by untyped callers. */
export function assertTranslationStatus(value: unknown): asserts value is TranslationStatus {
  if (!isTranslationStatus(value)) throw new InvalidTranslationStatusError(value);
}
