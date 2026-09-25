import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { patchState } from '@ngrx/signals';
import { unprotected } from '@ngrx/signals/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { getTranslocoTestingModule } from '../../../testing/transloco-testing.module';
import { NotificationService } from '../../shared/notification';
import { BrowserStore } from '../store/browser.store';
import { BrowserApiService } from './browser-api.service';
import { TRANSLATION_EDITOR_TITLE_ID } from '../dialogs/translation-editor';
import { TranslationEditorLauncher } from './translation-editor-launcher';
import type { ResourceSummaryDto } from '@simoncodes-ca/data-transfer';

describe('TranslationEditorLauncher', () => {
  let launcher: TranslationEditorLauncher;
  let store: InstanceType<typeof BrowserStore>;
  let mockDialog: { open: Mock };
  let mockApi: { getResourceTree: Mock };
  let notifications: { success: Mock; info: Mock; warning: Mock; error: Mock };

  const resource: ResourceSummaryDto = {
    fullKey: 'browser.header.backButton',
    folderPath: 'browser.header',
    entryKey: 'backButton',
    base: { locale: 'en', value: 'Back' },
    targets: [{ locale: 'fr', needsWork: true, sameAsBase: false }],
    tags: [],
    inheritedTags: [],
  };

  beforeEach(() => {
    mockDialog = { open: vi.fn().mockReturnValue({ afterClosed: () => of(undefined) }) };
    mockApi = {
      getResourceTree: vi.fn().mockReturnValue(of({ path: 'browser.header', resources: [resource], children: [] })),
    };
    notifications = { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() };

    TestBed.configureTestingModule({
      imports: [getTranslocoTestingModule()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatDialog, useValue: mockDialog },
        { provide: BrowserApiService, useValue: mockApi },
        { provide: NotificationService, useValue: notifications },
      ],
    });

    launcher = TestBed.inject(TranslationEditorLauncher);
    store = TestBed.inject(BrowserStore);
    patchState(unprotected(store), { availableLocales: ['en', 'fr'], baseLocale: 'en' });
  });

  describe('openByFullKey', () => {
    it('should open the editor in edit mode on the entry the key names', () => {
      launcher.openByFullKey('browser.header.backButton', 'test-collection');

      expect(mockApi.getResourceTree).toHaveBeenCalledWith('test-collection', 'browser.header', false);
      expect(mockDialog.open).toHaveBeenCalledTimes(1);

      const config = mockDialog.open.mock.calls[0][1];
      expect(config.data).toMatchObject({
        mode: 'edit',
        collectionName: 'test-collection',
        folderPath: 'browser.header',
        resource: { fullKey: 'browser.header.backButton', entryKey: 'backButton' },
      });
      expect(config.panelClass).toBe('translation-editor-dialog-panel');
      expect(config.ariaLabelledBy).toBe(TRANSLATION_EDITOR_TITLE_ID);
    });

    it('should move the browser to the folder the entry lives in', () => {
      launcher.openByFullKey('browser.header.backButton', 'test-collection');

      expect(store.currentFolderPath()).toBe('browser.header');
    });

    it('should leave search mode before navigating, so the list matches the dialog', () => {
      patchState(unprotected(store), { isSearchMode: true, searchQuery: 'back' });

      launcher.openByFullKey('browser.header.backButton', 'test-collection');

      expect(store.isSearchMode()).toBe(false);
    });

    it('should resolve a root-level key against the collection root', () => {
      mockApi.getResourceTree.mockReturnValue(
        of({ path: '', resources: [{ ...resource, fullKey: 'backButton', folderPath: '' }], children: [] }),
      );

      launcher.openByFullKey('backButton', 'test-collection');

      expect(mockApi.getResourceTree).toHaveBeenCalledWith('test-collection', '', false);
      expect(mockDialog.open).toHaveBeenCalledTimes(1);
    });

    it('should report a key the folder no longer holds instead of opening an empty editor', () => {
      mockApi.getResourceTree.mockReturnValue(of({ path: 'browser.header', resources: [], children: [] }));

      launcher.openByFullKey('browser.header.backButton', 'test-collection');

      expect(mockDialog.open).not.toHaveBeenCalled();
      expect(notifications.error).toHaveBeenCalledWith('Resource not found. It may have been deleted.');
    });

    it('should report a failed lookup the same way', () => {
      mockApi.getResourceTree.mockReturnValue(throwError(() => new Error('boom')));

      launcher.openByFullKey('browser.header.backButton', 'test-collection');

      expect(mockDialog.open).not.toHaveBeenCalled();
      expect(notifications.error).toHaveBeenCalledWith('Resource not found. It may have been deleted.');
    });
  });

  describe('openEditor', () => {
    const savedInto = (folderPath: string) => ({
      afterClosed: () =>
        of({
          key: 'backButton',
          baseValue: 'Back',
          folderPath,
          success: true,
          resource: { ...resource, base: { locale: 'en', value: 'Go back' } },
        }),
    });

    // The save itself, and the cache patch that follows it, belong to
    // BrowserStore.updateResource; the launcher only reports on it.
    it('should flash the row under its full key and confirm the save', () => {
      patchState(unprotected(store), { translations: [resource] });
      const onUpdated = vi.fn();
      mockDialog.open.mockReturnValue(savedInto('browser.header'));

      launcher.openEditor({
        resource,
        collectionName: 'test-collection',
        onUpdated,
      });

      expect(onUpdated).toHaveBeenCalledWith('browser.header.backButton');
      expect(notifications.success).toHaveBeenCalled();
      expect(store.translations()).toEqual([resource]);
    });

    it('should stay quiet when the entry was saved into another folder', () => {
      const onUpdated = vi.fn();
      mockDialog.open.mockReturnValue(savedInto('browser.footer'));

      launcher.openEditor({
        resource,
        collectionName: 'test-collection',
        onUpdated,
      });

      expect(onUpdated).not.toHaveBeenCalled();
      expect(notifications.success).not.toHaveBeenCalled();
    });
  });
});
