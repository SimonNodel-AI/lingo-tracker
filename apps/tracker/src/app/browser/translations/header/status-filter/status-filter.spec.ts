import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal, computed } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import type { TranslationStatus } from '@simoncodes-ca/data-transfer';
import { StatusFilter } from './status-filter';
import { BrowserStore } from '../../../store/browser.store';
import { getTranslocoTestingModule } from '../../../../../testing/transloco-testing.module';

describe('StatusFilter', () => {
  let component: StatusFilter;
  let fixture: ComponentFixture<StatusFilter>;
  let selectedStatuses: ReturnType<typeof signal<TranslationStatus[]>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockStore: any;

  const toggleFor = (id: string): HTMLButtonElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="status-toggle-${id}"]`);

  beforeEach(async () => {
    selectedStatuses = signal<TranslationStatus[]>([]);

    mockStore = {
      selectedStatuses,
      statusCounts: signal({ new: 6, stale: 4, translated: 7, verified: 8 }),
      needsWorkCount: signal(9),
      hasStatusFilter: computed(() => selectedStatuses().length > 0),
      toggleStatus: vi.fn(),
      selectNeedsWorkStatuses: vi.fn(),
      clearAllStatuses: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [StatusFilter, NoopAnimationsModule, getTranslocoTestingModule()],
      providers: [{ provide: BrowserStore, useValue: mockStore }],
    }).compileComponents();

    fixture = TestBed.createComponent(StatusFilter);
    component = fixture.componentInstance;
    fixture.detectChanges();
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
    it('should render a toggle for needs work plus one per status', () => {
      const toggles = fixture.nativeElement.querySelectorAll('.status-toggle');
      expect(toggles.length).toBe(5);
    });

    it('should label the group for assistive technology', () => {
      const rail = fixture.nativeElement.querySelector('.status-rail');
      expect(rail?.getAttribute('aria-label')).toBeTruthy();
    });

    it('should show each status count from the store', () => {
      expect(toggleFor('new')?.querySelector('.status-count')?.textContent?.trim()).toBe('6');
      expect(toggleFor('stale')?.querySelector('.status-count')?.textContent?.trim()).toBe('4');
      expect(toggleFor('translated')?.querySelector('.status-count')?.textContent?.trim()).toBe('7');
      expect(toggleFor('verified')?.querySelector('.status-count')?.textContent?.trim()).toBe('8');
    });

    it('should show the needs-work count as a union, not the sum of new and stale', () => {
      // 6 new + 4 stale = 10 cells, but only 9 distinct resources.
      expect(toggleFor('needsWork')?.querySelector('.status-count')?.textContent?.trim()).toBe('9');
    });

    it('should expose selection through aria-pressed', () => {
      expect(toggleFor('stale')?.getAttribute('aria-pressed')).toBe('false');

      selectedStatuses.set(['stale']);
      fixture.detectChanges();

      expect(toggleFor('stale')?.getAttribute('aria-pressed')).toBe('true');
      expect(toggleFor('new')?.getAttribute('aria-pressed')).toBe('false');
    });

    it('should mark the rail as filtering only while a status is selected', () => {
      const rail = fixture.nativeElement.querySelector('.status-rail');
      expect(rail?.classList.contains('status-rail--filtering')).toBe(false);

      selectedStatuses.set(['new']);
      fixture.detectChanges();

      expect(rail?.classList.contains('status-rail--filtering')).toBe(true);
    });

    it('should keep every toggle visible while filtering', () => {
      selectedStatuses.set(['new']);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelectorAll('.status-toggle').length).toBe(5);
    });
  });

  describe('Toggling a single status', () => {
    it('should toggle the status it names', () => {
      toggleFor('verified')?.click();
      expect(mockStore.toggleStatus).toHaveBeenCalledWith('verified');
    });

    it('should not reach for the needs-work shortcut', () => {
      toggleFor('new')?.click();
      expect(mockStore.toggleStatus).toHaveBeenCalledWith('new');
      expect(mockStore.selectNeedsWorkStatuses).not.toHaveBeenCalled();
    });
  });

  describe('Needs work', () => {
    it('should select new and stale in one click', () => {
      toggleFor('needsWork')?.click();
      expect(mockStore.selectNeedsWorkStatuses).toHaveBeenCalledOnce();
    });

    it('should read as selected only when it is exactly what is selected', () => {
      selectedStatuses.set(['new', 'stale']);
      fixture.detectChanges();
      expect(component.isNeedsWorkSelected()).toBe(true);
      expect(toggleFor('needsWork')?.getAttribute('aria-pressed')).toBe('true');
    });

    it('should not read as selected when only one of its statuses is on', () => {
      selectedStatuses.set(['new']);
      fixture.detectChanges();
      expect(component.isNeedsWorkSelected()).toBe(false);
      expect(toggleFor('needsWork')?.getAttribute('aria-pressed')).toBe('false');
    });

    it('should not read as selected when a status outside it is also on', () => {
      selectedStatuses.set(['new', 'stale', 'verified']);
      fixture.detectChanges();
      expect(component.isNeedsWorkSelected()).toBe(false);
    });

    it('should clear back to everything when pressed while selected', () => {
      selectedStatuses.set(['new', 'stale']);
      fixture.detectChanges();

      toggleFor('needsWork')?.click();

      expect(mockStore.clearAllStatuses).toHaveBeenCalledOnce();
      expect(mockStore.selectNeedsWorkStatuses).not.toHaveBeenCalled();
    });
  });
});
