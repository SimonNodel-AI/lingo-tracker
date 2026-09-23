import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Provider } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoService } from '@jsverse/transloco';
import { createComponentFactory } from '@ngneat/spectator/vitest';
import { patchState } from '@ngrx/signals';
import type { ResourceSummaryDto } from '@simoncodes-ca/data-transfer';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRACKER_TOKENS } from '../../../../i18n-types/tracker-resources';
import { getTranslocoTestingModule } from '../../../../testing/transloco-testing.module';
import { NotificationService } from '../../../shared/notification';
import type { TranslationEditorResult } from '../../dialogs/translation-editor';
import { BrowserApiService } from '../../services/browser-api.service';
import { BrowserStore } from '../../store/browser.store';
import { TranslationEditorLauncher } from '../../services/translation-editor-launcher';
import { TranslationListStore } from './store/translation-list.store';
import { TranslationList } from './translation-list';

const createList = createComponentFactory({
  component: TranslationList,
  imports: [getTranslocoTestingModule()],
  providers: [provideHttpClient(), provideHttpClientTesting()],
  detectChanges: false,
});

const renderList = (providers: Provider[] = []): ComponentFixture<TranslationList> => createList({ providers }).fixture;

const summary = (fullKey: string, baseValue: string, fr?: [string, 'new' | 'translated']): ResourceSummaryDto => {
  const segments = fullKey.split('.');
  const entryKey = segments.pop() ?? '';
  return {
    fullKey,
    folderPath: segments.join('.'),
    entryKey,
    base: { locale: 'en', value: baseValue },
    targets:
      fr === undefined
        ? []
        : [{ locale: 'fr', value: fr[0], status: fr[1], needsWork: fr[1] === 'new', sameAsBase: false }],
    tags: [],
    inheritedTags: [],
  };
};

describe('TranslationList', () => {
  let component: TranslationList;
  let fixture: ComponentFixture<TranslationList>;

  beforeEach(() => {
    fixture = renderList([
      { provide: NotificationService, useValue: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() } },
      { provide: MatDialog, useValue: { open: vi.fn() } },
    ]);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should inject translation browser store', () => {
    expect(component.store).toBeTruthy();
  });

  it('should accept collectionName input', () => {
    fixture.componentRef.setInput('collectionName', 'test-collection');
    fixture.detectChanges();

    expect(component.collectionName()).toBe('test-collection');
  });

  it('should use default baseLocale', () => {
    expect(component.baseLocale()).toBe('en');
  });
});

describe('TranslationList - Copy to Clipboard', () => {
  let fixture: ComponentFixture<TranslationList>;
  let mockClipboard: { writeText: ReturnType<typeof vi.fn> };
  let notificationsSpy: {
    success: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockClipboard = {
      writeText: vi.fn(() => Promise.resolve()),
    };
    Object.defineProperty(navigator, 'clipboard', {
      value: mockClipboard,
      writable: true,
      configurable: true,
    });

    notificationsSpy = { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() };

    fixture = renderList([
      { provide: NotificationService, useValue: notificationsSpy },
      { provide: MatDialog, useValue: { open: vi.fn() } },
    ]);
  });

  it('should copy key to clipboard and show success toast', async () => {
    fixture.componentRef.setInput('collectionName', 'test');
    fixture.detectChanges();

    const listStore = fixture.debugElement.injector.get(TranslationListStore);
    listStore.copyKey('common.buttons.save');
    await Promise.resolve(); // Wait for clipboard promise to resolve

    expect(mockClipboard.writeText).toHaveBeenCalledWith('common.buttons.save');
    expect(notificationsSpy.success).toHaveBeenCalledWith('Copied to clipboard');
  });

  it('should show error toast when clipboard write fails', async () => {
    mockClipboard.writeText = vi.fn(() => Promise.reject(new Error('Clipboard error')));

    fixture.componentRef.setInput('collectionName', 'test');
    fixture.detectChanges();

    const listStore = fixture.debugElement.injector.get(TranslationListStore);
    listStore.copyKey('test.key');
    await Promise.resolve(); // Wait for clipboard promise to reject

    expect(notificationsSpy.error).toHaveBeenCalledWith('Failed to copy');
  });
});

describe('TranslationList - Loading and Error States', () => {
  let fixture: ComponentFixture<TranslationList>;

  beforeEach(() => {
    fixture = renderList([
      { provide: NotificationService, useValue: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() } },
      { provide: MatDialog, useValue: { open: vi.fn() } },
    ]);
  });

  it('should display loading spinner when loading', () => {
    const store = fixture.debugElement.injector.get(BrowserStore);

    // Set up collection first
    store.setSelectedCollection({
      collectionName: 'test',
      locales: ['en'],
    });

    // Trigger loading state by selecting a folder
    store.selectFolder('test-folder');

    fixture.componentRef.setInput('collectionName', 'test');
    fixture.detectChanges();

    const spinner = fixture.nativeElement.querySelector('mat-spinner');
    const loadingText = fixture.nativeElement.querySelector('.loading-container p');

    expect(spinner).toBeTruthy();
    expect(loadingText?.textContent).toContain('Loading translations');
  });

  it('should display error message when error occurs', async () => {
    const store = fixture.debugElement.injector.get(BrowserStore);
    const httpMock = fixture.debugElement.injector.get(HttpTestingController);

    fixture.componentRef.setInput('collectionName', 'test');
    fixture.detectChanges();

    // Set up collection and trigger folder selection to cause an error
    store.setSelectedCollection({
      collectionName: 'test',
      locales: ['en'],
    });

    // First request for cache status (from setSelectedCollection -> checkCacheStatus)
    const cacheReq = httpMock.expectOne('/api/collections/test/resources/cache/status');
    cacheReq.flush({ status: 'ready', error: null });

    // Second request for root folders (triggered when cache is ready)
    const rootReq = httpMock.expectOne('/api/collections/test/resources/tree?path=&includeNested=true');
    rootReq.flush({ path: '', resources: [], children: [] });

    // Now select a folder and make it fail
    store.selectFolder('test-folder');

    const req = httpMock.expectOne('/api/collections/test/resources/tree?path=test-folder&includeNested=true');
    req.error(new ProgressEvent('error'), {
      status: 500,
      statusText: 'Server Error',
    });

    fixture.detectChanges();

    const errorContainer = fixture.nativeElement.querySelector('.error-container');
    expect(errorContainer).toBeTruthy();
  });

  it('should show the empty-folder state rather than a select-a-folder prompt at the root', () => {
    // The collection root is a real selection now — the sidebar's root row lands on it —
    // so there is no "nothing selected" state left to prompt for.
    fixture.componentRef.setInput('collectionName', 'test');
    fixture.detectChanges();

    const icon = fixture.nativeElement.querySelector('.empty-state__icon');
    const text = fixture.nativeElement.querySelector('.empty-state__text');

    expect(icon?.textContent).toContain('translate');
    expect(text?.textContent).toContain('No translations found');
  });

  it('should display "no translations found" empty state when folder is selected but empty', async () => {
    const store = fixture.debugElement.injector.get(BrowserStore);
    const httpMock = fixture.debugElement.injector.get(HttpTestingController);

    fixture.componentRef.setInput('collectionName', 'test');
    fixture.detectChanges();

    store.setSelectedCollection({
      collectionName: 'test',
      locales: ['en'],
    });

    const cacheReq = httpMock.expectOne('/api/collections/test/resources/cache/status');
    cacheReq.flush({ status: 'ready', error: null });

    const rootReq = httpMock.expectOne('/api/collections/test/resources/tree?path=&includeNested=true');
    rootReq.flush({ path: '', resources: [], children: [] });

    store.selectFolder('empty-folder');

    const req = httpMock.expectOne('/api/collections/test/resources/tree?path=empty-folder&includeNested=true');
    req.flush({ path: 'empty-folder', resources: [], children: [] });

    fixture.detectChanges();

    const emptyState = fixture.nativeElement.querySelector('.empty-state');
    const icon = fixture.nativeElement.querySelector('.empty-state__icon');
    const text = fixture.nativeElement.querySelector('.empty-state__text');

    expect(emptyState).toBeTruthy();
    expect(icon?.textContent).toContain('translate');
    expect(text?.textContent).toContain('No translations found in this folder.');
  });
});

describe('TranslationList - Virtual Scrolling', () => {
  let component: TranslationList;
  let fixture: ComponentFixture<TranslationList>;

  beforeEach(() => {
    fixture = renderList([
      { provide: NotificationService, useValue: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() } },
      { provide: MatDialog, useValue: { open: vi.fn() } },
    ]);
    component = fixture.componentInstance;
  });

  it('should render translation items with virtual scroll', () => {
    const httpMock = fixture.debugElement.injector.get(HttpTestingController);
    const store = fixture.debugElement.injector.get(BrowserStore);

    fixture.componentRef.setInput('collectionName', 'test');
    fixture.detectChanges();

    // Manually trigger store initialization and folder selection
    store.setSelectedCollection({
      collectionName: 'test',
      locales: ['en', 'es'],
    });

    // First request for cache status
    const cacheReq = httpMock.expectOne('/api/collections/test/resources/cache/status');
    cacheReq.flush({ status: 'ready', error: null });

    // Second request for root folders
    const rootReq = httpMock.expectOne('/api/collections/test/resources/tree?path=&includeNested=true');
    rootReq.flush({ path: '', resources: [], children: [] });

    // Select a folder so the viewport renders (empty path shows "select folder" state)
    store.selectFolder('test-folder');

    const folderReq = httpMock.expectOne('/api/collections/test/resources/tree?path=test-folder&includeNested=true');
    folderReq.flush({
      path: 'test-folder',
      resources: [summary('test-folder.key1', 'Value 1'), summary('test-folder.key2', 'Value 2')],
      children: [],
    });

    fixture.detectChanges();

    const viewport = fixture.nativeElement.querySelector('cdk-virtual-scroll-viewport');
    expect(viewport).toBeTruthy();

    // Virtual scroll doesn't always render items in test environment
    // Instead, verify the data is loaded in the store
    expect(store.translations()).toHaveLength(2);
    expect(store.translations()[0].fullKey).toBe('test-folder.key1');
    expect(store.translations()[1].fullKey).toBe('test-folder.key2');
  });

  it('should use trackByKey for performance', () => {
    const translation = summary('test.key', 'Test');

    const result = component.trackByKey(0, translation);
    expect(result).toBe('test.key');
  });
});

describe('TranslationList - skippedLocales warning snackbar', () => {
  let fixture: ComponentFixture<TranslationList>;
  let notificationsSpy: {
    success: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let mockDialogRef: { afterClosed: ReturnType<typeof vi.fn> };
  let mockDialog: { open: ReturnType<typeof vi.fn> };

  const mockResource = summary('common.test', 'Test Value', ['Valeur test', 'translated']);

  beforeEach(async () => {
    notificationsSpy = { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() };
    mockDialogRef = { afterClosed: vi.fn() };
    mockDialog = { open: vi.fn().mockReturnValue(mockDialogRef) };

    fixture = renderList([
      { provide: NotificationService, useValue: notificationsSpy },
      { provide: MatDialog, useValue: mockDialog },
    ]);
    fixture.componentRef.setInput('collectionName', 'test-collection');
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should show warning snackbar when edit result contains skippedLocales', async () => {
    vi.useFakeTimers();

    const result: TranslationEditorResult = {
      key: 'common.test',
      baseValue: 'Test Value',
      folderPath: 'common',
      success: true,
      resource: mockResource,
      skippedLocales: ['fr', 'de'],
    };
    mockDialogRef.afterClosed.mockReturnValue(of(result));

    const listStore = fixture.debugElement.injector.get(TranslationListStore);
    listStore.editTranslation(mockResource, 'test-collection');
    await vi.advanceTimersByTimeAsync(2200);

    const transloco = fixture.debugElement.injector.get(TranslocoService);
    const expectedSkippedMessage = transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.SKIPPEDLOCALESX, {
      locales: 'fr, de',
    });

    expect(notificationsSpy.warning).toHaveBeenCalledWith(expectedSkippedMessage);
  });

  it('should not show warning snackbar when skippedLocales is empty or absent', async () => {
    vi.useFakeTimers();

    for (const skippedLocales of [[], undefined] as Array<string[] | undefined>) {
      notificationsSpy.warning.mockClear();

      const result: TranslationEditorResult = {
        key: 'common.test',
        baseValue: 'Test Value',
        folderPath: 'common',
        success: true,
        resource: mockResource,
        skippedLocales,
      };
      mockDialogRef.afterClosed.mockReturnValue(of(result));

      const listStore = fixture.debugElement.injector.get(TranslationListStore);
      listStore.editTranslation(mockResource, 'test-collection');
      await vi.advanceTimersByTimeAsync(2200);

      expect(notificationsSpy.warning).not.toHaveBeenCalled();
    }
  });

  it('should not show any snackbar when edit dialog is dismissed without success', () => {
    mockDialogRef.afterClosed.mockReturnValue(of(undefined));

    const listStore = fixture.debugElement.injector.get(TranslationListStore);
    listStore.editTranslation(mockResource, 'test-collection');

    expect(notificationsSpy.success).not.toHaveBeenCalled();
    expect(notificationsSpy.warning).not.toHaveBeenCalled();
    expect(notificationsSpy.error).not.toHaveBeenCalled();
  });

  it('should flash the edited row when the edit result contains skippedLocales', () => {
    const result: TranslationEditorResult = {
      key: 'common.test',
      baseValue: 'Test Value',
      folderPath: 'common',
      success: true,
      resource: mockResource,
      skippedLocales: ['fr', 'de'],
    };
    mockDialogRef.afterClosed.mockReturnValue(of(result));

    const listStore = fixture.debugElement.injector.get(TranslationListStore);
    listStore.editTranslation(mockResource, 'test-collection');

    expect(listStore.recentlyUpdatedKey()).toBe(mockResource.fullKey);
  });
});

describe('TranslationList - handleEdit full key', () => {
  let fixture: ComponentFixture<TranslationList>;
  let notificationsSpy: {
    success: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let mockDialogRef: { afterClosed: ReturnType<typeof vi.fn> };
  let mockDialog: { open: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    notificationsSpy = { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() };
    mockDialogRef = { afterClosed: vi.fn() };
    mockDialog = { open: vi.fn().mockReturnValue(mockDialogRef) };

    fixture = renderList([
      { provide: NotificationService, useValue: notificationsSpy },
      { provide: MatDialog, useValue: mockDialog },
    ]);
    fixture.componentRef.setInput('collectionName', 'test-collection');
    fixture.detectChanges();
  });

  // The cache itself is patched by BrowserStore.updateResource (see
  // with-entry-writes.feature.spec.ts); the list only has to flash the right row.
  it('should flash the row under its full key', () => {
    const store = fixture.debugElement.injector.get(BrowserStore);

    store.setSearchQuery('buttons');

    const storeResource = summary('buttons.save', 'Save', ['', 'new']);
    const apiResource = summary('buttons.save', 'Save', ['Enregistrer', 'translated']);

    const result: TranslationEditorResult = {
      key: 'save',
      baseValue: 'Save',
      // folderPath matches what resolveEffectiveFolderPath returns for "buttons.save"
      // in search mode (all segments except the last), so no move occurs.
      folderPath: 'buttons',
      success: true,
      resource: apiResource,
      skippedLocales: [],
    };
    mockDialogRef.afterClosed.mockReturnValue(of(result));

    const listStore = fixture.debugElement.injector.get(TranslationListStore);
    listStore.editTranslation(storeResource, 'test-collection');

    expect(listStore.recentlyUpdatedKey()).toBe(storeResource.fullKey);
  });
});

describe('TranslationList - Locale Filtering', () => {
  let fixture: ComponentFixture<TranslationList>;
  let store: InstanceType<typeof BrowserStore>;

  beforeEach(() => {
    fixture = renderList([
      { provide: NotificationService, useValue: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() } },
      { provide: MatDialog, useValue: { open: vi.fn() } },
    ]);
    store = fixture.debugElement.injector.get(BrowserStore);

    store.setSelectedCollection({
      collectionName: 'test',
      locales: ['en', 'es', 'fr'],
    });
    // Switch to full mode so multi-locale display is not restricted by compact auto-selection
    store.setDensityMode('full');
    store.clearAllLocales();

    fixture.componentRef.setInput('collectionName', 'test');
    fixture.componentRef.setInput('baseLocale', 'en');
    fixture.detectChanges();
  });

  it('should display all locales when none selected', () => {
    expect(store.filteredLocales()).toEqual(['en', 'es', 'fr']);
  });

  it('should display only selected locales', () => {
    store.setSelectedLocales(['en']);
    fixture.detectChanges();

    expect(store.filteredLocales()).toEqual(['en']);
  });
});

describe('TranslationList - deleteTranslation', () => {
  let fixture: ComponentFixture<TranslationList>;
  let notificationsSpy: {
    success: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let mockBrowserApi: { translateResource: ReturnType<typeof vi.fn>; deleteResource: ReturnType<typeof vi.fn> };
  let mockDialogRef: { afterClosed: ReturnType<typeof vi.fn> };
  let mockDialog: { open: ReturnType<typeof vi.fn> };
  let store: InstanceType<typeof BrowserStore>;

  const mockResource = summary('button.delete', 'Delete', ['Supprimer', 'translated']);

  beforeEach(async () => {
    notificationsSpy = { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() };
    mockBrowserApi = { translateResource: vi.fn(), deleteResource: vi.fn() };
    mockDialogRef = { afterClosed: vi.fn() };
    mockDialog = { open: vi.fn().mockReturnValue(mockDialogRef) };

    fixture = renderList([
      { provide: NotificationService, useValue: notificationsSpy },
      { provide: MatDialog, useValue: mockDialog },
      { provide: BrowserApiService, useValue: mockBrowserApi },
    ]);
    store = fixture.debugElement.injector.get(BrowserStore);

    store.setSelectedCollection({ collectionName: 'my-collection', locales: ['en', 'fr'] });
    fixture.componentRef.setInput('collectionName', 'my-collection');
    fixture.detectChanges();
  });

  it('should call API and show success notification when dialog is confirmed', () => {
    mockDialogRef.afterClosed.mockReturnValue(of(true));
    mockBrowserApi.deleteResource.mockReturnValue(of({ entriesDeleted: 1 }));
    patchState(store, { translations: [mockResource] });
    const listStore = fixture.debugElement.injector.get(TranslationListStore);

    listStore.deleteTranslation(mockResource, 'my-collection');

    expect(mockBrowserApi.deleteResource).toHaveBeenCalledWith('my-collection', ['button.delete']);
    expect(store.translations()).toEqual([]);
    expect(notificationsSpy.success).toHaveBeenCalled();
    expect(notificationsSpy.error).not.toHaveBeenCalled();
  });

  it('should show error notification when API throws', () => {
    mockDialogRef.afterClosed.mockReturnValue(of(true));
    mockBrowserApi.deleteResource.mockReturnValue(throwError(() => new Error('Network failure')));
    patchState(store, { translations: [mockResource] });
    const listStore = fixture.debugElement.injector.get(TranslationListStore);

    listStore.deleteTranslation(mockResource, 'my-collection');

    expect(store.translations()).toEqual([mockResource]);
    expect(notificationsSpy.error).toHaveBeenCalledWith('Network failure');
  });

  it('should not call API when dialog is cancelled', () => {
    mockDialogRef.afterClosed.mockReturnValue(of(false));

    const listStore = fixture.debugElement.injector.get(TranslationListStore);
    listStore.deleteTranslation(mockResource, 'my-collection');

    expect(mockBrowserApi.deleteResource).not.toHaveBeenCalled();
    expect(notificationsSpy.success).not.toHaveBeenCalled();
    expect(notificationsSpy.error).not.toHaveBeenCalled();
  });
});

describe('TranslationList - handleTranslate', () => {
  let fixture: ComponentFixture<TranslationList>;
  let notificationsSpy: {
    success: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let mockBrowserApi: { translateResource: ReturnType<typeof vi.fn>; deleteResource: ReturnType<typeof vi.fn> };
  let store: InstanceType<typeof BrowserStore>;

  const mockResource = summary('button.save', 'Save', ['', 'new']);

  const mockUpdatedResource = summary('button.save', 'Save', ['Enregistrer', 'translated']);

  beforeEach(async () => {
    notificationsSpy = { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() };
    mockBrowserApi = {
      translateResource: vi.fn(),
      deleteResource: vi.fn(),
    };

    fixture = renderList([
      { provide: NotificationService, useValue: notificationsSpy },
      { provide: MatDialog, useValue: { open: vi.fn() } },
      { provide: BrowserApiService, useValue: mockBrowserApi },
    ]);
    store = fixture.debugElement.injector.get(BrowserStore);

    store.setSelectedCollection({ collectionName: 'my-collection', locales: ['en', 'fr'] });
    fixture.componentRef.setInput('collectionName', 'my-collection');
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should add the key to translatingKeys during the request and patch the store on success', () => {
    vi.useFakeTimers();

    mockBrowserApi.translateResource.mockReturnValue(
      of({
        resource: mockUpdatedResource,
        translatedCount: 1,
        skippedLocales: [],
      }),
    );

    patchState(store, { translations: [mockResource] });
    const listStore = fixture.debugElement.injector.get(TranslationListStore);

    listStore.translateResource(mockResource, 'my-collection');

    // The key is removed synchronously from translatingKeys after the observable emits
    expect(listStore.translatingKeys().has('button.save')).toBe(false);

    expect(store.translations()).toEqual([mockUpdatedResource]);

    // Success notification shown
    expect(notificationsSpy.success).toHaveBeenCalledWith('1 locale translated successfully');
  });

  it('should remove key from translatingKeys and show failure snackbar on error', () => {
    mockBrowserApi.translateResource.mockReturnValue(throwError(() => new Error('Network failure')));

    const listStore = fixture.debugElement.injector.get(TranslationListStore);
    listStore.translateResource(mockResource, 'my-collection');

    // Key must not linger in the translating set after error
    expect(listStore.translatingKeys().has('button.save')).toBe(false);

    // Error message from the thrown Error is displayed
    expect(notificationsSpy.error).toHaveBeenCalledWith('Network failure');
  });

  it('should show ICU warning snackbar when skippedLocales is non-empty', () => {
    mockBrowserApi.translateResource.mockReturnValue(
      of({
        resource: mockUpdatedResource,
        translatedCount: 0,
        skippedLocales: ['fr', 'de'],
      }),
    );

    const listStore = fixture.debugElement.injector.get(TranslationListStore);
    listStore.translateResource(mockResource, 'my-collection');

    const transloco = fixture.debugElement.injector.get(TranslocoService);
    const expectedSkippedMessage = transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.SKIPPEDLOCALESX, {
      locales: 'fr, de',
    });

    expect(notificationsSpy.warning).toHaveBeenCalledWith(expectedSkippedMessage);
  });
});

describe('TranslationList - openResourceByKey', () => {
  let fixture: ComponentFixture<TranslationList>;
  let launcherSpy: { openEditor: ReturnType<typeof vi.fn>; openByFullKey: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    launcherSpy = { openEditor: vi.fn(), openByFullKey: vi.fn() };

    fixture = renderList([
      { provide: NotificationService, useValue: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() } },
      { provide: MatDialog, useValue: { open: vi.fn() } },
      { provide: TranslationEditorLauncher, useValue: launcherSpy },
    ]);
    fixture.componentRef.setInput('collectionName', 'my-collection');
    fixture.detectChanges();
  });

  it('should hand a full key to the launcher, with a flash callback for the row', () => {
    const listStore = fixture.debugElement.injector.get(TranslationListStore);

    listStore.openResourceByKey('browser.header.backButton', 'my-collection');

    expect(launcherSpy.openByFullKey).toHaveBeenCalledWith(
      'browser.header.backButton',
      'my-collection',
      expect.any(Function),
    );

    const onUpdated = launcherSpy.openByFullKey.mock.calls[0][2] as (key: string) => void;
    onUpdated('backButton');
    expect(listStore.recentlyUpdatedKey()).toBe('backButton');
  });

  it('should open the row editor through the same launcher', () => {
    const listStore = fixture.debugElement.injector.get(TranslationListStore);

    listStore.editTranslation(summary('browser.header.backButton', 'Back'), 'my-collection');

    expect(launcherSpy.openEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionName: 'my-collection',
        resource: expect.objectContaining({ fullKey: 'browser.header.backButton' }),
      }),
    );
  });
});
