import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { createComponentFactory, type Spectator } from '@ngneat/spectator/vitest';
import type { LingoTrackerConfigDto } from '@simoncodes-ca/data-transfer';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTranslocoTestingModule } from '../../../testing/transloco-testing.module';
import { toApiError } from '../../shared/api-error/api-error';
import { CollectionsStore } from '../store/collections.store';
import { CollectionFormDialog } from './collection-form-dialog';
import type { CollectionFormDialogData } from './collection-form-dialog-data';

const savedConfig: LingoTrackerConfigDto = {
  exportFolder: 'dist/export',
  importFolder: 'dist/import',
  baseLocale: 'en',
  locales: ['en'],
  collections: { 'my-collection': { translationsFolder: './i18n' } },
};

const createComponent = createComponentFactory({
  component: CollectionFormDialog,
  imports: [NoopAnimationsModule, getTranslocoTestingModule()],
  detectChanges: false,
});

/** The one `MatDialog` method the form uses: `open`, for the base-locale-change confirmation. */
type DialogMock = { open: ReturnType<typeof vi.fn> };

/** The two Config Writes the dialog makes; both accept by default. */
type StoreMock = { createCollection: ReturnType<typeof vi.fn>; updateCollection: ReturnType<typeof vi.fn> };

/** `close`, and `disableClose`, which the dialog sets while a write is in flight. */
type DialogRefMock = { close: ReturnType<typeof vi.fn>; disableClose: boolean | undefined };

const apiError = (status: number, body: object) =>
  toApiError(new HttpErrorResponse({ status, error: { statusCode: status, ...body } }));

const rejection = (status: number, body: object) =>
  throwError(() => toApiError(new HttpErrorResponse({ status, error: { statusCode: status, ...body } })));

const buildHarness = (
  data: CollectionFormDialogData,
  mockDialog: DialogMock = { open: vi.fn() },
): {
  fixture: ComponentFixture<CollectionFormDialog>;
  spectator: Spectator<CollectionFormDialog>;
  mockDialogRef: DialogRefMock;
  mockDialog: DialogMock;
  store: StoreMock;
} => {
  const mockDialogRef: DialogRefMock = { close: vi.fn(), disableClose: false };
  const store: StoreMock = {
    createCollection: vi.fn(() => of(savedConfig)),
    updateCollection: vi.fn(() => of(savedConfig)),
  };
  const spectator = createComponent({
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: mockDialogRef },
      { provide: MatDialog, useValue: mockDialog },
      { provide: CollectionsStore, useValue: store },
    ],
  });
  spectator.detectChanges();
  return { fixture: spectator.fixture, spectator, mockDialogRef, mockDialog, store };
};

describe('CollectionFormDialog — create mode', () => {
  let fixture: ComponentFixture<CollectionFormDialog>;
  let component: CollectionFormDialog;
  let mockDialogRef: DialogRefMock;
  let store: StoreMock;

  beforeEach(async () => {
    ({ fixture, mockDialogRef, store } = buildHarness({ mode: 'create' }));
    component = fixture.componentInstance;
  });

  const fillValidForm = (): void => {
    component.form.controls.name.setValue('my-collection');
    component.form.controls.translationsFolder.setValue('./i18n');
    component.addLocaleInput.setValue('en');
    component.addLocale();
  };

  const submitError = (): string | null =>
    (fixture.nativeElement as HTMLElement).querySelector('[data-testid="submit-error"] span')?.textContent?.trim() ??
    null;

  /** Cancel in the footer and the close icon in the header. */
  const closeButtons = (): HTMLButtonElement[] =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('[data-testid="cancel"]'));

  describe('writing through the store', () => {
    it('should create the collection through the store and close only once the server has accepted it', async () => {
      fillValidForm();

      await component.onSubmit();

      expect(store.createCollection).toHaveBeenCalledWith({
        name: 'my-collection',
        collection: expect.objectContaining({ translationsFolder: './i18n', locales: ['en'], baseLocale: 'en' }),
      });
      expect(mockDialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ name: 'my-collection' }));
    });

    it('should stay open on a taken name and show the conflict on the name field until it is edited', async () => {
      store.createCollection.mockReturnValue(
        rejection(409, { message: 'Collection "my-collection" already exists', error: 'Conflict' }),
      );
      fillValidForm();

      await component.onSubmit();
      fixture.detectChanges();

      expect(mockDialogRef.close).not.toHaveBeenCalled();
      expect(component.saving()).toBe(false);
      expect(component.showNameConflict).toBe(true);
      expect(fixture.nativeElement.textContent).toContain('A collection named my-collection already exists.');
      expect(submitError()).toBeNull();

      component.form.controls.name.setValue('other');

      expect(component.showNameConflict).toBe(false);
      expect(component.form.controls.name.valid).toBe(true);
    });

    it('should stay open and show any other refusal above the buttons, keeping what was typed', async () => {
      store.createCollection.mockReturnValue(
        rejection(400, { message: 'collection.translationsFolder must be a string', error: 'Bad Request' }),
      );
      fillValidForm();

      await component.onSubmit();
      fixture.detectChanges();

      expect(mockDialogRef.close).not.toHaveBeenCalled();
      expect(submitError()).toBe('collection.translationsFolder must be a string');
      expect(component.form.controls.name.value).toBe('my-collection');
      expect(component.form.controls.name.valid).toBe(true);
    });

    it('should fall back to the create-failed text for a refusal without a message', async () => {
      store.createCollection.mockReturnValue(rejection(500, { error: 'Internal Server Error' }));
      fillValidForm();

      await component.onSubmit();
      fixture.detectChanges();

      expect(submitError()).toBe('Failed to create collection');
    });

    it('should clear the previous refusal and disable the button while the next submit is in flight', async () => {
      store.createCollection.mockReturnValueOnce(rejection(400, { message: 'nope', error: 'Bad Request' }));
      fillValidForm();
      await component.onSubmit();
      fixture.detectChanges();
      expect(submitError()).toBe('nope');

      await component.onSubmit();
      fixture.detectChanges();

      expect(submitError()).toBeNull();
      expect(mockDialogRef.close).toHaveBeenCalledTimes(1);
    });

    it('should clear a refusal on the next edit', async () => {
      store.createCollection.mockReturnValue(rejection(400, { message: 'nope', error: 'Bad Request' }));
      fillValidForm();
      await component.onSubmit();
      expect(component.submitError()).toBe('nope');

      component.form.controls.translationsFolder.setValue('./other');

      expect(component.submitError()).toBeNull();
    });

    it('should not let the dialog close while the write is in flight, and allow it again after a refusal', async () => {
      const write = new Subject<LingoTrackerConfigDto | null>();
      store.createCollection.mockReturnValue(write);
      fillValidForm();

      await component.onSubmit();
      fixture.detectChanges();

      expect(mockDialogRef.disableClose).toBe(true);
      expect(closeButtons().every((button) => button.disabled)).toBe(true);

      write.error(apiError(400, { message: 'nope', error: 'Bad Request' }));
      fixture.detectChanges();

      expect(mockDialogRef.disableClose).toBe(false);
      expect(closeButtons().some((button) => button.disabled)).toBe(false);
    });

    it('should ignore a second submit while the first is in flight', async () => {
      store.createCollection.mockReturnValue(new Subject<LingoTrackerConfigDto | null>());
      fillValidForm();

      await component.onSubmit();
      await component.onSubmit();

      expect(store.createCollection).toHaveBeenCalledTimes(1);
    });
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should not be in edit mode', () => {
    expect(component.isEditMode).toBe(false);
  });

  it('should add a valid locale and auto-set it as base', () => {
    component.addLocaleInput.setValue('en');
    component.addLocale();

    expect(component.form.controls.locales.length).toBe(1);
    expect(component.form.controls.locales.at(0).value).toBe('en');
    expect(component.form.controls.baseLocale.value).toBe('en');
    expect(component.addLocaleInput.value).toBe('');
    expect(component.addLocaleInput.errors).toBeNull();
  });

  it('should add a second locale without changing base', () => {
    component.addLocaleInput.setValue('en');
    component.addLocale();
    component.addLocaleInput.setValue('fr-ca');
    component.addLocale();

    expect(component.form.controls.locales.length).toBe(2);
    expect(component.form.controls.baseLocale.value).toBe('en');
  });

  it('should reject an invalid locale format', () => {
    component.addLocaleInput.setValue('xx-invalid-code');
    component.addLocale();

    expect(component.form.controls.locales.length).toBe(0);
    expect(component.addLocaleInput.hasError('invalidLocale')).toBe(true);
    expect(component.addLocaleInput.value).toBe('xx-invalid-code');
  });

  it('should reject a duplicate locale', () => {
    component.addLocaleInput.setValue('en');
    component.addLocale();
    component.addLocaleInput.setValue('en');
    component.addLocale();

    expect(component.form.controls.locales.length).toBe(1);
    expect(component.addLocaleInput.hasError('duplicateLocale')).toBe(true);
  });

  it('should normalize locale to lowercase on add', () => {
    component.addLocaleInput.setValue('EN');
    component.addLocale();

    expect(component.form.controls.locales.at(0).value).toBe('en');
  });

  it('should remove a locale row', () => {
    component.addLocaleInput.setValue('en');
    component.addLocale();
    component.addLocaleInput.setValue('es');
    component.addLocale();

    component.removeLocale(1);

    expect(component.form.controls.locales.length).toBe(1);
    expect(component.form.controls.locales.at(0).value).toBe('en');
  });

  it('should auto-promote first remaining locale to base when base is removed', () => {
    component.addLocaleInput.setValue('en');
    component.addLocale();
    component.addLocaleInput.setValue('es');
    component.addLocale();
    component.removeLocale(0);

    expect(component.form.controls.baseLocale.value).toBe('es');
  });

  it('should clear base locale when last locale is removed', () => {
    component.addLocaleInput.setValue('en');
    component.addLocale();
    component.removeLocale(0);

    expect(component.form.controls.locales.length).toBe(0);
    expect(component.form.controls.baseLocale.value).toBe('');
  });

  it('should let a clicked locale chip become the base', () => {
    component.addLocaleInput.setValue('en');
    component.addLocale();
    component.addLocaleInput.setValue('fr-ca');
    component.addLocale();

    component.setBaseLocale('fr-ca');

    expect(component.form.controls.baseLocale.value).toBe('fr-ca');
    expect(component.isBaseLocale('fr-ca')).toBe(true);
    expect(component.isBaseLocale('en')).toBe(false);
  });

  it('should ignore a base locale that is not in the list', () => {
    component.addLocaleInput.setValue('en');
    component.addLocale();

    component.setBaseLocale('de');

    expect(component.form.controls.baseLocale.value).toBe('en');
  });

  it('should add a pending locale when the input loses focus', () => {
    component.addLocaleInput.setValue('es');
    component.addLocaleIfPending();

    expect(component.form.controls.locales.at(0).value).toBe('es');
  });

  it('should keep the tags and protected terms disclosure closed when there is nothing in it', () => {
    expect(component.advancedOpen()).toBe(false);
    component.toggleAdvanced();
    expect(component.advancedOpen()).toBe(true);
  });

  it('should mark required fields touched instead of closing when submitted empty', async () => {
    await component.onSubmit();

    expect(component.form.controls.name.touched).toBe(true);
    expect(component.showNameError).toBe(true);
    expect(component.showFolderError).toBe(true);
  });

  it('should not close dialog when form is invalid', async () => {
    await component.onSubmit();
    expect(mockDialogRef.close).not.toHaveBeenCalled();
  });

  it('should close dialog with result when form is valid and submitted', async () => {
    component.form.controls.name.setValue('my-collection');
    component.form.controls.translationsFolder.setValue('./i18n');
    component.addLocaleInput.setValue('en');
    component.addLocale();

    await component.onSubmit();

    expect(mockDialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'my-collection',
        config: expect.objectContaining({
          translationsFolder: './i18n',
          locales: ['en'],
          baseLocale: 'en',
        }),
      }),
    );
  });

  it('should send an empty locales list and omit baseLocale when no locales added', async () => {
    component.form.controls.name.setValue('my-collection');
    component.form.controls.translationsFolder.setValue('./i18n');

    await component.onSubmit();

    const closeArg = mockDialogRef.close.mock.calls[0][0];
    expect(closeArg.config.locales).toEqual([]);
    expect(closeArg.config).not.toHaveProperty('baseLocale');
  });

  it('should send the exact create payload when nothing is set beyond the required fields', async () => {
    component.form.controls.name.setValue('my-collection');
    component.form.controls.translationsFolder.setValue('./i18n');

    await component.onSubmit();

    expect(mockDialogRef.close).toHaveBeenCalledWith({
      name: 'my-collection',
      config: {
        translationsFolder: './i18n',
        locales: [],
        readOnly: false,
        tags: [],
        protectedTermsFile: '',
      },
    });
  });

  it('should always send tags, as an empty list when there are none', async () => {
    component.form.controls.name.setValue('my-collection');
    component.form.controls.translationsFolder.setValue('./i18n');

    await component.onSubmit();

    expect(mockDialogRef.close.mock.calls[0][0].config.tags).toEqual([]);
  });

  it('should add a protected term preserving casing and trimming, deduped case-sensitively', () => {
    component.addProtectedTerm({ value: ' iPhone ', chipInput: { clear: () => undefined } } as never);
    component.addProtectedTerm({ value: 'Node.js', chipInput: { clear: () => undefined } } as never);
    component.addProtectedTerm({ value: 'iPhone', chipInput: { clear: () => undefined } } as never);

    expect(component.protectedTermsList()).toEqual(['iPhone', 'Node.js']);
  });

  it('should commit a typed tag on Enter or comma and clear the input', () => {
    const input = { value: ' Design System ' } as HTMLInputElement;
    const enter = { key: 'Enter', preventDefault: vi.fn() } as unknown as KeyboardEvent;

    component.onChipInputKeydown(enter, input, 'tag');

    expect(enter.preventDefault).toHaveBeenCalled();
    expect(component.tagsList()).toEqual(['design-system']);
    expect(input.value).toBe('');

    const other = { key: 'a', preventDefault: vi.fn() } as unknown as KeyboardEvent;
    component.onChipInputKeydown(other, { value: 'x' } as HTMLInputElement, 'tag');
    expect(component.tagsList()).toEqual(['design-system']);
  });

  it('should commit a pending protected term when its input blurs', () => {
    const input = { value: 'iPhone' } as HTMLInputElement;
    component.commitChipInput(input, 'term');

    expect(component.protectedTermsList()).toEqual(['iPhone']);
    expect(input.value).toBe('');
  });

  it('should remove a protected term', () => {
    component.addProtectedTerm({ value: 'iPhone', chipInput: { clear: () => undefined } } as never);
    component.addProtectedTerm({ value: 'C++', chipInput: { clear: () => undefined } } as never);
    component.removeProtectedTerm('iPhone');

    expect(component.protectedTermsList()).toEqual(['C++']);
  });

  it('should not allow editing protected terms without a terms file', () => {
    expect(component.canEditProtectedTerms()).toBe(false);
  });

  it('should send an empty protectedTermsFile and omit protected terms when no terms file is configured', async () => {
    component.form.controls.name.setValue('my-collection');
    component.form.controls.translationsFolder.setValue('./i18n');
    component.addProtectedTerm({ value: 'iPhone', chipInput: { clear: () => undefined } } as never);

    await component.onSubmit();

    const closeArg = mockDialogRef.close.mock.calls[0][0];
    expect(closeArg.config).not.toHaveProperty('protectedTerms');
    expect(closeArg.config.protectedTermsFile).toBe('');
  });
});

describe('CollectionFormDialog — edit mode', () => {
  let fixture: ComponentFixture<CollectionFormDialog>;
  let component: CollectionFormDialog;
  let mockDialogRef: DialogRefMock;
  let mockDialog: DialogMock;
  let store: StoreMock;

  const editData: CollectionFormDialogData = {
    mode: 'edit',
    name: 'my-app',
    config: {
      translationsFolder: './i18n',
      baseLocale: 'en',
      locales: ['en', 'es', 'fr-ca'],
      protectedTerms: ['iPhone', 'Node.js'],
      protectedTermsFile: 'i18n/terms.json',
      protectedTermsFilePath: '/project/i18n/terms.json',
    },
  };

  beforeEach(async () => {
    mockDialog = { open: vi.fn() };

    ({ fixture, mockDialogRef, mockDialog, store } = buildHarness(editData, mockDialog));
    component = fixture.componentInstance;
  });

  it('should be in edit mode', () => {
    expect(component.isEditMode).toBe(true);
  });

  it('should update the collection under its existing name through the store and close once accepted', async () => {
    await component.onSubmit();

    expect(store.updateCollection).toHaveBeenCalledWith('my-app', {
      name: undefined,
      collection: expect.objectContaining({ translationsFolder: './i18n', locales: ['en', 'es', 'fr-ca'] }),
    });
    expect(store.createCollection).not.toHaveBeenCalled();
    expect(mockDialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ name: 'my-app' }));
  });

  it('should show a refusal above the buttons when the name is locked, so a conflict has no field to land on', async () => {
    store.updateCollection.mockReturnValue(rejection(409, { message: 'Collection "my-app" already exists' }));

    await component.onSubmit();
    fixture.detectChanges();

    expect(mockDialogRef.close).not.toHaveBeenCalled();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="submit-error"] span')?.textContent,
    ).toContain('Collection "my-app" already exists');
  });

  it('should pre-populate locale rows from config', () => {
    expect(component.form.controls.locales.length).toBe(3);
    expect(component.form.controls.locales.at(0).value).toBe('en');
    expect(component.form.controls.locales.at(1).value).toBe('es');
    expect(component.form.controls.locales.at(2).value).toBe('fr-ca');
  });

  it('should pre-populate baseLocale from config', () => {
    expect(component.form.controls.baseLocale.value).toBe('en');
  });

  it('should pre-populate protected terms from config', () => {
    expect(component.protectedTermsList()).toEqual(['iPhone', 'Node.js']);
  });

  it('should allow editing protected terms once a terms file is configured', () => {
    expect(component.canEditProtectedTerms()).toBe(true);
    expect(component.protectedTermsFilePath()).toBe('/project/i18n/terms.json');
  });

  it('should return protected terms and preserve the file pointer in the result config', async () => {
    component.addProtectedTerm({ value: 'C++', chipInput: { clear: () => undefined } } as never);
    await component.onSubmit();

    expect(mockDialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          protectedTerms: ['iPhone', 'Node.js', 'C++'],
          protectedTermsFile: 'i18n/terms.json',
        }),
      }),
    );
  });

  it('should send an empty string for protectedTermsFile when the pointer is cleared, so the API drops it', async () => {
    component.protectedTermsFile.set(undefined);
    await component.onSubmit();

    expect(mockDialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ protectedTermsFile: '' }),
      }),
    );
    const closeArg = mockDialogRef.close.mock.calls[0][0];
    expect(closeArg.config).not.toHaveProperty('protectedTerms');
  });

  it('should open confirmation dialog when a pre-existing locale is removed on submit', async () => {
    mockDialog.open.mockReturnValue({ afterClosed: () => of(false) });

    component.removeLocale(2);
    await component.onSubmit();

    expect(mockDialog.open).toHaveBeenCalled();
    expect(mockDialog.open.mock.calls.at(-1)?.[1]).toEqual({
      data: {
        title: 'Remove locales',
        message: 'Removing locales: fr-ca. Their translation entries will be deleted. This cannot be undone.',
        confirmButtonText: 'Save',
        actionType: 'destructive',
      },
    });
    expect(mockDialogRef.close).not.toHaveBeenCalled();
  });

  it('should close dialog with result after removal confirmation confirmed', async () => {
    mockDialog.open.mockReturnValue({ afterClosed: () => of(true) });

    component.removeLocale(2);
    await component.onSubmit();

    expect(mockDialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ locales: ['en', 'es'] }),
      }),
    );
  });

  it('should not open confirmation dialog when only adding a new locale on submit', async () => {
    component.addLocaleInput.setValue('de');
    component.addLocale();
    await component.onSubmit();

    expect(mockDialog.open).not.toHaveBeenCalled();
    expect(mockDialogRef.close).toHaveBeenCalled();
    expect(mockDialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ locales: ['en', 'es', 'fr-ca', 'de'] }),
      }),
    );
  });

  it('should keep base locale unchanged in edit mode', () => {
    expect(component.form.controls.baseLocale.value).toBe('en');
    component.removeLocale(1);
    expect(component.form.controls.baseLocale.value).toBe('en');
  });

  it('should not remove the base locale row in edit mode', () => {
    component.removeLocale(0);
    expect(component.form.controls.locales.length).toBe(3);
    expect(component.form.controls.locales.at(0).value).toBe('en');
  });

  it('should not offer a remove control for the base locale in edit mode', () => {
    expect(component.canRemoveLocale(0)).toBe(false);
    expect(component.canRemoveLocale(1)).toBe(true);
  });

  it('should not let the base locale change in edit mode', () => {
    component.setBaseLocale('es');
    expect(component.form.controls.baseLocale.value).toBe('en');
  });

  it('should open the disclosure when protected terms already exist', () => {
    expect(component.advancedOpen()).toBe(true);
  });
});

describe('CollectionFormDialog — edit mode with stored protected terms', () => {
  it('should show and save stored protected terms verbatim, including untrimmed values', async () => {
    const dirtyTerms = ['a', ' a', 'b'];
    const { fixture, mockDialogRef } = buildHarness({
      mode: 'edit',
      name: 'my-app',
      config: {
        translationsFolder: './i18n',
        baseLocale: 'en',
        locales: ['en'],
        protectedTerms: dirtyTerms,
        protectedTermsFile: 'i18n/terms.json',
      },
    });
    const dialog = fixture.componentInstance;

    expect(dialog.protectedTermsList()).toEqual(dirtyTerms);
    expect(fixture.nativeElement.querySelectorAll('[aria-labelledby="protected-terms-label"] .text-chip')).toHaveLength(
      3,
    );
    dialog.addProtectedTermValue(' a ');
    expect(dialog.protectedTermsList()).toEqual(dirtyTerms);
    await dialog.onSubmit();

    expect(mockDialogRef.close.mock.calls[0]?.[0].config.protectedTerms).toEqual(dirtyTerms);
  });
});

describe('CollectionFormDialog — edit mode with inherited base locale', () => {
  let component: CollectionFormDialog;
  let mockDialogRef: DialogRefMock;

  beforeEach(async () => {
    const built = buildHarness({
      mode: 'edit',
      name: 'inherits-base',
      config: { translationsFolder: './i18n', locales: ['en', 'de'] },
      effectiveBaseLocale: 'en',
    });
    component = built.fixture.componentInstance;
    mockDialogRef = built.mockDialogRef;
  });

  it('should mark and lock the inherited base locale', () => {
    expect(component.displayedBaseLocale).toBe('en');
    expect(component.isBaseLocale('en')).toBe(true);
    expect(component.canRemoveLocale(0)).toBe(false);
    expect(component.canRemoveLocale(1)).toBe(true);
  });

  it('should not write the inherited base locale into the collection on save', async () => {
    await component.onSubmit();

    const closeArg = mockDialogRef.close.mock.calls[0][0];
    expect(closeArg.config).not.toHaveProperty('baseLocale');
  });
});

describe('CollectionFormDialog — edit mode clearing every locale', () => {
  it('should send an empty locales array when every locale is removed, so the API can inherit global locales', async () => {
    // No `effectiveBaseLocale` and no own `baseLocale`: nothing is displayed as base, so every
    // locale row stays removable and the array can reach zero, same as clearing an override
    // down to "inherit everything from global".
    const mockDialog: DialogMock = { open: vi.fn() };
    const { fixture, mockDialogRef } = buildHarness(
      {
        mode: 'edit',
        name: 'my-app',
        config: { translationsFolder: './i18n', locales: ['en', 'de'] },
      },
      mockDialog,
    );
    const component = fixture.componentInstance;
    mockDialog.open.mockReturnValue({ afterClosed: () => of(true) });

    component.removeLocale(1);
    component.removeLocale(0);
    await component.onSubmit();

    expect(mockDialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ locales: [] }),
      }),
    );
  });
});

describe('CollectionFormDialog — edit mode with tags', () => {
  it('should send the exact payload with an empty tags list when every existing tag is removed, so the API clears them', async () => {
    const { fixture, mockDialogRef } = buildHarness({
      mode: 'edit',
      name: 'my-app',
      config: { translationsFolder: './i18n', baseLocale: 'en', locales: ['en'], tags: ['ui', 'legacy'] },
    });
    const component = fixture.componentInstance;

    component.removeCollectionTag('ui');
    component.removeCollectionTag('legacy');
    await component.onSubmit();

    expect(mockDialogRef.close).toHaveBeenCalledWith({
      name: 'my-app',
      config: {
        translationsFolder: './i18n',
        locales: ['en'],
        baseLocale: 'en',
        readOnly: false,
        tags: [],
        protectedTermsFile: '',
      },
    });
  });
});
