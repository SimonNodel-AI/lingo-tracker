import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { createComponentFactory, type Spectator } from '@ngneat/spectator/vitest';
import type { BundleGenerateJobDto, LingoTrackerConfigDto } from '@simoncodes-ca/data-transfer';
import { of, throwError } from 'rxjs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTranslocoTestingModule } from '../../testing/transloco-testing.module';
import { toApiError } from '../shared/api-error/api-error';
import { NotificationService } from '../shared/notification';
import { CollectionsManager } from './collections-manager';
import { CollectionsApiService } from './services/collections-api.service';
import { CollectionsStore } from './store/collections.store';

const config: LingoTrackerConfigDto = {
  exportFolder: 'dist/export',
  importFolder: 'dist/import',
  baseLocale: 'en',
  locales: ['en', 'fr-ca'],
  collections: {
    zulu: { translationsFolder: 'sample/zulu', locales: ['en', 'fr-ca'] },
    alpha: {
      translationsFolder: 'sample/alpha',
      locales: ['fr-ca', 'es', 'en', 'de', 'ja', 'ru'],
    },
    Bravo: { translationsFolder: 'vendor/bravo', locales: ['de', 'ja'], baseLocale: 'de', readOnly: true },
  },
  projectName: 'lingo-tracker',
  bundles: {
    tracker: {
      bundleName: '{locale}',
      dist: './apps/tracker/src/assets/i18n',
      collections: [{ name: 'alpha', entriesSelectionRules: 'All' }],
    },
    main: { bundleName: '{locale}', dist: './dist/i18n', collections: 'All' },
  },
};

const api = {
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
  createBundle: vi.fn(),
  updateBundle: vi.fn(),
  deleteBundle: vi.fn(),
  generateBundle: vi.fn(),
  getBundleJob: vi.fn(),
};

const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const dialog = { open: vi.fn() };

/** What `MatDialog.open` answers: a dialog that closes with `result`. */
const closingWith = (result: unknown) => ({ afterClosed: () => of(result) });

const text = (fixture: ComponentFixture<CollectionsManager>): string =>
  (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ') ?? '';

describe('CollectionsManager', () => {
  let fixture: ComponentFixture<CollectionsManager>;
  let component: CollectionsManager;
  let spectator: Spectator<CollectionsManager>;
  let store: InstanceType<typeof CollectionsStore>;

  const createComponent = createComponentFactory({
    component: CollectionsManager,
    imports: [NoopAnimationsModule, getTranslocoTestingModule()],
    providers: [
      provideTranslocoMessageformat(),
      CollectionsStore,
      { provide: CollectionsApiService, useValue: api },
      { provide: NotificationService, useValue: notifications },
      { provide: Router, useValue: { navigate: vi.fn() } },
    ],
    // MatDialogModule in the component's imports provides its own MatDialog, so the mock must
    // sit in the component injector to be the one the manager gets.
    componentProviders: [{ provide: MatDialog, useValue: dialog }],
    detectChanges: false,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    // Runs are mirrored to session storage, which jsdom keeps between tests.
    sessionStorage.clear();
    api.getConfig.mockReturnValue(of(config));

    spectator = createComponent();
    fixture = spectator.fixture;
    component = spectator.component;
    store = spectator.inject(CollectionsStore);
    store.loadCollections();
    spectator.detectComponentChanges();
  });

  it('sorts collections by name, ignoring case', () => {
    expect(component.cards().map((c) => c.name)).toEqual(['alpha', 'Bravo', 'zulu']);
  });

  it('lists the base locale first, whether it comes from the collection or the global config', () => {
    const alpha = component.cards().find((c) => c.name === 'alpha');
    const bravo = component.cards().find((c) => c.name === 'Bravo');

    expect(alpha?.baseLocale).toBe('en');
    expect(alpha?.visibleLocales[0]).toBe('en');
    expect(bravo?.baseLocale).toBe('de');
    expect(bravo?.visibleLocales[0]).toBe('de');
  });

  it('caps locale chips at four, overflow chip included, so the chip row never wraps', () => {
    const alpha = component.cards().find((c) => c.name === 'alpha');

    expect(alpha?.visibleLocales).toEqual(['en', 'fr-ca', 'es']);
    expect(alpha?.overflowLocales).toEqual(['de', 'ja', 'ru']);
  });

  it('shows every locale when they all fit', () => {
    const zulu = component.cards().find((c) => c.name === 'zulu');

    expect(zulu?.visibleLocales).toEqual(['en', 'fr-ca']);
    expect(zulu?.overflowLocales).toEqual([]);
  });

  it('marks read-only collections', () => {
    expect(component.cards().find((c) => c.name === 'Bravo')?.readOnly).toBe(true);
    expect(component.cards().find((c) => c.name === 'zulu')?.readOnly).toBe(false);
  });

  it('filters on name and on translations folder', () => {
    component.filter.set('BRAV');
    expect(component.cards().map((c) => c.name)).toEqual(['Bravo']);

    component.filter.set('sample/');
    expect(component.cards().map((c) => c.name)).toEqual(['alpha', 'zulu']);
  });

  it('reports no matches only while a filter excludes everything', () => {
    expect(component.hasNoMatches()).toBe(false);

    component.filter.set('nothing-matches-this');
    expect(component.hasNoMatches()).toBe(true);

    component.clearFilter();
    expect(component.filter()).toBe('');
    expect(component.hasNoMatches()).toBe(false);
  });

  it('hides the filter until the list outgrows a handful of collections', () => {
    expect(component.showFilter()).toBe(false);
  });

  it('navigates to the browser with the collection name encoded', () => {
    const router = spectator.inject(Router);
    component.navigateToBrowser('a b');

    expect(router.navigate).toHaveBeenCalledWith(['/browser', 'a%20b']);
  });

  it('titles the page with the project name and summarises collections, bundles and base locale', () => {
    const page = text(fixture);

    expect((fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent?.trim()).toBe('lingo-tracker');
    expect(page).toContain('.lingo-tracker.json');
    expect(page).toContain('3 collections');
    expect(page).toContain('2 bundles');
    expect(page).toContain('base en');
  });

  it('falls back to the Collections title when the project name is unknown', () => {
    api.getConfig.mockReturnValue(of({ ...config, projectName: undefined }));
    store.loadCollections();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent?.trim()).toBe('Collections');
  });

  it('resolves the collections each bundle consumes and the locale count from the global config', () => {
    const cards = component.bundleCards();

    expect(cards.map((c) => c.entry.name)).toEqual(['main', 'tracker']);
    expect(cards.find((c) => c.entry.name === 'main')?.collectionNames).toEqual(['zulu', 'alpha', 'Bravo']);
    expect(cards.find((c) => c.entry.name === 'tracker')?.collectionNames).toEqual(['alpha']);
    expect(cards[0]?.localeCount).toBe(2);
  });

  it('renders one bundle card per bundle with the column header tools', () => {
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('app-bundle-card').length).toBe(2);
    expect(text(fixture)).toContain('Generate all');
    expect(text(fixture)).toContain('Add bundle');
    expect(host.querySelector('.empty-bundles')).toBeNull();
  });

  it('shows the dashed empty card and hides the tools when there are no bundles', () => {
    api.getConfig.mockReturnValue(of({ ...config, bundles: {} }));
    store.loadCollections();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.empty-bundles')).not.toBeNull();
    expect(text(fixture)).toContain('No bundles yet');
    expect(text(fixture)).not.toContain('Generate all');
    expect(text(fixture)).toContain('0 bundles');
  });

  it('wires the hovered bundle to the collections it consumes; "All" links every card', () => {
    expect(component.isCollectionLinked('zulu')).toBe(false);

    component.onBundleHover('tracker', true);
    expect(component.isCollectionLinked('alpha')).toBe(true);
    expect(component.isCollectionLinked('zulu')).toBe(false);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.collection-card.linked').length).toBe(1);
    // The unconsumed collections keep their full presence: the connector line is what
    // states the relation now, not a dim on everything it excludes.
    expect(host.querySelectorAll('.collection-card')).toHaveLength(3);
    expect(host.querySelector('[data-collection="alpha"]')).not.toBeNull();

    component.onBundleHover('main', true);
    expect(component.isCollectionLinked('zulu')).toBe(true);
    expect(component.isCollectionLinked('Bravo')).toBe(true);

    // A stale leave from another card must not clear the current hover.
    component.onBundleHover('tracker', false);
    expect(component.hoveredBundle()).toBe('main');

    component.onBundleHover('main', false);
    expect(component.hoveredBundle()).toBeNull();
    expect(component.isCollectionLinked('zulu')).toBe(false);
  });

  it('draws no connector lines while the columns are stacked in the test layout', () => {
    // jsdom gives every element a zero rect, so the bundles column never clears the
    // collections column and the geometry path must decline rather than draw at 0,0.
    component.onBundleHover('main', true);
    fixture.detectChanges();

    expect(component.bundleLinks()).toEqual([]);
    expect(component.bundlePort()).toBeNull();
  });

  it('disables Generate all while a single bundle generates from its own card', () => {
    const running: BundleGenerateJobDto = {
      jobId: 'job-1',
      bundleName: 'tracker',
      status: 'running',
      progress: { current: 0, total: 2 },
    };
    api.generateBundle.mockReturnValue(of(running));
    api.getBundleJob.mockReturnValue(of(running));

    // A single Generate keeps the plain label — the "n of N" count is batch-scoped.
    component.generateBundle('tracker');
    fixture.detectChanges();
    expect(store.isAnyBundleRunning()).toBe(true);
    expect(component.isGeneratingAll()).toBe(false);
    expect(text(fixture)).toContain('Generate all');

    // …but the button must look as inert as it behaves, or the click is a silent no-op.
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="generate-all"]',
    );
    expect(button).toBeTruthy();
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-disabled')).toBe('true');

    // Ignored while something is already running.
    component.generateAllBundles();
    expect(api.generateBundle).toHaveBeenCalledTimes(1);
  });

  it('counts the Generate all batch as "n of N" while it runs', () => {
    const running = (bundleName: string): BundleGenerateJobDto => ({
      jobId: `job-${bundleName}`,
      bundleName,
      status: 'running',
      progress: { current: 0, total: 6 },
    });
    api.generateBundle.mockImplementation((name: string) => of(running(name)));
    api.getBundleJob.mockImplementation((jobId: string) => of(running(jobId.replace('job-', ''))));

    component.generateAllBundles();
    fixture.detectChanges();

    expect(component.isGeneratingAll()).toBe(true);
    expect(component.generateAllPosition()).toBe(1);
    expect(text(fixture)).toContain('1 of 2…');

    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="generate-all"]',
    );
    expect(button?.disabled).toBe(true);
  });

  describe('config write outcomes', () => {
    const rejection = (status: number, message: string) =>
      throwError(() => toApiError(new HttpErrorResponse({ status, error: { statusCode: status, message } })));
    const dialogOpened = () => vi.waitFor(() => expect(dialog.open).toHaveBeenCalled());

    // The manager loads its dialogs lazily; the first import of a dialog module is slow
    // enough to outlast a waitFor, so load them once up front.
    beforeAll(async () => {
      await import('./collection-form-dialog/collection-form-dialog');
      await import('./bundle-form-dialog/bundle-form-dialog');
      await import('../shared/components/confirmation-dialog/confirmation-dialog');
    });

    it('toasts Created only for a collection the dialog saved; the manager writes nothing itself', async () => {
      dialog.open.mockReturnValue(closingWith({ name: 'new', config: { translationsFolder: 'i18n' } }));

      component.openCreateDialog();
      await vi.waitFor(() => expect(notifications.success).toHaveBeenCalledWith('Collection created successfully'));

      expect(api.createCollection).not.toHaveBeenCalled();
      expect(notifications.success).toHaveBeenCalledTimes(1);
    });

    it('toasts nothing when the collection dialog closes without a save', async () => {
      dialog.open.mockReturnValue(closingWith(undefined));

      component.openCreateDialog();
      await dialogOpened();

      expect(notifications.success).not.toHaveBeenCalled();
      expect(notifications.error).not.toHaveBeenCalled();
    });

    it('toasts Updated only for a bundle the dialog saved', async () => {
      dialog.open.mockReturnValue(closingWith({ name: 'main', bundle: config.bundles?.['main'] }));

      component.openEditBundleDialog('main');
      await vi.waitFor(() => expect(notifications.success).toHaveBeenCalledWith('Bundle updated successfully'));

      expect(api.updateBundle).not.toHaveBeenCalled();
    });

    it('toasts Deleted once the server has removed the collection', async () => {
      dialog.open.mockReturnValue(closingWith(true));
      api.deleteCollection.mockReturnValue(of({ message: 'ok' }));
      api.getConfig.mockReturnValue(of({ ...config, collections: { alpha: config.collections['alpha'] } }));

      component.openDeleteDialog('zulu');
      await vi.waitFor(() => expect(notifications.success).toHaveBeenCalledWith('Collection deleted successfully'));

      expect(dialog.open.mock.calls.at(-1)?.[1]).toEqual({
        data: {
          title: 'Delete Collection',
          message: 'Are you sure you want to delete zulu?',
          confirmButtonText: 'Delete',
          cancelButtonText: 'Cancel',
          actionType: 'destructive',
        },
        width: '400px',
      });

      expect(api.deleteCollection).toHaveBeenCalledWith('zulu');
      expect(component.cards().map((card) => card.name)).toEqual(['alpha']);
    });

    it('toasts the server message, and no success, when the delete is refused', async () => {
      dialog.open.mockReturnValue(closingWith(true));
      api.deleteCollection.mockReturnValue(rejection(403, 'Collection "Bravo" is read-only.'));

      component.openDeleteDialog('Bravo');
      await vi.waitFor(() => expect(notifications.error).toHaveBeenCalledWith('Collection "Bravo" is read-only.'));

      expect(notifications.success).not.toHaveBeenCalled();
      expect(component.cards()).toHaveLength(3);
    });

    it('toasts the delete-failed fallback for a refused bundle delete without a message', async () => {
      dialog.open.mockReturnValue(closingWith(true));
      api.deleteBundle.mockReturnValue(
        throwError(() => toApiError(new HttpErrorResponse({ status: 500, error: { statusCode: 500 } }))),
      );

      component.openDeleteBundleDialog('main');
      await vi.waitFor(() => expect(notifications.error).toHaveBeenCalledWith('Failed to delete bundle'));

      expect(dialog.open.mock.calls.at(-1)?.[1]).toEqual({
        data: {
          title: 'Delete Bundle',
          message: 'Delete the bundle main? Files it already generated are kept.',
          confirmButtonText: 'Delete',
          cancelButtonText: 'Cancel',
          actionType: 'destructive',
        },
        width: '400px',
      });

      expect(notifications.success).not.toHaveBeenCalled();
    });
  });

  it('leaves Generate all enabled when nothing is running', () => {
    fixture.detectChanges();

    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="generate-all"]',
    );
    expect(button).toBeTruthy();
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute('aria-disabled')).toBeNull();
  });
});
