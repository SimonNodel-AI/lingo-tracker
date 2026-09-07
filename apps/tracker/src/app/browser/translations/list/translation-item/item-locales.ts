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

  /** Density mode affects styling */
  densityMode = input<DensityMode>('full');

  /** Expansion state for full mode */
  isExpanded = input<boolean>(false);

  /** Search query for highlighting */
  searchQuery = input<string>('');

  getStatusIcon(status: string | undefined): string {
    return statusIconFor(status);
  }

  getStatusLabel(status: string | undefined): string {
    return statusLabelTokenFor(status);
  }
}
