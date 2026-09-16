import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BundleGenerateJobDto, LingoTrackerConfigDto } from '@simoncodes-ca/data-transfer';
import { CollectionsManager } from './collections-manager';
import { CollectionsStore } from './store/collections.store';
import { CollectionsApiService } from './services/collections-api.service';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { getTranslocoTestingModule } from '../../testing/transloco-testing.module';

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

const text = (fixture: ComponentFixture<CollectionsManager>): string =>
  (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ') ?? '';

describe('CollectionsManager', () => {
  let fixture: ComponentFixture<CollectionsManager>;
  let component: CollectionsManager;
  let store: InstanceType<typeof CollectionsStore>;

  beforeEach(async () => {
    vi.resetAllMocks();
    // Runs are mirrored to session storage, which jsdom keeps between tests.
    sessionStorage.clear();
    api.getConfig.mockReturnValue(of(config));

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [CollectionsManager, NoopAnimationsModule, getTranslocoTestingModule()],
      providers: [
        provideTranslocoMessageformat(),
        CollectionsStore,
        { provide: CollectionsApiService, useValue: api },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CollectionsManager);
    component = fixture.componentInstance;
    store = TestBed.inject(CollectionsStore);
    store.loadCollections();
    fixture.detectChanges();
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
    const router = TestBed.inject(Router);
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
