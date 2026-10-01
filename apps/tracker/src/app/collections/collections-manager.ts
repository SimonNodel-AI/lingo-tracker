import type { ComponentType } from '@angular/cdk/portal';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import type { BundleDefinitionDto } from '@simoncodes-ca/data-transfer';
import type { Observable } from 'rxjs';
import { TRACKER_TOKENS } from '../../i18n-types/tracker-resources';
import { apiErrorMessage } from '../shared/api-error/api-error';
import { injectConfirm } from '../shared/confirm';
import { NotificationService } from '../shared/notification';
import { BundleCard } from './bundle-card/bundle-card';
import type { BundleFormDialogData } from './bundle-form-dialog/bundle-form-dialog-data';
import type { CollectionFormDialogData } from './collection-form-dialog/collection-form-dialog-data';
import { type BundleLink, type BundlePort, collectionLinks, type LinkRect } from './collection-links';
import { CollectionsStore } from './store/collections.store';
import type { BundleEntry } from './store/features/with-bundles.feature';

/**
 * Total locale chips a card shows, overflow chip included. Capped so every card keeps a
 * single chip row and rows of cards stay flush with each other.
 */
const MAX_LOCALE_CHIPS = 4;

/** Below this many collections the name filter is more clutter than help. */
const FILTER_THRESHOLD = 6;

const loadBundleDialog = () =>
  import('./bundle-form-dialog/bundle-form-dialog').then((module) => module.BundleFormDialog);
const loadCollectionDialog = () =>
  import('./collection-form-dialog/collection-form-dialog').then((module) => module.CollectionFormDialog);

/** A collection prepared for display: chips resolved, overflow already split off. */
export interface CollectionCardView {
  readonly name: string;
  readonly translationsFolder: string;
  readonly readOnly: boolean;
  readonly baseLocale: string | undefined;
  readonly visibleLocales: readonly string[];
  readonly overflowLocales: readonly string[];
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
 * - Success/error notifications via snackbar, after the server has answered: the form dialogs
 *   write through the store themselves and close only on success, so a result from one is a
 *   write that happened; a delete is a Config Write whose outcome the manager awaits itself
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
  readonly #confirm = injectConfirm();
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
   * Measures the visible cards for the connector calculation. Each consumed collection
   * connects to one port on the hovered bundle. When the columns stack, the `.linked`
   * tint carries the relation on its own.
   */
  #measureLinks(): void {
    const hovered = this.hoveredBundle();
    if (hovered === null) {
      this.#clearLinks();
      return;
    }
    const split = this.#host.nativeElement.querySelector('.split');
    const column = split?.querySelector('.bundles-col');
    const target = Array.from(split?.querySelectorAll('[data-bundle]') ?? []).find(
      (element) => element.getAttribute('data-bundle') === hovered,
    );

    if (!split || !column || !target) {
      this.#clearLinks();
      return;
    }

    const linked = this.linkedCollections();
    const collectionElements = new Map<string, Element>();
    for (const element of Array.from(split.querySelectorAll('[data-collection]'))) {
      const name = element.getAttribute('data-collection');
      if (name !== null && linked.has(name) && !collectionElements.has(name)) collectionElements.set(name, element);
    }
    const collections: { name: string; rect: LinkRect }[] = [];
    for (const card of this.cards()) {
      if (!linked.has(card.name)) continue;
      const element = collectionElements.get(card.name);
      if (!element) continue;
      collections.push({ name: card.name, rect: this.#measureRect(element) });
    }
    const { links, port } = collectionLinks({
      container: this.#measureRect(split),
      bundlesColumn: this.#measureRect(column),
      collections,
      bundles: [{ name: hovered, rect: this.#measureRect(target), collectionNames: linked }],
      hoveredBundle: hovered,
    });
    this.bundleLinks.set(links);
    this.bundlePort.set(port);
  }

  #measureRect(element: Element): LinkRect {
    const { left, top, right, bottom, height } = element.getBoundingClientRect();
    return { left, top, right, bottom, height };
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
    locales: readonly string[];
    baseLocale: string;
  }): CollectionCardView {
    const locales = item.locales;
    const base = item.baseLocale;
    const ordered = locales.includes(base) ? [base, ...locales.filter((l) => l !== base)] : [...locales];

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
    const data: BundleFormDialogData = { mode: 'create' };
    this.#openSavedDialog(loadBundleDialog, data, 'bundle-form-dialog-panel', TRACKER_TOKENS.BUNDLES.TOAST.CREATED);
  }

  openEditBundleDialog(name: string): void {
    const bundle = this.store.config()?.bundles?.[name];
    if (!bundle) {
      this.#notifications.error(this.#transloco.translate(TRACKER_TOKENS.BUNDLES.TOAST.ERROR));
      return;
    }

    const data: BundleFormDialogData = { mode: 'edit', name, bundle };
    this.#openSavedDialog(loadBundleDialog, data, 'bundle-form-dialog-panel', TRACKER_TOKENS.BUNDLES.TOAST.UPDATED);
  }

  openDeleteBundleDialog(name: string): void {
    this.#confirmThenDelete({
      title: TRACKER_TOKENS.BUNDLES.DELETECONFIRMTITLE,
      message: () => this.#transloco.translate(TRACKER_TOKENS.BUNDLES.DELETECONFIRMMESSAGEX, { name }),
      success: TRACKER_TOKENS.BUNDLES.TOAST.DELETED,
      failure: TRACKER_TOKENS.BUNDLES.TOAST.DELETEFAILED,
      delete: () => this.store.deleteBundle(name),
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

  /** Opens the create form and toasts only when it closes with a saved result. */
  openCreateDialog(): void {
    const data: CollectionFormDialogData = { mode: 'create' };
    this.#openSavedDialog(
      loadCollectionDialog,
      data,
      'collection-form-dialog-panel',
      TRACKER_TOKENS.COLLECTIONS.TOAST.CREATED,
    );
  }

  /** Opens the edit form for an existing collection and toasts only after a save. */
  openEditDialog(name: string): void {
    const config = this.store.collections()[name];
    if (!config) {
      this.#notifications.error(this.#transloco.translate(TRACKER_TOKENS.COLLECTIONS.TOAST.ERROR));
      return;
    }
    const effectiveBaseLocale = this.store
      .collectionEntriesWithLocales()
      .find((item) => item.name === name)?.baseLocale;
    const data: CollectionFormDialogData = { mode: 'edit', name, config, effectiveBaseLocale };
    this.#openSavedDialog(
      loadCollectionDialog,
      data,
      'collection-form-dialog-panel',
      TRACKER_TOKENS.COLLECTIONS.TOAST.UPDATED,
    );
  }

  /** Lazily opens either form and toasts only after a saved result closes it. */
  #openSavedDialog<T, D>(
    load: () => Promise<ComponentType<T>>,
    data: D,
    panelClass: string,
    successToken: string,
  ): void {
    load()
      .then(
        (component) =>
          new Promise<unknown>((resolve) => {
            const ref = this.#dialog.open<T, D, unknown>(component, {
              data,
              panelClass,
              // Land on the first field, not the close button.
              autoFocus: 'input',
            });
            ref.afterClosed().subscribe((result) => resolve(result));
          }),
      )
      .then((result) => {
        if (result) this.#notifications.success(this.#transloco.translate(successToken));
      });
  }

  /** Opens a confirmation and toasts only after the delete Config Write resolves. */
  openDeleteDialog(name: string): void {
    this.#confirmThenDelete({
      title: TRACKER_TOKENS.COLLECTIONS.DIALOG.DELETE.TITLE,
      message: () => this.#transloco.translate(TRACKER_TOKENS.COLLECTIONS.DIALOG.DELETE.MESSAGE, { name }),
      success: TRACKER_TOKENS.COLLECTIONS.TOAST.DELETED,
      failure: TRACKER_TOKENS.COLLECTIONS.TOAST.DELETEFAILED,
      delete: () => this.store.deleteCollection(name),
    });
  }

  #confirmThenDelete(options: {
    title: string;
    message: () => string;
    success: string;
    failure: string;
    delete: () => Observable<unknown>;
  }): void {
    this.#confirm(
      {
        title: this.#transloco.translate(options.title),
        message: options.message(),
        confirmButtonText: this.#transloco.translate(TRACKER_TOKENS.COMMON.ACTIONS.DELETE),
        cancelButtonText: this.#transloco.translate(TRACKER_TOKENS.COMMON.ACTIONS.CANCEL),
        actionType: 'destructive',
      },
      { width: '400px' },
    ).then((confirmed) => {
      if (!confirmed) return;
      options.delete().subscribe({
        next: () => this.#notifications.success(this.#transloco.translate(options.success)),
        error: (error: unknown) =>
          this.#notifications.error(apiErrorMessage(error, this.#transloco.translate(options.failure))),
      });
    });
  }

  /**
   * Navigates to the translation browser for the given collection.
   */
  navigateToBrowser(collectionName: string): void {
    this.#router.navigate(['/browser', collectionName]);
  }
}
