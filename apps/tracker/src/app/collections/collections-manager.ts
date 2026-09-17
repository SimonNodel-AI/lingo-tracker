import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import type { BundleDefinitionDto } from '@simoncodes-ca/data-transfer';
import { CollectionsStore } from './store/collections.store';
import type { BundleEntry } from './store/features/with-bundles.feature';
import { BundleCard } from './bundle-card/bundle-card';
import type { BundleFormDialogData, BundleFormResult } from './bundle-form-dialog/bundle-form-dialog-data';
import { TRACKER_TOKENS } from '../../i18n-types/tracker-resources';
import { NotificationService } from '../shared/notification';

/**
 * Total locale chips a card shows, overflow chip included. Capped so every card keeps a
 * single chip row and rows of cards stay flush with each other.
 */
const MAX_LOCALE_CHIPS = 4;

/** Below this many collections the name filter is more clutter than help. */
const FILTER_THRESHOLD = 6;

/** A collection prepared for display: chips resolved, overflow already split off. */
export interface CollectionCardView {
  readonly name: string;
  readonly translationsFolder: string;
  readonly readOnly: boolean;
  readonly baseLocale: string | undefined;
  readonly visibleLocales: readonly string[];
  readonly overflowLocales: readonly string[];
}

/**
 * Vertical offset of a bundle card's connector port, measured from the card's top edge:
 * `--spacing-4` of padding plus half the 38px identity tile. Lines therefore meet the
 * bundle at its name, not at an arbitrary middle.
 */
const BUNDLE_PORT_OFFSET = 35;

/** Keeps a port from being drawn against the rim of the scrolling bundles column. */
const PORT_EDGE_INSET = 10;

/** Subpixel coordinates make the strokes fuzzy; one decimal is plenty for a bezier. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * How far the plug and socket dots sit outside the card edge their line touches. Both
 * cards are opaque and paint above the connector layer, so a dot centred on the edge
 * would be sliced in half; this clears it.
 */
const NODE_STANDOFF = 5;

/** One drawn connection from a collection card's right edge to the hovered bundle's port. */
export interface BundleLink {
  readonly name: string;
  readonly path: string;
  /** Centre of the plug dot, already standing off the collection card's right edge. */
  readonly x: number;
  readonly y: number;
}

/** Where every line of the current hover converges, in `.split` coordinates. */
export interface BundlePort {
  /** Centre of the socket ring, already standing off the bundle card's left edge. */
  readonly x: number;
  readonly y: number;
}

/** A bundle prepared for its card: consumed collections resolved, locale count computed. */
export interface BundleCardView {
  readonly entry: BundleEntry;
  readonly collectionNames: readonly string[];
  readonly localeCount: number;
}

/**
 * Collections Manager component for viewing and managing translation collections.
 *
 * Features:
 * - Displays all collections in a responsive grid, sorted by name
 * - Filters by name or translations folder once the list grows past a handful
 * - Create, edit, and delete collections
 * - Navigate to translation browser for each collection
 * - Lists the project's bundles in a sticky side column; create, edit, delete and generate them
 * - Hovering a bundle draws connector lines to the collections it consumes
 * - Loading, empty, and no-matches states
 * - Success/error notifications via snackbar
 */
@Component({
  selector: 'app-collections-manager',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    TranslocoModule,
    BundleCard,
  ],
  templateUrl: './collections-manager.html',
  styleUrl: './collections-manager.scss',
  host: { role: 'main' },
})
export class CollectionsManager {
  readonly store = inject(CollectionsStore);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #destroyRef = inject(DestroyRef);
  readonly #dialog = inject(MatDialog);
  readonly #notifications = inject(NotificationService);
  readonly #router = inject(Router);
  readonly #transloco = inject(TranslocoService);

  readonly TOKENS = TRACKER_TOKENS;

  /** Current text typed into the name/folder filter. */
  readonly filter = signal('');

  /** Collections sorted by name and prepared for the card template. */
  readonly cards = computed<readonly CollectionCardView[]>(() => {
    const query = this.filter().trim().toLowerCase();

    return this.store
      .collectionEntriesWithLocales()
      .filter(
        (item) =>
          query.length === 0 ||
          item.name.toLowerCase().includes(query) ||
          item.config.translationsFolder.toLowerCase().includes(query),
      )
      .map((item) => this.#toCardView(item))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  });

  readonly showFilter = computed(() => this.store.collectionEntriesWithLocales().length > FILTER_THRESHOLD);
  readonly isFiltering = computed(() => this.filter().trim().length > 0);
  readonly hasNoMatches = computed(() => this.store.hasCollections() && this.cards().length === 0);

  /** Base locale of the project, shown in the page subtitle. */
  readonly baseLocale = computed(() => this.store.config()?.baseLocale);

  /** Name of the bundle currently hovered or focused, if any. */
  readonly hoveredBundle = signal<string | null>(null);

  /** Bundles prepared for the card template, in store (name) order. */
  readonly bundleCards = computed<readonly BundleCardView[]>(() => {
    const allCollections = this.store.collectionEntries().map((item) => item.name);
    const globalLocales = this.store.config()?.locales ?? [];

    return this.store.bundleEntries().map((entry) => ({
      entry,
      collectionNames: this.#resolveCollectionNames(entry.definition, allCollections),
      localeCount: globalLocales.length,
    }));
  });

  /** Collections consumed by the hovered bundle; empty when nothing is hovered. */
  readonly linkedCollections = computed<ReadonlySet<string>>(() => {
    const hovered = this.hoveredBundle();
    if (hovered === null) return new Set();
    const card = this.bundleCards().find((item) => item.entry.name === hovered);
    return new Set(card?.collectionNames ?? []);
  });

  /** Connector lines for the current hover; empty when nothing is hovered or the columns stacked. */
  readonly bundleLinks = signal<readonly BundleLink[]>([]);

  /** Convergence point of the current connector lines; null when none are drawn. */
  readonly bundlePort = signal<BundlePort | null>(null);

  /** Bundle names started by the last "Generate all" click; null until it is used. */
  readonly #generateAllBatch = signal<readonly string[] | null>(null);

  /** True while any bundle from the current "Generate all" batch is still running. */
  readonly isGeneratingAll = computed(() => {
    const batch = this.#generateAllBatch();
    if (!batch) return false;
    const runs = this.store.bundleRuns();
    return batch.some((name) => runs[name]?.status === 'running');
  });

  /** 1-based position shown on the busy "Generate all" button, e.g. "1 of 2…". */
  readonly generateAllPosition = computed(() => {
    const batch = this.#generateAllBatch() ?? [];
    const runs = this.store.bundleRuns();
    const finished = batch.filter((name) => {
      const status = runs[name]?.status;
      return status === 'completed' || status === 'failed';
    }).length;
    return Math.min(Math.max(batch.length, 1), finished + 1);
  });

  constructor() {
    // Re-measure whenever the hover changes or the cards behind it do. Measuring on the
    // next frame lets the grid settle first; the hovered bundle's 2px hover lift is still
    // in flight at that point, which is below the width of the line being drawn.
    effect((onCleanup) => {
      this.hoveredBundle();
      this.cards();
      this.bundleCards();
      // A run opening a progress or result strip changes the bundle card's height, which
      // moves the port the lines are currently pointing at.
      this.store.bundleRuns();
      const frame = requestAnimationFrame(() => this.#measureLinks());
      onCleanup(() => cancelAnimationFrame(frame));
    });

    // Anything that moves a card moves its line. Scroll is captured because the page's
    // scroll container is an ancestor and the bundles column scrolls independently.
    const remeasure = () => {
      if (this.hoveredBundle() !== null) this.#measureLinks();
    };
    window.addEventListener('scroll', remeasure, true);
    window.addEventListener('resize', remeasure);
    this.#destroyRef.onDestroy(() => {
      window.removeEventListener('scroll', remeasure, true);
      window.removeEventListener('resize', remeasure);
    });
  }

  /**
   * Draws the current hover as geometry: one line from each consumed collection card's right
   * edge into a single port on the bundle card, so several inputs visibly converge on one
   * output. Lines are only meaningful while the columns sit side by side; once the layout
   * stacks, the bundle is below its collections and the `.linked` tint carries the relation
   * on its own.
   */
  #measureLinks(): void {
    const hovered = this.hoveredBundle();
    const split = this.#host.nativeElement.querySelector('.split');
    const column = split?.querySelector('.bundles-col');
    const target = hovered === null ? null : split?.querySelector(`[data-bundle="${CSS.escape(hovered)}"]`);

    if (!split || !column || !target) {
      this.#clearLinks();
      return;
    }

    const origin = split.getBoundingClientRect();
    const columnBox = column.getBoundingClientRect();
    const bundleBox = target.getBoundingClientRect();

    // Stacked layout: the bundles column starts at the same left edge as the collections.
    if (columnBox.left - origin.left < 1) {
      this.#clearLinks();
      return;
    }

    const portX = round(bundleBox.left - origin.left);
    const portY = round(
      clamp(
        bundleBox.top - origin.top + BUNDLE_PORT_OFFSET,
        columnBox.top - origin.top + PORT_EDGE_INSET,
        columnBox.bottom - origin.top - PORT_EDGE_INSET,
      ),
    );

    const linked = this.linkedCollections();
    const links: BundleLink[] = [];

    for (const card of this.cards()) {
      if (!linked.has(card.name)) continue;

      const element = split.querySelector(`[data-collection="${CSS.escape(card.name)}"]`);
      if (!element) continue;

      const box = element.getBoundingClientRect();
      const x = round(box.right - origin.left);
      const y = round(box.top - origin.top + box.height / 2);
      // Horizontal control handles keep every line leaving a card and entering the port
      // dead flat, so the dots read as sockets rather than as places a curve happens to pass.
      // The half-span ceiling matters: the inner column is barely 40px from the port, and
      // an unbounded handle there sends the two control points past each other and kinks
      // the curve back on itself.
      const span = portX - x;
      const reach = Math.min(Math.max(span * 0.45, 20), span * 0.5);

      links.push({
        name: card.name,
        x: x + NODE_STANDOFF,
        y,
        path: `M ${x} ${y} C ${round(x + reach)} ${y}, ${round(portX - reach)} ${portY}, ${portX} ${portY}`,
      });
    }

    this.bundleLinks.set(links);
    this.bundlePort.set(links.length > 0 ? { x: portX - NODE_STANDOFF, y: portY } : null);
  }

  #clearLinks(): void {
    if (this.bundleLinks().length > 0) this.bundleLinks.set([]);
    if (this.bundlePort() !== null) this.bundlePort.set(null);
  }

  /**
   * Orders a collection's locales with the base locale first, then splits off the tail beyond
   * MAX_LOCALE_CHIPS so the chip row never wraps and cards in a row share a height.
   */
  #toCardView(item: {
    name: string;
    config: { translationsFolder: string; readOnly?: boolean };
    locales: string[] | undefined;
    baseLocale: string | undefined;
  }): CollectionCardView {
    const locales = item.locales ?? [];
    const base = item.baseLocale;
    const ordered = base && locales.includes(base) ? [base, ...locales.filter((l) => l !== base)] : [...locales];

    return {
      name: item.name,
      translationsFolder: item.config.translationsFolder,
      readOnly: item.config.readOnly === true,
      baseLocale: base,
      visibleLocales: ordered.length > MAX_LOCALE_CHIPS ? ordered.slice(0, MAX_LOCALE_CHIPS - 1) : ordered,
      overflowLocales: ordered.length > MAX_LOCALE_CHIPS ? ordered.slice(MAX_LOCALE_CHIPS - 1) : [],
    };
  }

  #resolveCollectionNames(definition: BundleDefinitionDto, allCollections: readonly string[]): readonly string[] {
    if (definition.collections === 'All') return allCollections;
    return definition.collections.map((collection) => collection.name);
  }

  clearFilter(): void {
    this.filter.set('');
  }

  isCollectionLinked(name: string): boolean {
    return this.linkedCollections().has(name);
  }

  onBundleHover(name: string, hovered: boolean): void {
    if (hovered) {
      this.hoveredBundle.set(name);
    } else if (this.hoveredBundle() === name) {
      this.hoveredBundle.set(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Bundles
  // ---------------------------------------------------------------------------

  openCreateBundleDialog(): void {
    this.#openBundleDialog({ mode: 'create' }).then((result) => {
      if (!result) return;
      this.store.createBundle({ name: result.name, bundle: result.bundle });
      this.#notifications.success(this.#transloco.translate(TRACKER_TOKENS.BUNDLES.TOAST.CREATED));
    });
  }

  openEditBundleDialog(name: string): void {
    const bundle = this.store.config()?.bundles?.[name];
    if (!bundle) {
      this.#notifications.error(this.#transloco.translate(TRACKER_TOKENS.BUNDLES.TOAST.ERROR));
      return;
    }

    this.#openBundleDialog({ mode: 'edit', name, bundle }).then((result) => {
      if (!result) return;
      this.store.updateBundle({
        oldName: name,
        newName: result.name !== name ? result.name : undefined,
        bundle: result.bundle,
      });
      this.#notifications.success(this.#transloco.translate(TRACKER_TOKENS.BUNDLES.TOAST.UPDATED));
    });
  }

  openDeleteBundleDialog(name: string): void {
    import('../shared/components/confirmation-dialog/confirmation-dialog').then((m) => {
      const dialogRef = this.#dialog.open(m.ConfirmationDialog, {
        data: {
          title: this.#transloco.translate(TRACKER_TOKENS.BUNDLES.DELETECONFIRMTITLE),
          message: this.#transloco.translate(TRACKER_TOKENS.BUNDLES.DELETECONFIRMMESSAGEX, { name }),
          confirmButtonText: this.#transloco.translate(TRACKER_TOKENS.COMMON.ACTIONS.DELETE),
          cancelButtonText: this.#transloco.translate(TRACKER_TOKENS.COMMON.ACTIONS.CANCEL),
          actionType: 'destructive',
        },
        width: '400px',
      });

      dialogRef.afterClosed().subscribe((confirmed) => {
        if (confirmed) {
          this.store.deleteBundle(name);
          this.#notifications.success(this.#transloco.translate(TRACKER_TOKENS.BUNDLES.TOAST.DELETED));
        }
      });
    });
  }

  generateBundle(name: string): void {
    this.store.generateBundle(name);
  }

  retryBundle(name: string): void {
    this.store.retryBundle(name);
  }

  /**
   * Starts a run for every bundle. The button is disabled while any generation
   * is in flight — including one started from a single bundle card — so this
   * guard and the button's presentation reject the same cases.
   */
  generateAllBundles(): void {
    if (this.store.isAnyBundleRunning()) return;
    this.#generateAllBatch.set(this.store.bundleEntries().map((entry) => entry.name));
    this.store.generateAllBundles();
  }

  /** Lazily loads the bundle form dialog and resolves with its result once closed. */
  #openBundleDialog(data: BundleFormDialogData): Promise<BundleFormResult | undefined> {
    return import('./bundle-form-dialog/bundle-form-dialog').then(
      (m) =>
        new Promise<BundleFormResult | undefined>((resolve) => {
          const dialogRef = this.#dialog.open(m.BundleFormDialog, {
            data,
            panelClass: 'bundle-form-dialog-panel',
            // Land on the first field, not the close button.
            autoFocus: 'input',
          });
          dialogRef.afterClosed().subscribe((result: BundleFormResult | undefined) => resolve(result));
        }),
    );
  }

  /**
   * Opens the create collection dialog.
   */
  openCreateDialog(): void {
    import('./collection-form-dialog/collection-form-dialog').then((m) => {
      const dialogRef = this.#dialog.open(m.CollectionFormDialog, {
        data: { mode: 'create' },
        panelClass: 'collection-form-dialog-panel',
        // Land on the first field, not the close button.
        autoFocus: 'input',
      });

      dialogRef.afterClosed().subscribe((result) => {
        if (result) {
          this.store.createCollection({
            name: result.name,
            collection: result.config,
          });
          this.#notifications.success(this.#transloco.translate(TRACKER_TOKENS.COLLECTIONS.TOAST.CREATED));
        }
      });
    });
  }

  /**
   * Opens the edit collection dialog.
   */
  openEditDialog(name: string): void {
    const config = this.store.collections()[name];
    if (!config) {
      this.#notifications.error(this.#transloco.translate(TRACKER_TOKENS.COLLECTIONS.TOAST.ERROR));
      return;
    }

    const effectiveBaseLocale = this.store
      .collectionEntriesWithLocales()
      .find((item) => item.name === name)?.baseLocale;

    import('./collection-form-dialog/collection-form-dialog').then((m) => {
      const dialogRef = this.#dialog.open(m.CollectionFormDialog, {
        data: {
          mode: 'edit',
          name,
          config,
          effectiveBaseLocale,
        },
        panelClass: 'collection-form-dialog-panel',
        // Land on the first field, not the close button.
        autoFocus: 'input',
      });

      dialogRef.afterClosed().subscribe((result) => {
        if (result) {
          this.store.updateCollection({
            oldName: name,
            newName: result.name !== name ? result.name : undefined,
            collection: result.config,
          });
          this.#notifications.success(this.#transloco.translate(TRACKER_TOKENS.COLLECTIONS.TOAST.UPDATED));
        }
      });
    });
  }

  /**
   * Opens the delete confirmation dialog.
   */
  openDeleteDialog(name: string): void {
    import('../shared/components/confirmation-dialog/confirmation-dialog').then((m) => {
      const dialogRef = this.#dialog.open(m.ConfirmationDialog, {
        data: {
          title: this.#transloco.translate(TRACKER_TOKENS.COLLECTIONS.DIALOG.DELETE.TITLE),
          message: this.#transloco.translate(TRACKER_TOKENS.COLLECTIONS.DIALOG.DELETE.MESSAGE, { name }),
          confirmButtonText: this.#transloco.translate(TRACKER_TOKENS.COMMON.ACTIONS.DELETE),
          cancelButtonText: this.#transloco.translate(TRACKER_TOKENS.COMMON.ACTIONS.CANCEL),
          actionType: 'destructive',
        },
        width: '400px',
      });

      dialogRef.afterClosed().subscribe((confirmed) => {
        if (confirmed) {
          this.store.deleteCollection(name);
          this.#notifications.success(this.#transloco.translate(TRACKER_TOKENS.COLLECTIONS.TOAST.DELETED));
        }
      });
    });
  }

  /**
   * Navigates to the translation browser for the given collection.
   */
  navigateToBrowser(collectionName: string): void {
    this.#router.navigate(['/browser', encodeURIComponent(collectionName)]);
  }
}
