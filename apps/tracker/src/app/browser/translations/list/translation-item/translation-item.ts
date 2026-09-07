import { Component, ChangeDetectionStrategy, input, output, computed, effect, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { CdkDrag, CdkDragPlaceholder } from '@angular/cdk/drag-drop';
import type { ResourceSummaryDto } from '@simoncodes-ca/data-transfer';
import { BrowserStore } from '../../../store/browser.store';
import { TranslocoPipe } from '@jsverse/transloco';
import { TRACKER_TOKENS } from '../../../../../i18n-types/tracker-resources';
import { TranslationItemHeader } from './item-header';
import { TranslationItemLocales, statusIconFor, statusLabelTokenFor } from './item-locales';
import { HighlightPipe } from '../../../../shared/pipes/highlight.pipe';
import type { DragData } from '../../../types/drag-data';
import { TranslationListStore } from '../store/translation-list.store';
import { injectStatusBreakdown } from '../../../../shared/i18n/status-breakdown';

const EXPAND_THRESHOLD = 200;

/**
 * Number of locale rows rendered while a full-density item is collapsed.
 * Kept in sync with the virtual-scroll itemSize estimate in translation-list.ts.
 */
const MAX_VISIBLE_LOCALE_ROWS = 4;
const LONG_PRESS_THRESHOLD = 500;

const STATUS_SORT_PRIORITY: Record<string, number> = {
  stale: 0,
  new: 1,
  translated: 2,
  verified: 3,
  missing: 4,
};

/**
 * Displays a single translation entry with key, base value, locale translations,
 * and action menu.
 */
@Component({
  selector: 'app-translation-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    TranslationItemHeader,
    TranslationItemLocales,
    HighlightPipe,
    CdkDrag,
    CdkDragPlaceholder,
    TranslocoPipe,
  ],
  templateUrl: './translation-item.html',
  styleUrl: './translation-item.scss',
  host: {
    class: 'translation-item',
  },
})
export class TranslationItem {
  /** Translation data */
  translation = input.required<ResourceSummaryDto>();

  /** Whether auto-translation is enabled for this collection */
  translationEnabled = input<boolean>(false);

  /** Emitted when the item's expansion state changes (key + expanded). */
  readonly expansionChanged = output<{ key: string; expanded: boolean }>();

  /** Emitted when drag starts on this item */
  dragStarted = output<DragData>();

  /** Emitted when drag ends on this item */
  dragEnded = output<void>();

  readonly #store = inject(BrowserStore);
  readonly #listStore = inject(TranslationListStore);
  readonly TOKENS = TRACKER_TOKENS;

  /** Active collection name — always set when this component is rendered. */
  readonly #collectionName = computed(() => this.#store.selectedCollection() ?? '');

  /** Whether this item was recently updated (flash highlight). */
  readonly isRecentlyUpdated = computed(() => this.#listStore.isRecentlyUpdated(this.translation().key));

  /** Current search query from the store */
  readonly searchQuery = this.#store.searchQuery;

  // Timestamp when touch started (ms since epoch)
  #touchStartTs = 0;

  /** Signal used to show visual feedback during touch (long-press) */
  readonly isTouchPressed = signal(false);

  /**
   * Full translation key (combines folder path with entry key if needed).
   * For search results, the key already contains the full path.
   * For folder browsing, we prepend the current folder path.
   */
  readonly fullKey = computed(() => {
    const path = this.#store.isSearchMode() ? '' : this.#store.currentFolderPath();
    const key = this.translation().key;
    return path ? `${path}.${key}` : key;
  });

  /** Base locale value (English/source) */
  readonly baseValue = computed(() => {
    const base = this.#store.baseLocale();
    return this.translation().translations[base] || '';
  });

  /** Locale translations excluding base locale, sorted by status priority then locale code */
  readonly localeTranslations = computed(() => {
    const trans = this.translation();
    const base = this.#store.baseLocale();
    const activeLocales = this.#store.filteredLocales();

    return activeLocales
      .filter((locale) => locale !== base)
      .map((locale) => ({
        locale,
        value: trans.translations[locale] || '',
        status: trans.status ? trans.status[locale] : undefined,
      }))
      .sort((a, b) => {
        const priorityA = a.status ? (STATUS_SORT_PRIORITY[a.status] ?? 4) : 4;
        const priorityB = b.status ? (STATUS_SORT_PRIORITY[b.status] ?? 4) : 4;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return a.locale.localeCompare(b.locale);
      });
  });

  /** Current density mode (reads from BrowserStore) */
  readonly currentDensityMode = computed(() => this.#store.densityMode());

  /**
   * The locale whose value the compact row displays, together with the status
   * and value that belong to it.
   *
   * Compact density has room for exactly one value, so the row must say which
   * locale that value belongs to — otherwise "empty" and "translated" look the
   * same, and a row showing the base locale source reads as a finished
   * translation. `isBaseFallback` marks the case where no non-base locale is
   * available and the row is therefore showing source text.
   */
  readonly compactDisplay = computed(() => {
    const base = this.#store.baseLocale();
    const nonBaseLocales = this.#store.filteredLocales().filter((locale) => locale !== base);

    const locale = nonBaseLocales.length > 0 ? nonBaseLocales[0] : base;
    const translation = this.translation();

    return {
      locale,
      value: translation.translations[locale] || '',
      status: translation.status?.[locale],
      isBaseFallback: nonBaseLocales.length === 0,
    };
  });

  /** Material icon for the compact row's status. */
  readonly compactStatusIcon = computed(() => statusIconFor(this.compactDisplay().status));

  /** Transloco token for the compact row's status label ('' when the status is unknown). */
  readonly compactStatusToken = computed(() => statusLabelTokenFor(this.compactDisplay().status));

  /** Value rendered in the compact row. */
  readonly primaryLocaleValue = computed(() => this.compactDisplay().value);

  /** Signal controlling whether the full-mode content is expanded */
  readonly isExpanded = signal(false);

  /** Signal controlling whether the comment is shown instead of translation values */
  readonly showComment = signal(false);

  /**
   * Locale rows rendered in full density. While collapsed the list is sliced to
   * MAX_VISIBLE_LOCALE_ROWS; the rows left out are counted by hiddenLocaleCount
   * and named on the expand button, so nothing is ever hidden silently.
   */
  readonly visibleLocaleTranslations = computed(() => {
    const all = this.localeTranslations();
    return this.isExpanded() ? all : all.slice(0, MAX_VISIBLE_LOCALE_ROWS);
  });

  /** Number of locale rows withheld by the collapsed state. */
  readonly hiddenLocaleCount = computed(() =>
    this.isExpanded() ? 0 : Math.max(0, this.localeTranslations().length - MAX_VISIBLE_LOCALE_ROWS),
  );

  /** True when the base value or any active locale value is clipped by its line clamp. */
  readonly hasClippedValues = computed(() => {
    if ((this.baseValue() || '').length > EXPAND_THRESHOLD) return true;

    return this.localeTranslations().some((v) => (v.value || '').length > EXPAND_THRESHOLD);
  });

  /**
   * Whether the expand control is offered. It answers "is anything hidden?" —
   * either locale rows the collapsed list dropped, or values the line clamp cut.
   */
  readonly needsExpansion = computed(
    () => this.isExpanded() || this.hiddenLocaleCount() > 0 || this.hasClippedValues(),
  );

  /**
   * Token for the expand control's label. Resolved through the transloco pipe in
   * the template rather than TranslocoService, so the label re-renders when the
   * UI language changes.
   */
  readonly expandLabelToken = computed(() => {
    if (this.isExpanded()) return TRACKER_TOKENS.BROWSER.TRANSLATIONITEM.SHOWLESS;
    if (this.hiddenLocaleCount() > 0) return TRACKER_TOKENS.BROWSER.TRANSLATIONITEM.MORELOCALESX;
    return TRACKER_TOKENS.BROWSER.TRANSLATIONITEM.SHOWMORE;
  });

  /** Interpolation params for expandLabelToken. */
  readonly expandLabelParams = computed(() => ({ count: this.hiddenLocaleCount() }));

  /** Toggles the expanded state for full density mode */
  toggleExpansion(): void {
    this.isExpanded.update((v) => !v);
    this.expansionChanged.emit({
      key: this.translation().key,
      expanded: this.isExpanded(),
    });
  }

  /** Toggles the comment display for compact and medium density modes */
  toggleComment(): void {
    this.showComment.update((v) => !v);
  }

  // Double-click handler ---------------------------------------------------
  /**
   * Opens the edit dialog when the item is double-clicked.
   * Ignores double-clicks originating from interactive elements (buttons, inputs,
   * anchors, selects) so that action-menu interactions are not accidentally
   * treated as edit requests.
   */
  onDoubleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const isInteractiveElement = Boolean(target.closest('button, input, textarea, select, a, [role="button"]'));

    if (isInteractiveElement) {
      return;
    }

    this.#listStore.editTranslation(this.translation(), this.#collectionName());
  }

  // Touch handlers ---------------------------------------------------------
  onTouchStart(_event?: TouchEvent): void {
    this.#touchStartTs = Date.now();
    this.isTouchPressed.set(true);
  }

  onTouchEnd(_event?: TouchEvent): void {
    const duration = Date.now() - this.#touchStartTs;
    this.#touchStartTs = 0;
    this.isTouchPressed.set(false);

    // Long press -> open edit
    if (duration > LONG_PRESS_THRESHOLD) {
      this.#listStore.editTranslation(this.translation(), this.#collectionName());
    }
  }

  // Keyboard shortcuts when the item has focus -----------------------------
  onKeyDown(event: KeyboardEvent): void {
    // Ignore with modifiers to avoid interfering with browser shortcuts
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;

    const key = (event.key || '').toLowerCase();

    let action: (() => void) | undefined;

    switch (key) {
      case 'e':
        action = () => this.#listStore.editTranslation(this.translation(), this.#collectionName());
        break;

      case 'delete':
      case 'del':
        action = () => this.#listStore.deleteTranslation(this.translation(), this.#collectionName());
        break;
    }

    if (action) {
      event.preventDefault();
      event.stopPropagation();
      action();
    }
  }

  /**
   * Computes counts of each status and total known statuses.
   * Used by rollupStatus and statusBreakdown to avoid duplicated logic.
   */
  readonly #statusCounts = computed(() => {
    const statusMap = this.translation().status || {};

    const counts: Record<'stale' | 'new' | 'translated' | 'verified', number> = {
      stale: 0,
      new: 0,
      translated: 0,
      verified: 0,
    };

    const total = Object.values(statusMap).reduce((acc, s) => {
      if (!s) return acc;
      if (s in counts) {
        counts[s as keyof typeof counts] += 1;
        return acc + 1;
      }
      return acc;
    }, 0);

    return { counts, total } as const;
  });

  constructor() {
    effect(() => {
      this.currentDensityMode(); // track density changes
      this.isTouchPressed.set(false);
    });
  }

  /** Returns a stable id for the rollup status element. */
  readonly statusId = computed(() => `rollup-${this.translation().key}`);

  /** Returns true if this translation has tags or a comment. */
  readonly hasMetadata = computed(() => {
    const t = this.translation();
    return Boolean((t.tags && t.tags.length > 0) || t.comment);
  });

  /** Returns first 3 tags for preview display in medium density mode. */
  readonly previewTags = computed(() => {
    const tags = this.translation().tags;
    return tags?.slice(0, 3) ?? [];
  });

  /**
   * Drag data for this translation item.
   * Contains resource key, folder path, and type identifier.
   */
  readonly dragData = computed<DragData>(() => ({
    type: 'resource',
    key: this.fullKey(),
    folderPath: this.#store.isSearchMode() ? '' : this.#store.currentFolderPath(),
  }));

  /**
   * Whether dragging is disabled for this item.
   * Disabled during search mode, when the store is busy, or when the collection is read-only.
   */
  readonly isDragDisabled = computed(() => {
    return Boolean(this.searchQuery()) || this.#store.effectiveDisabled();
  });

  /**
   * Localized breakdown of statuses across all locales, announced to screen
   * readers. Example: "2 stale, 3 verified, 1 new".
   */
  readonly statusBreakdown = injectStatusBreakdown(computed(() => this.#statusCounts().counts));

  /**
   * Roll-up status across ALL locales. Priority (worst first): stale > new > translated > verified
   * Returns tuple: [status, count]
   */
  readonly rollupStatus = computed(() => {
    const { counts, total } = this.#statusCounts();

    if (total === 0) return ['new', 0] as const;

    const priority: Array<keyof typeof counts> = ['stale', 'new', 'translated', 'verified'];

    for (const p of priority) {
      const c = counts[p];
      if (c > 0) return [p, c] as const;
    }

    return ['new', 0] as const;
  });

  /**
   * Handles drag started event.
   * Emits drag data to parent components for tracking.
   */
  onDragStarted(): void {
    this.dragStarted.emit(this.dragData());
  }

  /**
   * Handles drag ended event.
   * Notifies parent components that drag has ended.
   */
  onDragEnded(): void {
    this.dragEnded.emit();
  }
}
