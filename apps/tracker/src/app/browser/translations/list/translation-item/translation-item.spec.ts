import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TranslationItem } from './translation-item';
import type { ResourceSummaryDto } from '@simoncodes-ca/data-transfer';
import { getTranslocoTestingModule } from '../../../../../testing/transloco-testing.module';
import { BrowserStore } from '../../../store/browser.store';
import { TranslationListStore } from '../store/translation-list.store';
import { TRACKER_TOKENS } from '../../../../../i18n-types/tracker-resources';

async function configureTranslationItemTestBed(): Promise<{
  fixture: ComponentFixture<TranslationItem>;
  component: TranslationItem;
  store: InstanceType<typeof BrowserStore>;
}> {
  // View preferences persist per collection, so a compact locale picked by one
  // test would otherwise be restored by the next.
  localStorage.clear();

  await TestBed.configureTestingModule({
    imports: [TranslationItem, getTranslocoTestingModule()],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MatDialog, useValue: { open: vi.fn() } },
      TranslationListStore,
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(TranslationItem);
  return { fixture, component: fixture.componentInstance, store: TestBed.inject(BrowserStore) };
}

const mockTranslation: ResourceSummaryDto = {
  key: 'common.buttons.save',
  translations: {
    en: 'Save',
    es: 'Guardar',
    fr: 'Enregistrer',
  },
  status: {
    es: 'translated',
    fr: 'verified',
  },
};

describe('TranslationItem', () => {
  let component: TranslationItem;
  let fixture: ComponentFixture<TranslationItem>;
  let store: InstanceType<typeof BrowserStore>;

  beforeEach(async () => {
    ({ fixture, component, store } = await configureTranslationItemTestBed());
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should accept translation input', () => {
    store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'es'], baseLocale: 'en' });
    fixture.componentRef.setInput('translation', mockTranslation);
    fixture.detectChanges();

    expect(component.translation()).toEqual(mockTranslation);
  });

  it('should render placeholder for empty selected locale value', () => {
    const t: ResourceSummaryDto = {
      key: 'k-empty',
      translations: { en: 'en', es: '' },
      status: { es: 'new' },
    } as any;

    store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'es'], baseLocale: 'en' });
    store.setDensityMode('compact');
    store.setSelectedLocales(['es']);
    fixture.componentRef.setInput('translation', t);
    fixture.detectChanges();

    expect(component.compactDisplay().value).toBe('');
    const html = fixture.nativeElement.innerHTML as string;
    expect(html).toContain('No translation');
  });

  describe('compact row composition', () => {
    it('shows the base value alone by default', () => {
      store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'es'], baseLocale: 'en' });
      store.setDensityMode('compact');
      fixture.componentRef.setInput('translation', mockTranslation);
      fixture.detectChanges();

      const display = component.compactDisplay();
      expect(display.locale).toBe('en');
      expect(display.isBase).toBe(true);
      expect(display.value).toBe('Save');
      // Source text carries no status and no marker
      expect(display.status).toBeUndefined();
      expect(component.hasCompactAnnotation()).toBe(false);

      const html = fixture.nativeElement.innerHTML as string;
      expect(html).toContain('Save');
      expect(html).not.toContain('Guardar');
    });

    it('replaces the base value with the selected locale value, not beside it', () => {
      store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'es'], baseLocale: 'en' });
      store.setDensityMode('compact');
      store.setSelectedLocales(['es']);
      fixture.componentRef.setInput('translation', mockTranslation);
      fixture.detectChanges();

      expect(component.compactDisplay().locale).toBe('es');
      expect(component.compactDisplay().value).toBe('Guardar');

      const html = fixture.nativeElement.innerHTML as string;
      expect(html).toContain('Guardar');
      expect(html).not.toContain('>Save<');
    });

    it('hides the status chip for translated and verified rows', () => {
      store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'es', 'fr'], baseLocale: 'en' });
      store.setDensityMode('compact');
      store.setSelectedLocales(['es']);
      fixture.componentRef.setInput('translation', mockTranslation);
      fixture.detectChanges();

      expect(component.compactDisplay().status).toBe('translated');
      expect(component.compactDisplay().needsAttention).toBe(false);
      expect(fixture.nativeElement.querySelector('.compact-annotation .status-chip')).toBeNull();

      store.setSelectedLocales(['fr']);
      fixture.detectChanges();
      expect(component.compactDisplay().status).toBe('verified');
      expect(fixture.nativeElement.querySelector('.compact-annotation .status-chip')).toBeNull();
    });

    it('shows the status chip only for new and stale rows', () => {
      const needsWork: ResourceSummaryDto = {
        key: 'common.buttons.save',
        translations: { en: 'Save', es: 'Guardar viejo', fr: '' },
        status: { es: 'stale', fr: 'new' },
      } as ResourceSummaryDto;

      store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'es', 'fr'], baseLocale: 'en' });
      store.setDensityMode('compact');
      store.setSelectedLocales(['es']);
      fixture.componentRef.setInput('translation', needsWork);
      fixture.detectChanges();

      expect(component.compactDisplay().needsAttention).toBe(true);
      expect(fixture.nativeElement.querySelector('.compact-annotation .status-chip.status-stale')).not.toBeNull();

      store.setSelectedLocales(['fr']);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.compact-annotation .status-chip.status-new')).not.toBeNull();
    });

    it('falls back to the first locale when the collection carries no base locale', () => {
      // A vendored collection can ship translations with no base locale at all.
      const noBase: ResourceSummaryDto = {
        key: 'agGrid.addToLabels',
        translations: { ar: 'إضافة', de: 'Hinzufügen' },
        status: { ar: 'translated', de: 'translated' },
      } as ResourceSummaryDto;

      store.setSelectedCollection({ collectionName: 'ds', locales: ['ar', 'de'], baseLocale: 'en' });
      store.setDensityMode('compact');
      fixture.componentRef.setInput('translation', noBase);
      fixture.detectChanges();

      expect(component.compactDisplay().locale).toBe('ar');
      expect(component.compactDisplay().value).toBe('إضافة');
    });

    it('marks a translation that is the source text verbatim', () => {
      const untouched: ResourceSummaryDto = {
        key: 'common.buttons.add',
        translations: { en: 'Add', 'fr-ca': 'Add' },
        status: { 'fr-ca': 'translated' },
      } as ResourceSummaryDto;

      store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'fr-ca'], baseLocale: 'en' });
      store.setDensityMode('compact');
      store.setSelectedLocales(['fr-ca']);
      fixture.componentRef.setInput('translation', untouched);
      fixture.detectChanges();

      // Status says `translated`; a checksum cannot see that nobody touched it.
      expect(component.compactDisplay().status).toBe('translated');
      expect(component.compactDisplay().isSameAsBase).toBe(true);
      expect(component.hasCompactAnnotation()).toBe(true);
      expect(fixture.nativeElement.querySelector('.compact-annotation .same-as-source')).not.toBeNull();
    });

    it('shows one marker at most: the status chip wins over same-as-source', () => {
      const untouchedNew: ResourceSummaryDto = {
        key: 'common.buttons.add',
        translations: { en: 'Add', 'fr-ca': 'Add' },
        status: { 'fr-ca': 'new' },
      } as ResourceSummaryDto;

      store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'fr-ca'], baseLocale: 'en' });
      store.setDensityMode('compact');
      store.setSelectedLocales(['fr-ca']);
      fixture.componentRef.setInput('translation', untouchedNew);
      fixture.detectChanges();

      expect(component.compactDisplay().needsAttention).toBe(true);
      expect(component.compactDisplay().isSameAsBase).toBe(false);
      expect(fixture.nativeElement.querySelector('.compact-annotation .status-chip.status-new')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('.compact-annotation .same-as-source')).toBeNull();
    });
  });

  it('rollupStatus should reflect all verified state as verified', () => {
    const t: ResourceSummaryDto = {
      key: 'k-all-verified',
      translations: { en: 'a', es: 'b' },
      status: { en: 'verified', es: 'verified' },
    } as any;

    store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'es'], baseLocale: 'en' });
    fixture.componentRef.setInput('translation', t);
    fixture.detectChanges();

    const roll = component.rollupStatus();
    expect(roll[0]).toBe('verified');
    expect(roll[1]).toBe(2);
  });

  it('should use filteredLocales from store (replaces locales input)', () => {
    store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'es', 'fr'], baseLocale: 'en' });
    store.setDensityMode('full');
    store.clearAllLocales();
    fixture.componentRef.setInput('translation', mockTranslation);
    fixture.detectChanges();

    expect(store.filteredLocales()).toEqual(['en', 'es', 'fr']);
  });

  it('should use baseLocale from store (replaces baseLocale input)', () => {
    store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'de'], baseLocale: 'de' });
    fixture.componentRef.setInput('translation', mockTranslation);
    fixture.detectChanges();

    expect(store.baseLocale()).toBe('de');
  });
});

describe('TranslationItem - Compact helpers', () => {
  let component: TranslationItem;
  let fixture: ComponentFixture<TranslationItem>;
  let store: InstanceType<typeof BrowserStore>;

  beforeEach(async () => {
    ({ fixture, component, store } = await configureTranslationItemTestBed());
  });

  it('should show the base locale in compact until a locale is picked', () => {
    store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'es', 'fr'], baseLocale: 'en' });
    store.setDensityMode('compact');
    fixture.componentRef.setInput('translation', mockTranslation);
    fixture.detectChanges();

    expect(component.compactDisplay().locale).toBe('en');
    expect(component.compactDisplay().isBase).toBe(true);
  });

  it('should follow the single compact selection', () => {
    store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'es'], baseLocale: 'en' });
    store.setDensityMode('compact');
    fixture.componentRef.setInput('translation', mockTranslation);
    fixture.detectChanges();

    expect(component.compactDisplay().value).toBe('Save');

    store.setSelectedLocales(['es']);
    fixture.detectChanges();
    expect(component.compactDisplay().value).toBe('Guardar');

    store.setSelectedLocales(['en']);
    fixture.detectChanges();
    expect(component.compactDisplay().value).toBe('Save');
  });

  it('rollupStatus should calculate worst status across all locales', () => {
    const t: ResourceSummaryDto = {
      key: 'k',
      translations: { en: 'a', es: 'b', fr: 'c' },
      status: { en: 'verified', es: 'translated', fr: 'stale' },
    };

    store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'es', 'fr'], baseLocale: 'en' });
    store.setDensityMode('full');
    store.clearAllLocales();
    fixture.componentRef.setInput('translation', t);
    fixture.detectChanges();

    const roll = component.rollupStatus();
    expect(roll[0]).toBe('stale');
    expect(roll[1]).toBe(1);
  });

  it('statusBreakdown should return human readable counts in priority order', () => {
    const t: ResourceSummaryDto = {
      key: 'k3',
      translations: { en: 'a', es: 'b', fr: 'c', de: 'd' },
      status: { en: 'stale', es: 'stale', fr: 'verified', de: 'new' },
    } as any;

    store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'es', 'fr', 'de'], baseLocale: 'en' });
    store.setDensityMode('full');
    store.clearAllLocales();
    fixture.componentRef.setInput('translation', t);
    fixture.detectChanges();

    // The test harness has no translations loaded, so each part comes back as its
    // resource key. Assert the contract — worst status first, zero counts omitted —
    // rather than the English wording, which lives in the resource file.
    const breakdown = component.statusBreakdown();

    expect(breakdown).toContain(TRACKER_TOKENS.BROWSER.STATUS.STALECOUNTX);
    expect(breakdown).toContain(TRACKER_TOKENS.BROWSER.STATUS.VERIFIEDCOUNTX);
    expect(breakdown).not.toContain(TRACKER_TOKENS.BROWSER.STATUS.TRANSLATEDCOUNTX);
    expect(breakdown.indexOf(TRACKER_TOKENS.BROWSER.STATUS.STALECOUNTX)).toBeLessThan(
      breakdown.indexOf(TRACKER_TOKENS.BROWSER.STATUS.NEWCOUNTX),
    );
  });
});

// Tests for full density mode expansion logic
describe('TranslationItem - Full density expansion', () => {
  let component: TranslationItem;
  let fixture: ComponentFixture<TranslationItem>;
  let store: InstanceType<typeof BrowserStore>;

  beforeEach(async () => {
    ({ fixture, component, store } = await configureTranslationItemTestBed());

    store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'es', 'fr'], baseLocale: 'en' });
    store.setDensityMode('full');
    store.clearAllLocales();
  });

  it('needsExpansion should be false for short values', () => {
    const t: ResourceSummaryDto = {
      key: 'k-short',
      translations: { en: 'short', es: 'corto', fr: 'court' },
      status: {},
    } as any;

    fixture.componentRef.setInput('translation', t);
    fixture.detectChanges();

    expect(component.needsExpansion()).toBe(false);
  });

  it('needsExpansion should be true when locale rows are withheld by the collapsed state', () => {
    store.setSelectedCollection({
      collectionName: 'test',
      locales: ['en', 'es', 'fr', 'de', 'ja', 'ru'],
      baseLocale: 'en',
    });
    store.clearAllLocales();

    const t: ResourceSummaryDto = {
      key: 'k-many-locales',
      translations: { en: 'short', es: 'corto', fr: 'court', de: 'kurz', ja: '短い', ru: 'коротко' },
      status: {},
    } as any;

    fixture.componentRef.setInput('translation', t);
    fixture.detectChanges();

    // 5 non-base locales, 4 rows visible while collapsed
    expect(component.hiddenLocaleCount()).toBe(1);
    expect(component.visibleLocaleTranslations().length).toBe(4);
    expect(component.needsExpansion()).toBe(true);

    component.toggleExpansion();
    fixture.detectChanges();

    expect(component.hiddenLocaleCount()).toBe(0);
    expect(component.visibleLocaleTranslations().length).toBe(5);
    expect(component.needsExpansion()).toBe(true);
  });

  it('needsExpansion should be true when base long', () => {
    const long = 'a'.repeat(201);
    const t: ResourceSummaryDto = {
      key: 'k-long-base',
      translations: { en: long, es: 'es', fr: 'fr' },
      status: {},
    } as any;

    fixture.componentRef.setInput('translation', t);
    fixture.detectChanges();

    expect(component.needsExpansion()).toBe(true);
  });

  it('needsExpansion should be true when any locale value long', () => {
    const long = 'b'.repeat(205);
    const t: ResourceSummaryDto = {
      key: 'k-long-locale',
      translations: { en: 'en', es: long, fr: 'fr' },
      status: {},
    } as any;

    fixture.componentRef.setInput('translation', t);
    fixture.detectChanges();

    expect(component.needsExpansion()).toBe(true);
  });

  it('isExpanded should toggle when toggleExpansion called', () => {
    fixture.componentRef.setInput('translation', {
      key: 'k',
      translations: { en: 'en' },
      status: {},
    } as any);
    fixture.detectChanges();

    expect(component.isExpanded()).toBe(false);
    component.toggleExpansion();
    expect(component.isExpanded()).toBe(true);
    component.toggleExpansion();
    expect(component.isExpanded()).toBe(false);
  });

  describe('full-density source row', () => {
    it('should expose the base locale as the source row', () => {
      store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'es'], baseLocale: 'en' });
      store.setDensityMode('full');
      fixture.componentRef.setInput('translation', mockTranslation);
      fixture.detectChanges();

      expect(component.baseRow()).toEqual({ locale: 'en', value: 'Save' });
    });

    it('should render the source in the same grid as the translations', () => {
      store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'es', 'fr'], baseLocale: 'en' });
      store.setDensityMode('full');
      fixture.componentRef.setInput('translation', mockTranslation);
      fixture.detectChanges();

      const grid = fixture.nativeElement.querySelector('.locale-translations');
      expect(grid).toBeDefined();

      const baseValue = grid?.querySelector('.locale-value--base');
      expect(baseValue).toBeDefined();
      expect(baseValue?.textContent?.trim()).toBe('Save');

      // The source must be the grid's first line, so the reader meets it before
      // the translations it is the reference for.
      expect(grid?.firstElementChild?.classList.contains('locale-line--base')).toBe(true);
    });

    it('should omit the source row when the collection has no base value', () => {
      const t: ResourceSummaryDto = {
        key: 'k-no-base',
        translations: { es: 'Guardar' },
        status: { es: 'translated' },
      } as any;

      store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'es'], baseLocale: 'en' });
      store.setDensityMode('full');
      fixture.componentRef.setInput('translation', t);
      fixture.detectChanges();

      expect(component.baseRow()).toBeUndefined();
      expect(fixture.nativeElement.querySelector('.locale-value--base')).toBeNull();
    });
  });

  describe('double-click to edit', () => {
    beforeEach(() => {
      store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'es', 'fr'], baseLocale: 'en' });
      fixture.componentRef.setInput('translation', mockTranslation);
    });

    function dblclick(el: Element | null): void {
      expect(el).not.toBeNull();
      el?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    }

    it('leaves a double-click on the compact value to the browser text selection', () => {
      store.setDensityMode('compact');
      fixture.detectChanges();
      const editSpy = vi
        .spyOn(TestBed.inject(TranslationListStore), 'editTranslation')
        .mockImplementation(() => undefined);

      dblclick(fixture.nativeElement.querySelector('.compact-value'));

      expect(editSpy).not.toHaveBeenCalled();
    });

    it('leaves a double-click on a full-density value to the browser text selection', () => {
      store.setDensityMode('full');
      fixture.detectChanges();
      const editSpy = vi
        .spyOn(TestBed.inject(TranslationListStore), 'editTranslation')
        .mockImplementation(() => undefined);

      dblclick(fixture.nativeElement.querySelector('.locale-value--base'));
      dblclick(fixture.nativeElement.querySelector('.locale-line:not(.locale-line--base) .locale-value'));

      expect(editSpy).not.toHaveBeenCalled();
    });

    it('opens the editor on a double-click of the header', () => {
      store.setDensityMode('full');
      fixture.detectChanges();
      const editSpy = vi
        .spyOn(TestBed.inject(TranslationListStore), 'editTranslation')
        .mockImplementation(() => undefined);

      dblclick(fixture.nativeElement.querySelector('.item-header'));

      expect(editSpy).toHaveBeenCalledOnce();
    });
  });

  describe('read-only collections', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('translation', mockTranslation);
    });

    it('should refuse the Delete shortcut when the collection is read-only', () => {
      store.setSelectedCollection({
        collectionName: 'vendored',
        locales: ['en', 'es'],
        baseLocale: 'en',
        readOnly: true,
      });
      fixture.detectChanges();

      const listStore = TestBed.inject(TranslationListStore);
      const deleteSpy = vi.spyOn(listStore, 'deleteTranslation');

      component.onKeyDown(new KeyboardEvent('keydown', { key: 'Delete' }));

      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('should run the Delete shortcut when the collection is writable', () => {
      store.setSelectedCollection({ collectionName: 'test', locales: ['en', 'es'], baseLocale: 'en' });
      fixture.detectChanges();

      const listStore = TestBed.inject(TranslationListStore);
      const deleteSpy = vi.spyOn(listStore, 'deleteTranslation').mockImplementation(() => undefined);

      component.onKeyDown(new KeyboardEvent('keydown', { key: 'Delete' }));

      expect(deleteSpy).toHaveBeenCalledOnce();
    });

    it('should show a lock in place of the drag handle when the collection is read-only', () => {
      store.setSelectedCollection({
        collectionName: 'vendored',
        locales: ['en', 'es'],
        baseLocale: 'en',
        readOnly: true,
      });
      fixture.detectChanges();

      const handle = fixture.nativeElement.querySelector('.translation-drag-handle');
      expect(handle).toBeDefined();
      expect(handle?.textContent?.trim()).toBe('lock');
      expect(handle?.classList.contains('translation-drag-handle--locked')).toBe(true);
    });
  });
});
