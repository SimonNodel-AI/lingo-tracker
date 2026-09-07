import { computed, inject, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import type { TranslationStatus } from '@simoncodes-ca/data-transfer';
import { TRACKER_TOKENS } from '../../../i18n-types/tracker-resources';

/** Number of locales in each translation status. */
export type StatusCounts = Record<TranslationStatus, number>;

/** Pluralized "{n} <status>" resource for each status. */
const COUNT_TOKENS: Record<TranslationStatus, string> = {
  stale: TRACKER_TOKENS.BROWSER.STATUS.STALECOUNTX,
  new: TRACKER_TOKENS.BROWSER.STATUS.NEWCOUNTX,
  translated: TRACKER_TOKENS.BROWSER.STATUS.TRANSLATEDCOUNTX,
  verified: TRACKER_TOKENS.BROWSER.STATUS.VERIFIEDCOUNTX,
};

/** Worst status first, so the part that needs attention is read first. */
const BREAKDOWN_ORDER: readonly TranslationStatus[] = ['stale', 'new', 'translated', 'verified'];

/**
 * Signal of the active UI language. Read it inside a `computed` that calls
 * `TranslocoService.translate()` imperatively — that call is not reactive on its
 * own, so without this dependency the derived text survives a language switch
 * unchanged. Must be called from an injection context.
 */
export function injectActiveLang(): Signal<string> {
  const transloco = inject(TranslocoService);
  return toSignal(transloco.langChanges$, { initialValue: transloco.getActiveLang() });
}

/**
 * Builds a localized status breakdown such as "2 stale, 1 new" from a signal of
 * counts, omitting statuses with no locales and falling back to the "no statuses"
 * message when every count is zero. The list is joined with `Intl.ListFormat` so
 * the separator follows the reader's language rather than a hardcoded comma.
 * Must be called from an injection context.
 */
export function injectStatusBreakdown(counts: Signal<StatusCounts>): Signal<string> {
  const transloco = inject(TranslocoService);
  const activeLang = injectActiveLang();

  return computed(() => {
    const lang = activeLang();
    const current = counts();

    const parts = BREAKDOWN_ORDER.filter((status) => current[status] > 0).map((status) =>
      transloco.translate(COUNT_TOKENS[status], { count: current[status] }),
    );

    if (parts.length === 0) {
      return transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONITEM.NOSTATUSES);
    }

    return formatList(parts, lang);
  });
}

/** Joins list parts for a language, falling back when the tag is not usable. */
function formatList(parts: string[], lang: string): string {
  try {
    return new Intl.ListFormat(lang, { style: 'short', type: 'unit' }).format(parts);
  } catch {
    return parts.join(', ');
  }
}
