import { TRACKER_TOKENS } from '../../../../../i18n-types/tracker-resources';
import { apiErrorMessage } from '../../../../shared/api-error/api-error';
import type { Feedback } from '../../../feedback';
import type { DeleteResourceOutcome, TranslateResourceOutcome } from '../../../store/resource-write-outcome';

const { TOAST } = TRACKER_TOKENS.BROWSER;

function refusal(error: unknown, token: string): Feedback {
  const detail = apiErrorMessage(error, '');
  return { tone: 'error', placement: 'toast', token, ...(detail ? { detail } : {}) };
}

/** The toast for a row's delete. */
export function deleteFeedback(outcome: DeleteResourceOutcome): Feedback {
  switch (outcome.kind) {
    case 'deleted':
      return { tone: 'success', placement: 'toast', token: TOAST.RESOURCEDELETED };
    case 'not-deleted':
      return { tone: 'error', placement: 'toast', token: TOAST.DELETEFAILED };
    case 'refused':
      return refusal(outcome.error, TOAST.DELETEFAILED);
  }
}

/**
 * The toasts for a row's auto-translate, in the order they show: a success when any locale was
 * translated, then a warning naming the locales that were skipped. A partial result can have both.
 */
export function translateFeedback(outcome: TranslateResourceOutcome): Feedback[] {
  switch (outcome.kind) {
    case 'translated':
      return [translatedFeedback(outcome.translatedCount)];
    case 'up-to-date':
      return [{ tone: 'info', placement: 'toast', token: TOAST.ALLLOCALESUPTODATE }];
    case 'partial':
      return [
        ...(outcome.translatedCount > 0 ? [translatedFeedback(outcome.translatedCount)] : []),
        {
          tone: 'warning',
          placement: 'toast',
          token: TOAST.SKIPPEDLOCALESX,
          params: { locales: outcome.skippedLocales.join(', ') },
        },
      ];
    case 'refused':
      return [refusal(outcome.error, TOAST.TRANSLATEFAILED)];
  }
}

function translatedFeedback(count: number): Feedback {
  return count === 1
    ? { tone: 'success', placement: 'toast', token: TOAST.LOCALETRANSLATED }
    : { tone: 'success', placement: 'toast', token: TOAST.LOCALESTRANSLATEDX, params: { count } };
}
