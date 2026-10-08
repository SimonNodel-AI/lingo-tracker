import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import type {
  CreateResourceDto,
  FolderNodeDto,
  ResourceSummaryDto,
  TranslationStatus,
} from '@simoncodes-ca/data-transfer';
import { isNeedsWorkStatus } from '@simoncodes-ca/domain';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRACKER_TOKENS } from '../../../../i18n-types/tracker-resources';
import { toApiError } from '../../../shared/api-error/api-error';
import type { ConfirmationSpec, ConfirmOptions } from '../../../shared/confirm';
import { feedbackText } from '../../feedback';
import { EditorSession, type TranslationEditorDialogData } from './editor-session';

// Presentation fakes keep wording tokens and decisions inspectable without an injector or DOM.
const translate = (token: string, params?: Record<string, string | number>): string =>
  params?.['folder'] ? `${token} ${params['folder']}` : token;

describe('EditorSession', () => {
  let session: EditorSession;
  const sessions: EditorSession[] = [];
  const dialogRef = { close: vi.fn() };
  const confirm = vi.fn<(spec: ConfirmationSpec, options?: ConfirmOptions) => Promise<boolean>>();
  const focus = vi.fn();
  const apiSpies = { createResource: vi.fn(), updateResource: vi.fn() };
  const rootFolders = signal<FolderNodeDto[]>([]);
  const browserFolderPath = signal('common.buttons');
  const entries = signal<ResourceSummaryDto[]>([]);
  const closedWith = () => dialogRef.close.mock.calls.at(-1)?.[0];
  const sentCreate = (): CreateResourceDto | undefined => apiSpies.createResource.mock.calls.at(-1)?.[1];
  const summary = (
    fullKey: string,
    baseValue: string,
    targets: Record<string, [string | undefined, TranslationStatus | undefined]> = {},
    extra: Partial<ResourceSummaryDto> = {},
  ): ResourceSummaryDto => {
    const segments = fullKey.split('.');
    const entryKey = segments.pop() ?? '';
    return {
      fullKey,
      folderPath: segments.join('.'),
      entryKey,
      base: { locale: 'en', value: baseValue },
      targets: Object.entries(targets).map(([locale, [value, status]]) => ({
        locale,
        value,
        status,
        needsWork: status === undefined || isNeedsWorkStatus(status),
        sameAsBase: (value?.trim() ?? '').length > 0 && value?.trim() === baseValue.trim(),
      })),
      tags: [],
      inheritedTags: [],
      ...extra,
    };
  };

  const createMockData = (mode: 'create' | 'edit', resource?: ResourceSummaryDto): TranslationEditorDialogData => ({
    mode,
    resource,
    collectionName: 'test-collection',
    folderPath: 'common.buttons',
    availableLocales: ['en', 'fr', 'de'],
    baseLocale: 'en',
  });

  const openSession = (data: TranslationEditorDialogData): void => {
    session = new EditorSession(data, {
      browser: {
        rootFolders,
        currentFolderPath: browserFolderPath,
        translations: entries,
        createResource: apiSpies.createResource,
        updateResource: apiSpies.updateResource,
      },
      config: signal(null),
      peek: {
        folderEntries: signal(new Map<string, readonly string[]>()),
        loadingFolders: signal(new Set<string>()),
        peekFolder: () => of(undefined),
      },
      similar: { suggestions: () => of({ kind: 'clear', searching: false }) },
      translate,
      activeLang: () => 'en',
      confirm,
      close: dialogRef.close,
      focus,
      feedbackText: (feedback) => feedbackText(feedback, translate),
      notifications: { success: vi.fn(), error: vi.fn() },
    });
    sessions.push(session);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    apiSpies.createResource.mockReturnValue(of({}));
    apiSpies.updateResource.mockReturnValue(of({}));
    confirm.mockReset().mockResolvedValue(true);
    rootFolders.set([]);
    entries.set([]);
    browserFolderPath.set('common.buttons');
    openSession(createMockData('create'));
  });
  afterEach(() => {
    sessions.splice(0).forEach((editor) => {
      editor.destroy();
    });
    vi.restoreAllMocks();
  });
  describe('Form Validation - Key Field', () => {
    it('should require key field', () => {
      session.form.controls.key.setValue('');
      expect(session.form.controls.key.hasError('required')).toBe(true);
    });
  });
  describe('Dotted Keys - Location Absorption', () => {
    it('should split a pasted full key into folder path and leaf', () => {
      session.form.controls.key.setValue('apps.common.buttons.ok');

      expect(session.form.controls.key.value).toBe('ok');
      expect(session.folderSegments().join('.')).toBe('apps.common.buttons');
      expect(session.form.controls.key.valid).toBe(true);
    });

    it('should extend the derived folder while the user keeps typing dots', () => {
      session.form.controls.key.setValue('apps.');
      expect(session.folderSegments().join('.')).toBe('apps');
      expect(session.form.controls.key.value).toBe('');

      session.form.controls.key.setValue('common.');
      expect(session.folderSegments().join('.')).toBe('apps.common');

      session.form.controls.key.setValue('ok');
      expect(session.folderSegments().join('.')).toBe('apps.common');
      expect(session.form.controls.key.value).toBe('ok');
    });

    it('should submit the absorbed folder as part of the full key', async () => {
      apiSpies.createResource.mockReturnValue(of({ entriesCreated: 1, created: true }));

      session.form.controls.key.setValue('apps.common.buttons.ok');
      session.form.controls.baseValue.setValue('OK');
      session.form.controls.comment.setValue('A comment');
      await session.onSubmit();

      expect(apiSpies.createResource).toHaveBeenCalledWith(
        'test-collection',
        expect.objectContaining({ key: 'apps.common.buttons.ok' }),
      );
    });

    it('should announce the move for screen readers', () => {
      session.form.controls.key.setValue('apps.common.ok');

      expect(session.locationAbsorbedMessage()).toContain('apps.common');
    });

    it('should not absorb dots in edit mode, where the key is readonly', async () => {
      const mockResource = summary('common.buttons.existing_key', 'Existing Value');
      openSession(createMockData('edit', mockResource));

      session.form.controls.key.setValue('apps.common.ok');

      expect(session.form.controls.key.value).toBe('apps.common.ok');
      expect(session.folderSegments().join('.')).toBe('common.buttons');
    });
  });
  describe('Form Validation - Base Value Field', () => {
    it('should require base value field', () => {
      session.form.controls.baseValue.setValue('');
      expect(session.form.controls.baseValue.hasError('required')).toBe(true);
    });

    it('should accept non-empty base value', () => {
      session.form.controls.baseValue.setValue('Test translation');
      expect(session.form.controls.baseValue.valid).toBe(true);
    });
  });
  describe('Form Submission', () => {
    it('should block submission when form is invalid', () => {
      session.form.controls.key.setValue('');
      session.form.controls.baseValue.setValue('');
      session.onSubmit();
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('should allow submission when form is valid', async () => {
      session.form.controls.key.setValue('test_key');
      session.form.controls.baseValue.setValue('Test Value');
      session.form.controls.comment.setValue('Test comment');

      await session.onSubmit();

      // In create mode, dialogRef.close is called after API success
      expect(dialogRef.close).toHaveBeenCalled();
      expect(closedWith()).toEqual({ kind: 'created', fullKey: 'common.buttons.test_key', skippedLocales: [] });
      expect(sentCreate()).toMatchObject({
        key: 'common.buttons.test_key',
        baseValue: 'Test Value',
        comment: 'Test comment',
      });
    });

    it('should exclude empty comment from result', async () => {
      // Empty comments require confirmation.
      // Accept Save Anyway.
      confirm.mockResolvedValue(true);

      session.form.controls.key.setValue('test_key');
      session.form.controls.baseValue.setValue('Test Value');
      session.form.controls.comment.setValue('   ');

      await session.onSubmit();

      expect(closedWith()?.kind).toBe('created');
      expect(sentCreate()?.comment).toBeUndefined();
    });

    it('should use empty string for folderPath when not provided', async () => {
      const dataWithoutFolder = createMockData('create');
      dataWithoutFolder.folderPath = undefined;
      openSession(dataWithoutFolder);

      session.form.controls.key.setValue('test_key');
      session.form.controls.baseValue.setValue('Test Value');
      session.form.controls.comment.setValue('Test comment'); // Add comment to skip confirmation
      await session.onSubmit();

      expect(closedWith()).toEqual({ kind: 'created', fullKey: 'test_key', skippedLocales: [] });
    });
  });
  describe('Dialog Interaction', () => {
    it('should close dialog on cancel when nothing has been edited', async () => {
      await session.onCancel();
      expect(dialogRef.close).toHaveBeenCalledWith({ kind: 'cancelled' });
    });

    it('should confirm before discarding unsaved edits', async () => {
      session.form.controls.baseValue.setValue('Half-written value');
      session.form.controls.baseValue.markAsDirty();

      // The confirmation fake accepts discard.
      await session.onCancel();

      expect(confirm).toHaveBeenCalled();
      expect(confirm).toHaveBeenCalledWith(
        {
          title: TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.UNSAVED.TITLE,
          message: TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.UNSAVED.MESSAGE,
          confirmButtonText: TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.UNSAVED.DISCARD,
          cancelButtonText: TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.UNSAVED.KEEPEDITING,
        },
        { width: '440px', disableClose: true },
      );
      expect(dialogRef.close).toHaveBeenCalledWith({ kind: 'cancelled' });
    });

    it('should keep the dialog open when the user chooses to keep editing', async () => {
      confirm.mockResolvedValue(false);
      session.form.controls.baseValue.setValue('Half-written value');
      session.form.controls.baseValue.markAsDirty();

      await session.onCancel();

      expect(dialogRef.close).not.toHaveBeenCalled();
    });
  });
  describe('Comment Confirmation Flow', () => {
    it('should save directly when comment is present', async () => {
      session.form.controls.key.setValue('test_key');
      session.form.controls.baseValue.setValue('Test Value');
      session.form.controls.comment.setValue('Test comment');

      await session.onSubmit();

      expect(confirm).not.toHaveBeenCalled();
      expect(dialogRef.close).toHaveBeenCalled();
      expect(closedWith()).toEqual({ kind: 'created', fullKey: 'common.buttons.test_key', skippedLocales: [] });
      expect(sentCreate()).toMatchObject({
        key: 'common.buttons.test_key',
        baseValue: 'Test Value',
        comment: 'Test comment',
      });
    });

    it('should show confirmation dialog when comment is empty', async () => {
      confirm.mockResolvedValue(true);

      session.form.controls.key.setValue('test_key');
      session.form.controls.baseValue.setValue('Test Value');
      session.form.controls.comment.setValue('');

      await session.onSubmit();

      expect(confirm).toHaveBeenCalledWith(
        {
          title: TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.COMMENTCONFIRM.TITLE,
          message: TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.COMMENTCONFIRM.MESSAGE,
          confirmButtonText: TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.COMMENTCONFIRM.SAVEANYWAY,
          cancelButtonText: TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.COMMENTCONFIRM.ADDCOMMENT,
        },
        { width: '400px', disableClose: true },
      );
    });

    it('should show confirmation dialog when comment is whitespace only', async () => {
      confirm.mockResolvedValue(true);

      session.form.controls.key.setValue('test_key');
      session.form.controls.baseValue.setValue('Test Value');
      session.form.controls.comment.setValue('   ');

      await session.onSubmit();

      expect(confirm).toHaveBeenCalled();
    });

    it('should complete save when user clicks "Save Anyway"', async () => {
      confirm.mockResolvedValue(true);

      session.form.controls.key.setValue('test_key');
      session.form.controls.baseValue.setValue('Test Value');
      session.form.controls.comment.setValue('');

      await session.onSubmit();

      expect(dialogRef.close).toHaveBeenCalled();
      expect(closedWith()?.kind).toBe('created');
      expect(sentCreate()).toMatchObject({ key: 'common.buttons.test_key', baseValue: 'Test Value' });
      expect(sentCreate()?.comment).toBeUndefined();
    });

    it('should not save when user clicks "Add Comment"', async () => {
      confirm.mockResolvedValue(false);

      session.form.controls.key.setValue('test_key');
      session.form.controls.baseValue.setValue('Test Value');
      session.form.controls.comment.setValue('');

      await session.onSubmit();

      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('should not save when user cancels confirmation dialog', async () => {
      // A cancelled confirmation resolves false at the confirmation seam.
      confirm.mockResolvedValue(false);

      session.form.controls.key.setValue('test_key');
      session.form.controls.baseValue.setValue('Test Value');
      session.form.controls.comment.setValue('');

      await session.onSubmit();

      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('should ignore another save after Save Anyway has completed', async () => {
      confirm.mockResolvedValue(true);

      session.form.controls.key.setValue('test_key');
      session.form.controls.baseValue.setValue('Test Value');
      session.form.controls.comment.setValue('');

      await session.onSubmit();

      expect(confirm).toHaveBeenCalledTimes(1);

      dialogRef.close.mockClear();
      confirm.mockClear();
      await session.onSubmit();

      expect(confirm).not.toHaveBeenCalled();
      expect(dialogRef.close).not.toHaveBeenCalled();
      expect(apiSpies.createResource).toHaveBeenCalledTimes(1);
    });

    it('should remember Save Anyway when a refused write is retried', async () => {
      confirm.mockResolvedValue(true);
      apiSpies.createResource
        .mockReturnValueOnce(throwError(() => toApiError(new HttpErrorResponse({ status: 503 }))))
        .mockReturnValueOnce(of({ entriesCreated: 1, created: true }));
      session.form.controls.key.setValue('test_key');
      session.form.controls.baseValue.setValue('Test Value');
      session.form.controls.comment.setValue('');

      await session.onSubmit();
      expect(session.errorMessage()).toBe(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.ERROR.CREATEFAILED);
      expect(dialogRef.close).not.toHaveBeenCalled();

      await session.onSubmit();
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(apiSpies.createResource).toHaveBeenCalledTimes(2);
      expect(closedWith()).toEqual({ kind: 'created', fullKey: 'common.buttons.test_key', skippedLocales: [] });
    });

    it('should allow showing confirmation again if user cancelled previously', async () => {
      confirm.mockResolvedValue(false);

      session.form.controls.key.setValue('test_key');
      session.form.controls.baseValue.setValue('Test Value');
      session.form.controls.comment.setValue('');

      await session.onSubmit();

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(dialogRef.close).not.toHaveBeenCalled();

      confirm.mockClear();
      confirm.mockResolvedValue(true);

      await session.onSubmit();

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(dialogRef.close).toHaveBeenCalled();
    });
  });
  describe('Location popover', () => {
    it('should stage a folder without committing it', () => {
      session.panels.openFolderPopover();
      session.panels.stageFolder('common.errors');

      expect(session.panels.stagedFolderPath()).toBe('common.errors');
      expect(session.folderSegments().join('.')).toBe('common.buttons');
      expect(session.popoverFolderPath()).toBe('common.errors');
    });

    it('should commit the staged folder and close on confirm', () => {
      session.panels.openFolderPopover();
      session.panels.stageFolder('common.errors');

      session.confirmStagedFolder();

      expect(session.folderSegments().join('.')).toBe('common.errors');
      expect(session.panels.isFolderPopoverOpen()).toBe(false);
      expect(session.panels.stagedFolderPath()).toBeNull();
    });

    it('should select and stage a newly created folder', () => {
      session.form.controls.key.setValue('a.');
      session.panels.openFolderPopover();

      session.onFolderCreated({ name: 'new', fullPath: 'common.new', loaded: false });

      expect(session.folderSegments().join('.')).toBe('common.new');
      expect(session.panels.stagedFolderPath()).toBe('common.new');
      expect(session.popoverFolderPath()).toBe('common.new');

      session.panels.closeFolderPopover();
      session.form.controls.key.setValue('b.ok');
      expect(session.folderSegments().join('.')).toBe('b');
    });

    it('should keep the current folder when nothing was staged', () => {
      session.panels.openFolderPopover();

      session.confirmStagedFolder();

      expect(session.folderSegments().join('.')).toBe('common.buttons');
      expect(session.panels.isFolderPopoverOpen()).toBe(false);
    });

    it('should dismiss the popover instead of the dialog on cancel', async () => {
      session.panels.openFolderPopover();

      await session.onCancel();

      expect(session.panels.isFolderPopoverOpen()).toBe(false);
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('should not open the popover in a read-only collection', () => {
      openSession({ ...createMockData('create'), readOnly: true });

      session.panels.toggleFolderPopover();

      expect(session.panels.isFolderPopoverOpen()).toBe(false);
    });
  });
  describe('Other locales drawer', () => {
    it('should dismiss the drawer instead of the dialog on cancel', async () => {
      session.panels.openLocalesDrawer();

      await session.onCancel();

      expect(session.panels.isLocalesDrawerOpen()).toBe(false);
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('should not open when the collection has only the base locale', () => {
      openSession({ ...createMockData('create'), availableLocales: ['en'] });

      session.panels.openLocalesDrawer();

      expect(session.panels.isLocalesDrawerOpen()).toBe(false);
    });
  });
  describe('Create errors from the server', () => {
    it('should show the unexpected-error token for a non-API failure', async () => {
      apiSpies.createResource.mockReturnValue(throwError(() => new Error('Unexpected')));
      session.form.controls.key.setValue('ok');
      session.form.controls.baseValue.setValue('OK');
      session.form.controls.comment.setValue('A comment');

      await session.onSubmit();

      expect(session.errorMessage()).toBe(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.ERROR.UNEXPECTED);
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('should open the conflict dialog and set shouldOpenEdit/existingResourceKey on a server-side 409', async () => {
      apiSpies.createResource.mockReturnValue(
        throwError(() =>
          toApiError(
            new HttpErrorResponse({
              status: 409,
              statusText: 'Conflict',
              error: { statusCode: 409, message: 'Resource already exists: common.buttons.ok' },
            }),
          ),
        ),
      );
      confirm.mockResolvedValue(true);

      session.form.controls.key.setValue('ok');
      session.form.controls.baseValue.setValue('OK');
      session.form.controls.comment.setValue('The affirmative button');

      await session.onSubmit();

      await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
      await vi.waitFor(() => expect(closedWith()).toEqual({ kind: 'open-existing', fullKey: 'common.buttons.ok' }));
    });

    it('should show the server message for a 400 the API rejected as invalid', async () => {
      apiSpies.createResource.mockReturnValue(
        throwError(() =>
          toApiError(
            new HttpErrorResponse({
              status: 400,
              statusText: 'Bad Request',
              error: { statusCode: 400, message: 'Invalid resource key' },
            }),
          ),
        ),
      );

      session.form.controls.key.setValue('ok');
      session.form.controls.baseValue.setValue('OK');
      session.form.controls.comment.setValue('A comment');

      await session.onSubmit();

      expect(session.errorMessage()).toBe('Invalid resource key');
      expect(dialogRef.close).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
    });

    it('should fall back to the create-failed message for a network failure, which carries no server message', async () => {
      apiSpies.createResource.mockReturnValue(
        throwError(() => toApiError(new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') }))),
      );

      session.form.controls.key.setValue('ok');
      session.form.controls.baseValue.setValue('OK');
      session.form.controls.comment.setValue('A comment');

      await session.onSubmit();

      expect(session.errorMessage()).toBe(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.ERROR.CREATEFAILED);
      expect(dialogRef.close).not.toHaveBeenCalled();
    });
  });
  describe('Edit Mode API Integration', () => {
    it('should show the missing-resource token when an edit has no original entry', async () => {
      openSession(createMockData('edit'));
      session.form.controls.key.setValue('ok');
      session.form.controls.baseValue.setValue('OK');
      session.form.controls.comment.setValue('A comment');

      await session.onSubmit();

      expect(session.errorMessage()).toBe(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.ERROR.MISSINGRESOURCE);
      expect(apiSpies.updateResource).not.toHaveBeenCalled();
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('should show the update-failed token for an update API error without a server message', async () => {
      apiSpies.updateResource.mockReturnValue(throwError(() => toApiError(new HttpErrorResponse({ status: 503 }))));
      openSession(createMockData('edit', summary('common.buttons.ok', 'OK', {}, { comment: 'A comment' })));

      await session.onSubmit();

      expect(session.errorMessage()).toBe(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.ERROR.UPDATEFAILED);
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('should show the invalid-request token for an update API error without a server message', async () => {
      apiSpies.updateResource.mockReturnValue(throwError(() => toApiError(new HttpErrorResponse({ status: 400 }))));
      openSession(createMockData('edit', summary('common.buttons.ok', 'OK', {}, { comment: 'A comment' })));

      await session.onSubmit();

      expect(session.errorMessage()).toBe(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.ERROR.INVALIDREQUEST);
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('should call updateResource API when submitting in edit mode', async () => {
      const mockResource = summary(
        'common.buttons.existing_key',
        'Existing Value',
        { fr: ['Valeur existante', 'translated'] },
        { comment: 'Existing comment' },
      );

      const editData = createMockData('edit', mockResource);
      apiSpies.updateResource.mockReturnValue(of({ resolvedKey: 'common.buttons.existing_key', updated: true }));
      openSession(editData);

      session.form.controls.baseValue.setValue('Updated Value');
      session.form.controls.comment.setValue('Updated comment');

      await session.onSubmit();

      expect(apiSpies.updateResource).toHaveBeenCalledWith(
        'test-collection',
        expect.objectContaining({
          key: 'common.buttons.existing_key',
          baseValue: 'Updated Value',
          comment: 'Updated comment',
        }),
      );
      expect(dialogRef.close).toHaveBeenCalled();
    });

    it('should include translations in update API call', async () => {
      const mockResource = summary('common.buttons.existing_key', 'Existing Value', {
        fr: ['Valeur existante', 'translated'],
      });

      const editData = createMockData('edit', mockResource);
      apiSpies.updateResource.mockReturnValue(of({ resolvedKey: 'common.buttons.existing_key', updated: true }));
      openSession(editData);

      const translationsArray = session.form.controls.translations;
      const frControl = translationsArray.controls.find((c) => c.value.locale === 'fr');
      frControl?.patchValue({ value: 'Nouvelle valeur' });

      await session.onSubmit();

      expect(apiSpies.updateResource).toHaveBeenCalledWith(
        'test-collection',
        expect.objectContaining({
          locales: {
            fr: { value: 'Nouvelle valeur', status: 'translated' },
          },
        }),
      );
    });

    it('should handle update API errors', async () => {
      const mockResource = summary('common.buttons.existing_key', 'Existing Value');

      const editData = createMockData('edit', mockResource);
      apiSpies.updateResource.mockReturnValue(
        throwError(() =>
          toApiError(
            new HttpErrorResponse({
              status: 404,
              statusText: 'Not Found',
              error: { message: 'Resource not found' },
            }),
          ),
        ),
      );
      openSession(editData);

      await session.onSubmit();

      expect(session.errorMessage()).toBe(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.ERROR.NOTFOUND);
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('should close dialog with success result on successful update', async () => {
      const mockResource = summary(
        'common.buttons.existing_key',
        'Existing Value',
        { fr: ['Valeur existante', 'translated'] },
        { comment: 'Existing comment' },
      );

      const editData = createMockData('edit', mockResource);
      apiSpies.updateResource.mockReturnValue(of({ resolvedKey: 'common.buttons.existing_key', updated: true }));
      openSession(editData);

      session.form.controls.baseValue.setValue('Updated Value');

      await session.onSubmit();

      expect(closedWith()).toEqual({ kind: 'saved', fullKey: 'common.buttons.existing_key', skippedLocales: [] });
      expect(apiSpies.updateResource.mock.calls.at(-1)?.[1]).toMatchObject({
        key: 'common.buttons.existing_key',
        baseValue: 'Updated Value',
      });
    });
  });

  it('should publish the absorbed leaf and folder to collision and key preview', () => {
    entries.set([summary('a.b.c', 'Existing value')]);
    browserFolderPath.set('a.b');

    session.form.controls.key.setValue('a.b.c');

    expect(session.form.controls.key.value).toBe('c');
    expect(session.folderSegments().join('.')).toBe('a.b');
    expect(session.fullKeyPreview()).toBe('a.b.c');
    expect(session.keyCollision()).toBe(true);
  });

  it('should dismiss the popover before the drawer before the dialog', async () => {
    session.panels.openLocalesDrawer();
    session.panels.openFolderPopover();

    await session.onCancel();
    expect(session.panels.isFolderPopoverOpen()).toBe(false);
    expect(session.panels.isLocalesDrawerOpen()).toBe(true);

    await session.onCancel();
    expect(session.panels.isLocalesDrawerOpen()).toBe(false);
    expect(dialogRef.close).not.toHaveBeenCalled();

    await session.onCancel();
    expect(dialogRef.close).toHaveBeenCalled();
  });

  it('reveals validation after closing covering panels and focuses the invalid field', async () => {
    session.panels.openLocalesDrawer();
    session.panels.openFolderPopover();
    await session.onSubmit();
    expect(session.submitAttempted()).toBe(true);
    expect(session.form.controls.key.touched).toBe(true);
    expect(session.form.controls.baseValue.touched).toBe(true);
    expect(session.errorMessage()).toBe(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.FIXERRORS);
    expect(session.panels.isFolderPopoverOpen()).toBe(false);
    expect(session.panels.isLocalesDrawerOpen()).toBe(false);
    expect(focus).toHaveBeenCalledExactlyOnceWith('key');
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('focuses the base value when the key is valid', async () => {
    session.form.controls.key.setValue('valid');
    await session.onSubmit();
    expect(focus).toHaveBeenCalledExactlyOnceWith('base-value');
  });

  it('requests comment focus after a refused comment confirmation', async () => {
    confirm.mockResolvedValue(false);
    session.form.patchValue({ key: 'valid', baseValue: 'Value' });
    await session.onSubmit();
    expect(session.panels.focusRequest()?.target).toBe('comment');
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('restarts the absorption highlight delay and releases pending work on destroy', () => {
    vi.useFakeTimers();
    try {
      session.form.controls.key.setValue('first.key');
      vi.advanceTimersByTime(20);
      expect(session.locationAbsorbedFlash()).toBe(true);
      vi.advanceTimersByTime(800);
      session.form.controls.key.setValue('second.key');
      vi.advanceTimersByTime(100);
      expect(session.locationAbsorbedFlash()).toBe(true);
      vi.advanceTimersByTime(800);
      expect(session.locationAbsorbedFlash()).toBe(false);
      session.form.controls.key.setValue('third.key');
      session.destroy();
      vi.runAllTimers();
      expect(session.locationAbsorbedFlash()).toBe(false);
      session.form.controls.key.setValue('unchanged.key');
      expect(session.form.controls.key.value).toBe('unchanged.key');
    } finally {
      vi.useRealTimers();
    }
  });

  it('guards an existing-entry hand-off with the same discard decision', async () => {
    session.form.controls.key.setValue('existing');
    session.form.controls.baseValue.markAsDirty();
    confirm.mockResolvedValue(false);
    await session.openExistingResource();
    expect(dialogRef.close).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    await session.openExistingResource();
    expect(dialogRef.close).toHaveBeenCalledExactlyOnceWith({
      kind: 'open-existing',
      fullKey: 'common.buttons.existing',
    });
  });

  it('counts folder and tag edits as unsaved work without a dirty form field', () => {
    expect(session.hasUnsavedChanges()).toBe(false);
    session.onFolderConfirmed('destination');
    expect(session.hasUnsavedChanges()).toBe(true);
    session.onFolderConfirmed('common.buttons');
    expect(session.hasUnsavedChanges()).toBe(false);
    session.addTagValue('new-tag');
    expect(session.hasUnsavedChanges()).toBe(true);
    session.removeTag('new-tag');
    expect(session.hasUnsavedChanges()).toBe(false);
  });

  it('locks a read-only form and closes it without a discard prompt or write', async () => {
    openSession({ ...createMockData('create'), readOnly: true });
    session.form.controls.baseValue.markAsDirty();
    expect(session.form.disabled).toBe(true);
    expect(session.hasUnsavedChanges()).toBe(false);
    await session.onSubmit();
    expect(apiSpies.createResource).not.toHaveBeenCalled();
    await session.onCancel();
    expect(confirm).not.toHaveBeenCalled();
    expect(dialogRef.close).toHaveBeenCalledExactlyOnceWith({ kind: 'cancelled' });
  });
});
