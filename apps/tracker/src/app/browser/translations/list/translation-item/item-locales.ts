import { Component, ChangeDetectionStrategy, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { HighlightPipe } from '../../../../shared/pipes/highlight.pipe';
import { TranslocoPipe } from '@jsverse/transloco';
import type { TranslationStatus } from '@simoncodes-ca/data-transfer';
import { TRACKER_TOKENS } from '../../../../../i18n-types/tracker-resources';
import { injectStatusBreakdown, type StatusCounts } from '../../../../shared/i18n/status-breakdown';
import type { DensityMode } from '../../../types/density-mode';

/** The statuses a locale row can carry, as a runtime guard over the string field. */
const TRANSLATION_STATUSES: readonly TranslationStatus[] = ['new', 'stale', 'translated', 'verified'];

function asTranslationStatus(status: string | undefined): TranslationStatus | undefined {
  return TRANSLATION_STATUSES.find((s) => s === status);
}

export type LocaleTranslation = {
  locale: string;
  value: string;
  status?: string;
  /**
   * The stored value is byte-identical to the base locale's. The status metadata
   * still says `translated` — a checksum cannot tell a deliberate loanword from a
   * string nobody touched — so the row says it out loud instead of letting the
   * status chip pass source text off as finished work.
   */
  isSameAsBase?: boolean;
};

/**
 * The source string a translator judges every locale row against.
 *
 * It renders as the first row of the same grid rather than as a heading above it.
 * A translation can only be judged against the source when the two sit on one
 * baseline, in one measure, at one type size — a bold full-bleed heading and a
 * second-column body value are two separate readings of the same sentence.
 */
export type BaseTranslation = {
  locale: string;
  value: string;
};

/** Material icon name for a translation status. Shared with the compact item row. */
export function statusIconFor(status: string | undefined): string {
  switch (status) {
    case 'verified':
      return 'check_circle';
    case 'translated':
      return 'language';
    case 'stale':
      return 'warning';
    case 'new':
      return 'add_circle';
    default:
      return 'help_outline';
  }
}

/** Transloco token for a translation status label. Shared with the compact item row. */
export function statusLabelTokenFor(status: string | undefined): string {
  switch (status) {
    case 'verified':
      return TRACKER_TOKENS.BROWSER.STATUS.VERIFIED;
    case 'translated':
      return TRACKER_TOKENS.BROWSER.STATUS.TRANSLATED;
    case 'stale':
      return TRACKER_TOKENS.BROWSER.STATUS.STALE;
    case 'new':
      return TRACKER_TOKENS.BROWSER.STATUS.NEW;
    default:
      return '';
  }
}

/**
 * Displays locale translations in a grid layout.
 * Supports different density modes with appropriate styling.
 */
@Component({
  selector: 'app-translation-item-locales',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, HighlightPipe, TranslocoPipe],
  templateUrl: './item-locales.html',
  styleUrl: './item-locales.scss',
  host: {
    class: 'translation-item-locales',
  },
})
export class TranslationItemLocales {
  /** Array of locale translations to display */
  localeTranslations = input.required<LocaleTranslation[]>();

  /**
   * The source row, rendered first and in the same grid as the locales. Absent in
   * a collection with no base locale, where there is nothing to compare against.
   */
  baseRow = input<BaseTranslation | undefined>(undefined);

  /** Density mode affects styling */
  densityMode = input<DensityMode>('full');

  /** Expansion state for full mode */
  isExpanded = input<boolean>(false);

  /** Search query for highlighting */
  searchQuery = input<string>('');

  readonly TOKENS = TRACKER_TOKENS;

  /** Locale rows per status, over the rows actually rendered. */
  private readonly statusCounts = computed<StatusCounts>(() => {
    const counts: StatusCounts = { new: 0, stale: 0, translated: 0, verified: 0 };
    for (const lt of this.localeTranslations()) {
      const status = asTranslationStatus(lt.status);
      if (status) counts[status]++;
    }
    return counts;
  });

  /** Localized "{n} translated" for the rendered rows. */
  private readonly breakdown = injectStatusBreakdown(this.statusCounts);

  /**
   * The status every rendered row shares, if they share one.
   *
   * Eleven locales in the same state drew eleven identical chips, which is a
   * pattern with nothing to find in it. One chip carrying the count says the same
   * thing once. Two or more rows are needed before collapsing wins anything, and
   * a row with no status is not a match — so a mixed card keeps its per-row chips,
   * which is the case where the column is worth reading.
   */
  readonly uniformStatus = computed<TranslationStatus | undefined>(() => {
    const rows = this.localeTranslations();
    if (rows.length < 2) return undefined;

    const first = asTranslationStatus(rows[0].status);
    if (!first) return undefined;

    return rows.every((lt) => lt.status === first) ? first : undefined;
  });

  /** The collapsed chip: the shared status, labelled with its count. */
  readonly uniformSummary = computed(() => {
    const status = this.uniformStatus();
    return status ? { status, label: this.breakdown() } : undefined;
  });

  getStatusIcon(status: string | undefined): string {
    return statusIconFor(status);
  }

  getStatusLabel(status: string | undefined): string {
    return statusLabelTokenFor(status);
  }
}
