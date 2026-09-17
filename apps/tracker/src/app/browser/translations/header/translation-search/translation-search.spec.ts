import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { createComponentFactory, type Spectator } from '@ngneat/spectator/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTranslocoTestingModule } from '../../../../../testing/transloco-testing.module';
import { SearchInput } from '../../../../shared/components/search-input';
import { BrowserStore } from '../../../store/browser.store';
import { TranslationSearch } from './translation-search';

describe('TranslationSearch', () => {
  let component: TranslationSearch;
  let fixture: ComponentFixture<TranslationSearch>;
  let spectator: Spectator<TranslationSearch>;
  let mockStore: any;

  const createComponent = createComponentFactory({
    component: TranslationSearch,
    imports: [NoopAnimationsModule, getTranslocoTestingModule()],
    providers: [{ provide: BrowserStore, useFactory: () => mockStore }],
  });

  beforeEach(() => {
    mockStore = {
      searchQuery: signal(''),
      isSearchMode: signal(false),
      isSearchLoading: signal(false),
      setSearchQuery: vi.fn(),
      clearSearch: vi.fn(),
      searchTranslations: vi.fn(),
    };

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

    it('should initialize searchValue signal with empty value', () => {
      expect(component.searchValue()).toBe('');
    });
  });

  describe('Template Rendering', () => {
    it('should render SearchInput component', () => {
      const searchInput = fixture.nativeElement.querySelector('app-search-input');
      expect(searchInput).toBeTruthy();
    });

    it('should pass correct placeholder to SearchInput', () => {
      const searchInputDebug = fixture.debugElement.query(By.directive(SearchInput));
      const searchInputComponent = searchInputDebug.componentInstance as SearchInput;
      // The placeholder should be resolved by transloco
      expect(searchInputComponent.placeholder()).toBe('Search (min 3 characters)...');
    });

    it('should pass isLoading state to SearchInput', () => {
      mockStore.isSearchLoading.set(true);
      fixture.detectChanges();

      const searchInputDebug = fixture.debugElement.query(By.directive(SearchInput));
      const searchInputComponent = searchInputDebug.componentInstance as SearchInput;
      expect(searchInputComponent.isLoading()).toBe(true);
    });

    it('should pass current search value to SearchInput', () => {
      component.searchValue.set('test query');
      fixture.detectChanges();

      expect(component.searchValue()).toBe('test query');
    });
  });

  describe('Search Debouncing', () => {
    it('should update store search query after typing at least 3 characters', async () => {
      component.onSearchChange('test');

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 350));

      expect(mockStore.setSearchQuery).toHaveBeenCalledWith('test');
    });

    it('should trigger search after debounce with 3+ characters', async () => {
      component.onSearchChange('button');

      await new Promise((resolve) => setTimeout(resolve, 350));

      expect(mockStore.searchTranslations).toHaveBeenCalledWith('button');
    });

    it('should not search for query with fewer than 3 characters', async () => {
      component.onSearchChange('ab');

      await new Promise((resolve) => setTimeout(resolve, 350));

      expect(mockStore.setSearchQuery).not.toHaveBeenCalled();
      expect(mockStore.searchTranslations).not.toHaveBeenCalled();
    });

    it('should clear search when query becomes empty', async () => {
      component.onSearchChange('test');
      await new Promise((resolve) => setTimeout(resolve, 350));

      mockStore.setSearchQuery.mockClear();
      mockStore.searchTranslations.mockClear();
      mockStore.clearSearch.mockClear();

      component.onSearchChange('');
      await new Promise((resolve) => setTimeout(resolve, 350));

      expect(mockStore.clearSearch).toHaveBeenCalled();
      expect(mockStore.searchTranslations).not.toHaveBeenCalled();
    });
  });

  describe('Clear Search', () => {
    it('should clear searchValue signal', () => {
      component.searchValue.set('test query');

      component.onClearSearch();

      expect(component.searchValue()).toBe('');
    });

    it('should call store clearSearch method', () => {
      component.onClearSearch();

      expect(mockStore.clearSearch).toHaveBeenCalled();
    });
  });
});
