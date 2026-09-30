import { provideHttpClient } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { createComponentFactory, type Spectator } from '@ngneat/spectator/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTranslocoTestingModule } from '../../../../testing/transloco-testing.module';
import { FolderTree } from './folder-tree';
import { BrowserStore } from '../../store/browser.store';
import { Subject } from 'rxjs';
import { of } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { toApiError } from '../../../shared/api-error/api-error';
import { BrowserApiService } from '../../services/browser-api.service';
import { collectionSettings } from '../../../../testing/collection-settings';
import type { CreateFolderResponseDto } from '@simoncodes-ca/data-transfer';
import { NotificationService } from '../../../shared/notification';

describe('FolderTree', () => {
  let component: FolderTree;
  let fixture: ComponentFixture<FolderTree>;
  let spectator: Spectator<FolderTree>;
  let httpMock: HttpTestingController;
  const dialog = { open: vi.fn() };

  beforeEach(() => dialog.open.mockReset());

  const createSpectator = createComponentFactory({
    component: FolderTree,
    imports: [getTranslocoTestingModule()],
    providers: [provideHttpClient(), provideHttpClientTesting(), { provide: MatDialog, useValue: dialog }],
    detectChanges: false,
  });

  afterEach(() => {
    httpMock.verify();
  });

  function createComponent(detectChanges = false): void {
    spectator = createSpectator();
    fixture = spectator.fixture;
    component = spectator.component;
    httpMock = spectator.inject(HttpTestingController);
    fixture.componentRef.setInput('collectionName', 'my-collection');
    if (detectChanges) {
      spectator.detectComponentChanges();
    }
  }

  function openCollection(name: string): void {
    const api = spectator.inject(BrowserApiService);
    vi.spyOn(api, 'getCacheStatus').mockReturnValue(of({ status: 'ready', stats: { totalKeys: 0, localeCount: 0 } }));
    vi.spyOn(api, 'getResourceTree').mockReturnValue(of({ path: '', resources: [], children: [] }));
    component.store.openCollection(collectionSettings({ name, locales: [] }));
  }

  function showCreateFailure(): void {
    const failure = toApiError(new HttpErrorResponse({ status: 409, error: { message: 'Already exists' } }));
    vi.spyOn(component.store, 'createFolder').mockReturnValue(of({ kind: 'refused', error: failure }));
    component.onFolderConfirm('new', 'common');
    expect(component.folderWriteError()).toBe('Already exists');
  }

  it('should create', () => {
    createComponent();
    expect(component).toBeTruthy();
  });

  it('should accept collectionName input', () => {
    createComponent();
    fixture.componentRef.setInput('collectionName', 'my-collection');
    expect(component.collectionName()).toBe('my-collection');
  });

  it('should stay disabled when mounted mid-search (re-entering the collection)', () => {
    createComponent();
    const store = spectator.inject(BrowserStore);
    store.showQuery('save');

    fixture.componentRef.setInput('collectionName', 'my-collection');
    spectator.detectComponentChanges();

    expect(store.isDisabled()).toBe(true);
    expect(spectator.query('.folder-tree')?.classList.contains('disabled')).toBe(true);
  });

  it('should emit folderSelected when folder is clicked', () => {
    createComponent();
    const emitSpy = vi.fn();
    component.folderSelected.subscribe(emitSpy);

    component.onFolderClick({
      name: 'common',
      fullPath: 'common',
      loaded: false,
    });

    expect(emitSpy).toHaveBeenCalledWith('common');

    // No HTTP call needed for this test
  });

  it('should not load folders on init (delegated to parent)', () => {
    createComponent();
    fixture.componentRef.setInput('collectionName', 'my-collection');

    // detectChanges triggers ngOnInit
    fixture.detectChanges();

    // FolderTree no longer loads on init - parent TranslationBrowser handles store initialization
    // Verify no HTTP requests are made
    httpMock.expectNone((request) => {
      return request.url.includes('/api/collections/my-collection/resources/tree');
    });
  });

  it('should render search input', async () => {
    createComponent();
    fixture.componentRef.setInput('collectionName', 'my-collection');
    fixture.detectChanges();

    // No HTTP request on init anymore
    // Wait for async operations to complete
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement;
    const searchInput = compiled.querySelector('input[type="text"]');

    expect(searchInput).toBeTruthy();
    expect(searchInput?.getAttribute('placeholder')).toBe('Filter folders...');
  });

  it('should debounce search input', async () => {
    vi.useFakeTimers();

    createComponent();
    fixture.componentRef.setInput('collectionName', 'my-collection');

    const setSpy = vi.spyOn(component.store, 'setFolderTreeFilter');

    fixture.detectChanges();

    // No HTTP request on init anymore

    component.onSearchChange('c');
    await vi.advanceTimersByTimeAsync(100);
    expect(setSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);
    expect(setSpy).toHaveBeenCalledWith('c');

    vi.useRealTimers();
  });

  it('opens the move confirmation and calls the store only when confirmed', async () => {
    createComponent();
    const closed = new Subject<boolean>();
    dialog.open.mockReturnValue({ afterClosed: () => closed.asObservable() });
    const move = vi.spyOn(component.store, 'moveFolder').mockReturnValue(of({ kind: 'no-collection' }));

    component.confirmMoveFolder('common.buttons', 'errors');
    await vi.waitFor(() => expect(dialog.open).toHaveBeenCalled());
    expect(dialog.open.mock.calls.at(-1)?.[1]).toEqual({
      width: '400px',
      data: {
        title: 'Move Folder',
        message: 'Move folder "buttons" and all its contents to "errors"?',
        confirmButtonText: 'Move',
        actionType: 'standard',
      },
    });
    expect(move).not.toHaveBeenCalled();

    closed.next(false);
    closed.complete();
    expect(move).not.toHaveBeenCalled();

    const confirmed = new Subject<boolean>();
    dialog.open.mockReturnValue({ afterClosed: () => confirmed.asObservable() });
    component.confirmMoveFolder('common.buttons', 'errors');
    await vi.waitFor(() => expect(dialog.open).toHaveBeenCalledTimes(2));
    confirmed.next(true);
    confirmed.complete();
    await vi.waitFor(() =>
      expect(move).toHaveBeenCalledWith({ sourceFolderPath: 'common.buttons', destinationFolderPath: 'errors' }),
    );
  });

  it('opens delete confirmation and calls the store only when confirmed', async () => {
    createComponent();
    const closed = new Subject<boolean>();
    dialog.open.mockReturnValue({ afterClosed: () => closed.asObservable() });
    const remove = vi.spyOn(component.store, 'deleteFolder').mockReturnValue(of({ kind: 'no-collection' }));

    component.onDeleteFolder('common');
    await vi.waitFor(() => expect(dialog.open).toHaveBeenCalled());
    expect(dialog.open.mock.calls.at(-1)?.[1]).toEqual({
      width: '400px',
      data: {
        title: 'Delete Folder',
        message: 'Delete "common" and all its contents?',
        confirmButtonText: 'Delete',
        actionType: 'destructive',
      },
    });
    expect(remove).not.toHaveBeenCalled();
    closed.next(false);
    closed.complete();
    expect(remove).not.toHaveBeenCalled();

    const confirmed = new Subject<boolean>();
    dialog.open.mockReturnValue({ afterClosed: () => confirmed.asObservable() });
    component.onDeleteFolder('common');
    await vi.waitFor(() => expect(dialog.open).toHaveBeenCalledTimes(2));
    confirmed.next(true);
    confirmed.complete();
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith('common'));
  });

  it('handles a no-op folder move without confirmation and toasts once', () => {
    createComponent();
    openCollection('my-collection');
    const info = vi.spyOn(spectator.inject(NotificationService), 'info').mockImplementation(() => undefined);
    const move = vi.spyOn(spectator.inject(BrowserApiService), 'moveFolder');

    component.confirmMoveFolder('common.buttons', 'common.buttons');
    component.confirmMoveFolder('common.buttons', 'common');
    expect(dialog.open).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
    expect(move).not.toHaveBeenCalled();
  });

  it('does not write a folder move when confirmation is cancelled', async () => {
    createComponent();
    const closed = new Subject<boolean>();
    dialog.open.mockReturnValue({ afterClosed: () => closed.asObservable() });
    const move = vi.spyOn(component.store, 'moveFolder').mockReturnValue(of({ kind: 'no-collection' }));

    component.confirmMoveFolder('common.buttons', 'errors');

    await vi.waitFor(() => expect(dialog.open).toHaveBeenCalledOnce());
    closed.next(false);
    closed.complete();
    expect(move).not.toHaveBeenCalled();
  });

  it('passes the inline parent to the store and shows a create failure inline', () => {
    createComponent();
    const failure = toApiError(
      new HttpErrorResponse({
        status: 409,
        error: { message: 'Already exists' },
      }),
    );
    const create = vi.spyOn(component.store, 'createFolder').mockReturnValue(of({ kind: 'refused', error: failure }));
    component.store.startAddingFolder('common');

    component.onFolderConfirm('new', 'common');

    expect(create).toHaveBeenCalledWith('new', 'common');
    expect(component.folderWriteError()).toBe('Already exists');
    expect(component.store.isAddingFolder()).toBe(false);
    expect(component.store.error()).toBeNull();
  });

  it('cancels its own draft after a successful sidebar create', () => {
    createComponent();
    openCollection('my-collection');
    vi.spyOn(spectator.inject(BrowserApiService), 'createFolder').mockReturnValue(
      of({
        folderPath: 'common.new',
        created: true,
        folder: { name: 'new', fullPath: 'common.new', loaded: false },
      }),
    );
    component.store.startAddingFolder('common');

    component.onFolderConfirm('new', 'common');

    expect(component.store.isAddingFolder()).toBe(false);
    expect(component.store.addFolderParentPath()).toBeNull();
  });

  it('keeps the inline error and tree visible through an unrelated folder expand and load', async () => {
    createComponent();
    openCollection('my-collection');
    await vi.waitFor(() => expect(component.store.folderTreeLoaded()).toBe(true));
    showCreateFailure();
    fixture.detectChanges();
    expect(spectator.query('.folder-list')).toBeTruthy();
    expect(spectator.query('.error-container')).toBeTruthy();

    const previousTree = component.store.rootFolders();
    component.store.expandFolder('common');
    component.store.loadFolderChildren('common');
    await vi.waitFor(() => expect(component.store.rootFolders()).not.toBe(previousTree));
    fixture.detectChanges();

    expect(spectator.query('.folder-list')).toBeTruthy();
    expect(spectator.query('.error-container')).toBeTruthy();
    expect(component.folderWriteError()).toBe('Already exists');
  });

  it('clears an inline create error when a new draft starts through the store', () => {
    createComponent();
    openCollection('my-collection');
    showCreateFailure();

    component.store.startAddingFolder('common');

    expect(component.folderWriteError()).toBeNull();
    expect(component.store.isAddingFolder()).toBe(true);
  });

  it('clears an inline create error when the add-folder button starts a draft', () => {
    createComponent();
    openCollection('my-collection');
    showCreateFailure();

    component.onAddFolderButtonClick();

    expect(component.folderWriteError()).toBeNull();
    expect(component.store.isAddingFolder()).toBe(true);
  });

  it('clears an inline create error when a folder create succeeds elsewhere', () => {
    createComponent();
    openCollection('my-collection');
    showCreateFailure();
    vi.spyOn(component.store, 'createFolder').mockRestore();
    vi.spyOn(spectator.inject(BrowserApiService), 'createFolder').mockReturnValue(
      of({ folderPath: 'new', created: true, folder: { name: 'new', fullPath: 'new', loaded: false } }),
    );

    component.store.createFolder('new', null).subscribe();

    expect(component.folderWriteError()).toBeNull();
  });

  it('clears an inline create error on a collection switch and reopen', () => {
    createComponent();
    openCollection('my-collection');
    showCreateFailure();

    component.store.openCollection(collectionSettings({ name: 'other', locales: [] }));
    expect(component.folderWriteError()).toBeNull();
    component.store.openCollection(collectionSettings({ name: 'my-collection', locales: [] }));
    expect(component.folderWriteError()).toBeNull();
  });

  it('leaves adding mode when create returns null because no collection is open', () => {
    createComponent();
    const create = vi.spyOn(spectator.inject(BrowserApiService), 'createFolder');
    component.onFolderConfirm('new', 'common');

    expect(create).not.toHaveBeenCalled();
    expect(component.store.isAddingFolder()).toBe(false);
    expect(component.store.error()).toBeNull();
  });

  it('ignores a create success that arrives after another collection opens', () => {
    createComponent();
    openCollection('old');
    const pending = new Subject<CreateFolderResponseDto>();
    vi.spyOn(spectator.inject(BrowserApiService), 'createFolder').mockReturnValue(pending);
    component.store.startAddingFolder('common');
    component.onFolderConfirm('new', 'common');

    component.store.openCollection(collectionSettings({ name: 'new', locales: [] }));
    pending.next({
      folderPath: 'common.new',
      created: true,
      folder: { name: 'new', fullPath: 'common.new', loaded: false },
    });
    pending.complete();

    expect(component.store.selectedCollection()).toBe('new');
    expect(component.store.error()).toBeNull();
    expect(component.store.newlyCreatedFolderPath()).toBeNull();
    expect(component.store.isAddingFolder()).toBe(false);
  });

  it('ignores a create failure that arrives after another collection opens', () => {
    createComponent();
    openCollection('old');
    const pending = new Subject<CreateFolderResponseDto>();
    vi.spyOn(spectator.inject(BrowserApiService), 'createFolder').mockReturnValue(pending);
    component.store.startAddingFolder('common');
    component.onFolderConfirm('new', 'common');

    component.store.openCollection(collectionSettings({ name: 'new', locales: [] }));
    pending.error(
      toApiError(
        new HttpErrorResponse({
          status: 409,
          error: { message: 'Old failure' },
        }),
      ),
    );

    expect(component.store.selectedCollection()).toBe('new');
    expect(component.store.error()).toBeNull();
    expect(component.store.newlyCreatedFolderPath()).toBeNull();
    expect(component.store.isAddingFolder()).toBe(false);
  });

  describe('setNestedResources — toggle animation', () => {
    beforeEach(() => {
      createComponent();
      fixture.componentRef.setInput('collectionName', 'my-collection');
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should immediately set isNestedToggleFlipping to true', () => {
      component.setNestedResources(true);

      expect(component.isNestedToggleFlipping()).toBe(true);
    });

    it('should NOT call store.setNestedResources immediately', () => {
      const storeSpy = vi.spyOn(component.store, 'setNestedResources');

      component.setNestedResources(true);

      expect(storeSpy).not.toHaveBeenCalled();
    });

    it('should call store.setNestedResources with the correct value at the 125ms midpoint', async () => {
      const storeSpy = vi.spyOn(component.store, 'setNestedResources');

      component.setNestedResources(true);

      await vi.advanceTimersByTimeAsync(125);

      expect(storeSpy).toHaveBeenCalledWith(true);
    });

    it('should reset isNestedToggleFlipping to false after 250ms', async () => {
      component.setNestedResources(true);

      await vi.advanceTimersByTimeAsync(250);

      expect(component.isNestedToggleFlipping()).toBe(false);
    });

    it('should pass only the second call value to the store on rapid double-click', async () => {
      const storeSpy = vi.spyOn(component.store, 'setNestedResources');

      // First call — before midpoint, second call cancels it
      component.setNestedResources(true);
      await vi.advanceTimersByTimeAsync(50);

      // Second call overrides the pending mid-timeout
      component.setNestedResources(false);
      await vi.advanceTimersByTimeAsync(125);

      // Only the second call's value should reach the store
      expect(storeSpy).toHaveBeenCalledTimes(1);
      expect(storeSpy).toHaveBeenCalledWith(false);
    });
  });
});
