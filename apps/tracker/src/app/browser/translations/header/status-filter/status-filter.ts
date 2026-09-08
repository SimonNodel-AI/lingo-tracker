import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslocoPipe } from '@jsverse/transloco';
import type { TranslationStatus } from '@simoncodes-ca/data-transfer';
import { BrowserStore } from '../../../store/browser.store';
import { TRACKER_TOKENS } from '../../../../../i18n-types/tracker-resources';

/** One toggle in the rail. `statuses` is what it selects, not what it is called. */
interface StatusToggle {
  readonly id: string;
  readonly label: string;
  readonly statuses: readonly TranslationStatus[];
  readonly count: number;
  readonly selected: boolean;
}

/**
 * StatusFilter renders the toolbar's status rail: one always-visible toggle per
 * status, plus a leading "Needs work" toggle that selects `new` and `stale`
 * together.
 *
 * It replaced a dropdown whose trigger reported its state as four 16px glyphs.
 * Status is how every user in this product decides what to touch next, so the
 * filter for it should not require a click to read — here the control *is* the
 * state, in the same chip vocabulary the rows below already use for status.
 *
 * Each toggle carries the number of resources it would leave on screen, which is
 * the question a user is actually asking before they click it.
 *
 * @example
 * <app-status-filter />
 */
@Component({
  selector: 'app-status-filter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatTooltipModule, TranslocoPipe],
  templateUrl: './status-filter.html',
  styleUrl: './status-filter.scss',
})
export class StatusFilter {
  readonly store = inject(BrowserStore);
  readonly TOKENS = TRACKER_TOKENS;

  readonly statuses: readonly TranslationStatus[] = ['new', 'stale', 'translated', 'verified'];

  /** Reads the shared status color spine, so a status means the same thing here as on the rows it filters. */
  readonly statusLabels: Record<TranslationStatus, string> = {
    new: TRACKER_TOKENS.BROWSER.STATUS.NEW,
    stale: TRACKER_TOKENS.BROWSER.STATUS.STALE,
    translated: TRACKER_TOKENS.BROWSER.STATUS.TRANSLATED,
    verified: TRACKER_TOKENS.BROWSER.STATUS.VERIFIED,
  };

  /**
   * "Needs work" is selected only when it is exactly what is selected. A user who
   * ticked `new` alone has not asked for the shortcut, and lighting it up would
   * claim a filter that is not applied.
   */
  readonly isNeedsWorkSelected = computed(() => {
    const selected = this.store.selectedStatuses();
    return selected.length === 2 && selected.includes('new') && selected.includes('stale');
  });

  readonly toggles = computed<readonly StatusToggle[]>(() => {
    const counts = this.store.statusCounts();
    const selected = this.store.selectedStatuses();

    return [
      {
        id: 'needsWork',
        label: TRACKER_TOKENS.BROWSER.STATUSFILTER.NEEDSWORK,
        statuses: ['new', 'stale'] as const,
        count: this.store.needsWorkCount(),
        selected: this.isNeedsWorkSelected(),
      },
      ...this.statuses.map((status) => ({
        id: status,
        label: this.statusLabels[status],
        statuses: [status] as const,
        count: counts[status],
        selected: selected.includes(status),
      })),
    ];
  });

  /**
   * A toggle turns its own statuses on or off. "Needs work" is an exact set
   * rather than an accumulation: pressing it means "show me the work", and
   * pressing it again clears back to everything.
   */
  toggle(item: StatusToggle): void {
    if (item.id === 'needsWork') {
      if (item.selected) this.store.clearAllStatuses();
      else this.store.selectNeedsWorkStatuses();
      return;
    }

    this.store.toggleStatus(item.statuses[0]);
  }
}
