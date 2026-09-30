import type { LingoTrackerConfigDto, PreferredTermRuleErrorDto } from '@simoncodes-ca/data-transfer';
import { classifyConfigRefusal } from '../collections/store/dialog-config-submit';
import type { PreferredTerminologyDraft } from './preferred-terminology-draft';
import type { ProtectedTermsDraft } from '../shared/protected-terms/protected-terms-draft';

/** The changed lists for one Config Write; beginSave records rule row indexes. */
export function assembleSettingsPayload(
  terms: ProtectedTermsDraft,
  terminology: PreferredTerminologyDraft,
): Pick<LingoTrackerConfigDto, 'protectedTerms' | 'preferredTerminology'> {
  return {
    ...(terms.hasChanges() && { protectedTerms: terms.termsToSave() }),
    ...(terminology.hasChanges() && { preferredTerminology: terminology.beginSave() }),
  };
}

/** Validate a single item of the API Error `details` contract before assigning it to a rule row. */
export function isPreferredTermRuleErrorDto(value: unknown): value is PreferredTermRuleErrorDto {
  if (typeof value !== 'object' || value === null) return false;
  const { index, field, code, message } = value as Record<string, unknown>;
  return (
    typeof index === 'number' && typeof field === 'string' && typeof code === 'string' && typeof message === 'string'
  );
}

/** Only an invalid Config Write can supply preferred-terminology rule errors. */
export function extractRuleErrors(error: unknown): PreferredTermRuleErrorDto[] {
  const refusal = classifyConfigRefusal(error);
  return refusal.kind === 'invalid' ? refusal.details.filter(isPreferredTermRuleErrorDto) : [];
}
