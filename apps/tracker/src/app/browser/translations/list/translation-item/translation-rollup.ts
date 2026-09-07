import {
  Component,
  ChangeDetectionStrategy,
  input,
  signal,
  computed,
  inject,
  viewChild,
  type ElementRef,
  type OnDestroy,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Overlay, OverlayModule, type OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal, PortalModule } from '@angular/cdk/portal';
import { ViewContainerRef, type TemplateRef } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { TranslationStatus } from '@simoncodes-ca/data-transfer';
import { TRACKER_TOKENS } from '../../../../../i18n-types/tracker-resources';
import { injectActiveLang, injectStatusBreakdown } from '../../../../shared/i18n/status-breakdown';

/** Locale state for rollup display */
export interface LocaleState {
  code: string;
  status: TranslationStatus;
}

/** Per-status display configuration. Color lives in CSS so both themes can move it. */
interface StatusConfig {
  labelToken: string;
  icon: string;
}

/** Close delay in ms */
const CLOSE_DELAY = 120;

/**
 * Displays a visual rollup of translation statuses across locales.
 * Shows a segmented ring with status colors and a tooltip with details.
 */
@Component({
  selector: 'app-translation-rollup',
  standalone: true,
  imports: [CommonModule, OverlayModule, PortalModule, MatIconModule, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- A real button, not a div with role="button": it is focusable, it toggles,
         and it must announce and behave like the control it looks like. -->
    <button
      #trigger
      class="rollup"
      type="button"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-expanded]="isOpen()"
      (mouseenter)="open()"
      (mouseleave)="closeSoon()"
      (focus)="open()"
      (blur)="close()"
      (click)="toggle()"
      (keydown)="onKeydown($event)"
    >
      <!-- Segmented ring (SVG) -->
      <svg class="ring" viewBox="0 0 40 40" aria-hidden="true">
        <!-- base track -->
        <circle class="track" cx="20" cy="20" [attr.r]="radius" />

        <!-- segments (drawn in deterministic order) -->
        @for (seg of ringSegments(); track seg.status) {
        <circle
          class="seg"
          [ngClass]="'seg--' + seg.status"
          cx="20"
          cy="20"
          [attr.r]="radius"
          [attr.stroke-dasharray]="seg.dashArray"
          [attr.stroke-dashoffset]="seg.dashOffset"
        />
        }
      </svg>

      <!-- Center icon -->
      <div
        class="center"
        [class.center--issue]="hasIssues()"
        [class.center--ok]="!hasIssues()"
      >
        <mat-icon
          class="center-icon"
          [class.icon--issue]="hasIssues()"
          [class.icon--verified]="!hasIssues() && isAllVerified()"
          [class.icon--translated]="!hasIssues() && !isAllVerified()"
          aria-hidden="true"
        >
          {{ centerIcon() }}
        </mat-icon>
      </div>
    </button>

    <!-- Tooltip overlay content -->
    <ng-template #tooltipTpl>
      <div
        class="tooltip"
        role="tooltip"
        (mouseenter)="cancelClose()"
        (mouseleave)="closeSoon()"
      >
        <div class="grid">
          @for (row of tooltipLocaleRows(); track row.code) {
          <div class="row">
            <mat-icon
              class="row-icon"
              [ngClass]="'row-icon--' + row.status"
              aria-hidden="true"
              >{{ row.icon }}</mat-icon
            >
            <span class="label">{{ row.labelToken | transloco }}</span>
            <span class="locale-code">{{ row.code }}</span>
          </div>
          }
        </div>
      </div>
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }

      .rollup {
        width: 40px;
        height: 40px;
        position: relative;
        display: grid;
        place-items: center;
        padding: 0;
        border: none;
        border-radius: var(--border-radius-lg);
        background: none;
        color: inherit;
        font: inherit;
        outline: none;
        cursor: pointer;
        user-select: none;
      }

      .rollup:focus-visible {
        box-shadow: 0 0 0 3px
          color-mix(in srgb, var(--focus-ring-color) 35%, transparent);
        border-radius: var(--border-radius-lg);
      }

      .ring {
        width: 40px;
        height: 40px;
        display: block;
      }

      .track {
        fill: none;
        stroke: var(--color-border);
        stroke-width: 6;
      }

      .seg {
        fill: none;
        stroke-width: 6;
        stroke-linecap: butt;
        transform: rotate(-90deg);
        transform-origin: 20px 20px;
      }

      .center {
        position: absolute;
        width: 22px;
        height: 22px;
        border-radius: var(--border-radius-full);
        display: grid;
        place-items: center;
        background: var(--color-background);
        box-shadow: var(--shadow-sm);
      }

      .center--issue {
        border: 2px solid
          color-mix(in srgb, var(--color-status-stale) 45%, transparent);
      }

      .center-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        line-height: 16px;
      }

      .icon--issue {
        color: var(--color-status-stale);
      }

      .icon--translated {
        color: var(--color-status-translated);
      }

      .icon--verified {
        color: var(--color-status-verified);
      }

      /* One source of truth per status, shared by the ring and the tooltip rows. */
      .seg--new {
        stroke: var(--color-status-new);
      }

      .seg--stale {
        stroke: var(--color-status-stale);
      }

      .seg--translated {
        stroke: var(--color-status-translated);
      }

      .seg--verified {
        stroke: var(--color-status-verified);
      }

      .row-icon--new {
        color: var(--color-status-new);
      }

      .row-icon--stale {
        color: var(--color-status-stale);
      }

      .row-icon--translated {
        color: var(--color-status-translated);
      }

      .row-icon--verified {
        color: var(--color-status-verified);
      }

      /* Tooltip panel - always dark for contrast in both themes */
      .tooltip {
        /* This surface is dark under either theme, so the status hues here always
           take their dark-surface values — the light-theme set is tuned for a
           parchment card and would sink into this panel. */
        --color-status-new: var(--status-new-on-dark);
        --color-status-stale: var(--status-stale-on-dark);
        --color-status-translated: var(--status-translated-on-dark);
        --color-status-verified: var(--status-verified-on-dark);

        min-width: 200px;
        max-width: 360px;
        padding: var(--spacing-3);
        border-radius: var(--border-radius-xl);
        background: var(--color-tooltip-surface);
        color: var(--color-tooltip-text);
        box-shadow: var(--shadow-lg);
        border: 1px solid var(--color-border-strong);
      }

      .grid {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2);
      }

      .row {
        display: flex;
        align-items: center;
        gap: var(--spacing-2);
        font-size: var(--font-size-xs);
        line-height: 1.33;
      }

      .row-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        line-height: 16px;
        flex-shrink: 0;
      }

      .label {
        flex-shrink: 0;
      }

      .locale-code {
        margin-left: auto;
        opacity: 0.85;
        font-weight: var(--font-weight-medium);
      }
    `,
  ],
  host: {
    class: 'translation-rollup',
  },
})
export class TranslationRollup implements OnDestroy {
  /** Locale states to display */
  locales = input.required<LocaleState[]>();

  /** Base locale code (excluded from display) */
  baseLocale = input<string>('en');

  private readonly overlay = inject(Overlay);
  private readonly vcr = inject(ViewContainerRef);
  private readonly transloco = inject(TranslocoService);
  private readonly activeLang = injectActiveLang();

  readonly trigger = viewChild.required<ElementRef<HTMLElement>>('trigger');
  readonly tooltipTpl = viewChild.required<TemplateRef<unknown>>('tooltipTpl');

  private overlayRef?: OverlayRef;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  /** SVG ring geometry */
  readonly radius = 14;
  private get circumference(): number {
    return 2 * Math.PI * this.radius;
  }

  /** Status configuration */
  private readonly statusConfig: Record<TranslationStatus, StatusConfig> = {
    new: {
      labelToken: TRACKER_TOKENS.BROWSER.STATUS.NEW,
      icon: 'add_circle',
    },
    stale: {
      labelToken: TRACKER_TOKENS.BROWSER.STATUS.STALE,
      icon: 'warning',
    },
    translated: {
      labelToken: TRACKER_TOKENS.BROWSER.STATUS.TRANSLATED,
      icon: 'language',
    },
    verified: {
      labelToken: TRACKER_TOKENS.BROWSER.STATUS.VERIFIED,
      icon: 'check_circle',
    },
  };

  ngOnDestroy(): void {
    this.close();
  }

  /** Effective locales (excluding base locale) */
  private readonly effectiveLocales = computed(() => {
    const base = this.baseLocale().toLowerCase();
    return (this.locales() ?? []).filter((l) => (l?.code ?? '').toLowerCase() !== base);
  });

  /** Get locale codes by status */
  private codesBy(status: TranslationStatus): string[] {
    return this.effectiveLocales()
      .filter((l) => l.status === status)
      .map((l) => l.code)
      .sort((a, b) => a.localeCompare(b));
  }

  /** Status counts */
  readonly counts = computed(() => ({
    new: this.codesBy('new').length,
    stale: this.codesBy('stale').length,
    translated: this.codesBy('translated').length,
    verified: this.codesBy('verified').length,
  }));

  /** Total non-base locales */
  readonly total = computed(() => this.effectiveLocales().length);

  /** Count of translated + verified */
  private readonly translatedLike = computed(() => this.counts().translated + this.counts().verified);

  /** Whether there are issues (new or stale) */
  readonly hasIssues = computed(() => this.counts().new > 0 || this.counts().stale > 0);

  /** Whether all locales are verified */
  readonly isAllVerified = computed(() => this.total() > 0 && this.counts().verified === this.total());

  /** Whether all locales are translated (but not all verified) */
  readonly isAllTranslated = computed(
    () => this.total() > 0 && this.translatedLike() === this.total() && !this.isAllVerified(),
  );

  /** Center icon based on state */
  readonly centerIcon = computed(() => {
    if (this.hasIssues()) return 'priority_high';
    if (this.isAllVerified()) return 'check';
    return 'language';
  });

  /** Localized status breakdown, e.g. "2 stale, 1 new". */
  readonly breakdown = injectStatusBreakdown(this.counts);

  /**
   * Accessible name. Reads the breakdown rather than a "x of y" summary, because
   * the ring already carries the proportion and the counts are what a listener
   * cannot see. Depends on the active language so it survives a language switch.
   */
  readonly ariaLabel = computed(() => {
    const breakdown = this.breakdown();
    this.activeLang();

    if (this.total() === 0) return breakdown;

    return this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONITEM.ROLLUPARIALABELX, {
      breakdown,
    });
  });

  /** Ring segments for SVG */
  readonly ringSegments = computed(() => {
    const t = this.total() || 1;
    const c = this.counts();
    const circ = this.circumference;

    const order: TranslationStatus[] = ['verified', 'translated', 'stale', 'new'];

    let acc = 0;
    return order
      .map((st) => {
        const count = c[st] || 0;
        const frac = count / t;
        const len = frac * circ;
        const gap = circ - len;
        const seg = {
          status: st,
          dashArray: `${len} ${gap}`,
          dashOffset: -acc,
        };
        acc += len;
        return seg;
      })
      .filter((s) => {
        if (this.total() === 0) return false;
        const len = parseFloat(s.dashArray.split(' ')[0]);
        return len > 0.5;
      });
  });

  /** Tooltip rows - one row per locale, sorted by severity then locale code */
  readonly tooltipLocaleRows = computed(() => {
    const order: TranslationStatus[] = ['new', 'stale', 'translated', 'verified'];
    const orderIndex = (s: TranslationStatus) => order.indexOf(s);

    return this.effectiveLocales()
      .map((l) => ({
        code: l.code,
        status: l.status,
        labelToken: this.statusConfig[l.status].labelToken,
        icon: this.statusConfig[l.status].icon,
      }))
      .sort((a, b) => {
        const orderDiff = orderIndex(a.status) - orderIndex(b.status);
        if (orderDiff !== 0) return orderDiff;
        return a.code.localeCompare(b.code);
      });
  });

  /** Whether overlay is open */
  readonly isOpen = signal(false);

  /** Open the tooltip */
  open(): void {
    this.cancelClose();
    if (this.isOpen()) return;

    if (!this.overlayRef) {
      const positionStrategy = this.overlay
        .position()
        .flexibleConnectedTo(this.trigger())
        .withFlexibleDimensions(false)
        .withPush(true)
        .withPositions([
          {
            originX: 'start',
            originY: 'bottom',
            overlayX: 'start',
            overlayY: 'top',
            offsetY: 8,
          },
          {
            originX: 'start',
            originY: 'top',
            overlayX: 'start',
            overlayY: 'bottom',
            offsetY: -8,
          },
          {
            originX: 'end',
            originY: 'bottom',
            overlayX: 'end',
            overlayY: 'top',
            offsetY: 8,
          },
        ]);

      this.overlayRef = this.overlay.create({
        positionStrategy,
        scrollStrategy: this.overlay.scrollStrategies.reposition(),
        hasBackdrop: false,
        panelClass: 'translation-rollup-overlay',
      });
    }

    const portal = new TemplatePortal(this.tooltipTpl(), this.vcr);
    this.overlayRef.attach(portal);
    this.isOpen.set(true);
  }

  /** Close the tooltip immediately */
  close(): void {
    this.cancelClose();
    this.overlayRef?.detach();
    this.isOpen.set(false);
  }

  /** Close the tooltip after a delay */
  closeSoon(): void {
    this.cancelClose();
    this.closeTimer = setTimeout(() => this.close(), CLOSE_DELAY);
  }

  /** Cancel pending close */
  cancelClose(): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  /** Toggle the tooltip. Enter and Space reach this through the button's click. */
  toggle(): void {
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }

  /** Escape closes; Enter and Space are handled natively by the button. */
  onKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.close();
    }
  }

  /** Close if user clicks outside */
  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(ev: MouseEvent): void {
    if (!this.isOpen()) return;

    const target = ev.target as Node | null;
    const triggerEl = this.trigger()?.nativeElement;
    const overlayEl = this.overlayRef?.overlayElement;

    if (target && triggerEl && overlayEl && !triggerEl.contains(target) && !overlayEl.contains(target)) {
      this.close();
    }
  }
}
