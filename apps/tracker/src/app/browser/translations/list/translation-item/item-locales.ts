import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { HighlightPipe } from '../../../../shared/pipes/highlight.pipe';
import { TranslocoPipe } from '@jsverse/transloco';
import { TRACKER_TOKENS } from '../../../../../i18n-types/tracker-resources';
import type { DensityMode } from '../../../types/density-mode';

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

  getStatusIcon(status: string | undefined): string {
    return statusIconFor(status);
  }

  getStatusLabel(status: string | undefined): string {
    return statusLabelTokenFor(status);
  }
}
