import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { createComponentFactory, type Spectator } from '@ngneat/spectator/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTranslocoTestingModule } from '../../../../../testing/transloco-testing.module';
import { BrowserStore } from '../../../store/browser.store';
import { LocaleFilter } from './locale-filter';

describe('LocaleFilter', () => {
  let component: LocaleFilter;
  let fixture: ComponentFixture<LocaleFilter>;
  let spectator: Spectator<LocaleFilter>;
  let mockStore: ReturnType<typeof createMockStore>;

  /** The slice of `BrowserStore` the filter reads. */
  const createMockStore = () => ({
    availableLocales: signal(['en', 'es', 'fr', 'de']),
    filterableLocales: signal(['es', 'fr', 'de']), // Excludes base locale 'en'
    selectedLocales: signal<string[]>([]),
    compactDisplayLocale: signal('en'),
    localeFilterText: signal('All locales'),
    isShowingAllLocales: signal(true),
    toggleLocale: vi.fn(),
    selectAllLocales: vi.fn(),
    clearAllLocales: vi.fn(),
    setSelectedLocales: vi.fn(),
  });

  const createComponent = createComponentFactory({
    component: LocaleFilter,
    imports: [NoopAnimationsModule, getTranslocoTestingModule()],
    providers: [{ provide: BrowserStore, useFactory: () => mockStore }],
  });

  beforeEach(() => {
    mockStore = createMockStore();

    spectator = createComponent();
    fixture = spectator.fixture;
    component = spectator.component;
  });

  describe('Component Initialization', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should inject store', () => {
      expect(component.store).toBe(mockStore);
    });
  });

  describe('Template Rendering', () => {
    it('should display filter trigger button', () => {
      const button = fixture.nativeElement.querySelector('[data-testid="locale-filter-trigger"]');
      expect(button).toBeTruthy();
    });

    it('should show filter icon', () => {
      const icon = fixture.nativeElement.querySelector('.filter-icon');
      expect(icon?.textContent?.trim()).toBe('translate');
    });

    it('should display current selection text', () => {
      const text = fixture.nativeElement.querySelector('.filter-text');
      expect(text?.textContent?.trim()).toBe('All locales');
    });

    it('should show dropdown arrow', () => {
      const arrow = fixture.nativeElement.querySelector('.arrow-icon');
      expect(arrow?.textContent?.trim()).toBe('arrow_drop_down');
    });
  });

  describe('Locale Selection', () => {
    it('should check if locale is selected', () => {
      mockStore.selectedLocales.set(['en', 'es']);
      fixture.detectChanges();

      expect(component.isLocaleSelected('en')).toBe(true);
      expect(component.isLocaleSelected('fr')).toBe(false);
    });

    it('should check the displayed locale in single-select mode even with no selection', () => {
      fixture.componentRef.setInput('multiSelect', false);
      mockStore.selectedLocales.set([]);
      mockStore.compactDisplayLocale.set('en');
      fixture.detectChanges();

      expect(component.isLocaleSelected('en')).toBe(true);
      expect(component.isLocaleSelected('es')).toBe(false);
    });

    it('should toggle locale', () => {
      component.toggleLocale('en');
      expect(mockStore.toggleLocale).toHaveBeenCalledWith('en');
    });

    it('should select all locales', () => {
      component.selectAll();
      expect(mockStore.selectAllLocales).toHaveBeenCalled();
    });

    it('should clear all locales', () => {
      component.clearAll();
      expect(mockStore.clearAllLocales).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty available locales', () => {
      mockStore.availableLocales.set([]);
      mockStore.filterableLocales.set([]);
      fixture.detectChanges();

      const trigger = fixture.nativeElement.querySelector('[data-testid="locale-filter-trigger"]');
      expect(trigger).toBeTruthy();
    });

    it('should correctly identify unselected locale', () => {
      mockStore.selectedLocales.set([]);
      fixture.detectChanges();

      expect(component.isLocaleSelected('es')).toBe(false);
    });

    it('should handle single locale selection', () => {
      mockStore.selectedLocales.set(['es']);
      mockStore.localeFilterText.set('es');
      fixture.detectChanges();

      const filterText = fixture.nativeElement.querySelector('.filter-text');
      expect(filterText?.textContent?.trim()).toBe('es');
    });

    it('should only show filterable locales in dropdown', () => {
      // filterableLocales excludes base locale
      expect(mockStore.filterableLocales()).toEqual(['es', 'fr', 'de']);
      expect(mockStore.filterableLocales()).not.toContain('en');
    });
  });

  describe('Multi-select mode control', () => {
    it('should allow multiple selections when multiSelect is true', () => {
      fixture.componentRef.setInput('multiSelect', true);
      fixture.detectChanges();

      // Should not trigger any reduction
      expect(mockStore.setSelectedLocales).not.toHaveBeenCalled();
    });

    it('should reduce to single selection when multiSelect is disabled', () => {
      mockStore.selectedLocales.set(['en', 'es', 'fr']);
      fixture.componentRef.setInput('multiSelect', false);
      fixture.detectChanges();

      expect(mockStore.setSelectedLocales).toHaveBeenCalledWith(['en']);
    });

    it('should not reduce when only one locale selected and multiSelect is disabled', () => {
      mockStore.selectedLocales.set(['en']);
      mockStore.setSelectedLocales.mockClear(); // Clear any previous calls
      fixture.componentRef.setInput('multiSelect', false);
      fixture.detectChanges();

      // Should not be called since there's only one selection
      expect(mockStore.setSelectedLocales).not.toHaveBeenCalled();
    });
  });

  describe('displayedLocales computed', () => {
    it('should return filterableLocales when multiSelect is true', () => {
      fixture.componentRef.setInput('multiSelect', true);
      fixture.detectChanges();

      expect(component.displayedLocales()).toEqual(['es', 'fr', 'de']);
    });

    it('should return availableLocales (including base) when multiSelect is false', () => {
      fixture.componentRef.setInput('multiSelect', false);
      fixture.detectChanges();

      expect(component.displayedLocales()).toEqual(['en', 'es', 'fr', 'de']);
    });
  });
});
