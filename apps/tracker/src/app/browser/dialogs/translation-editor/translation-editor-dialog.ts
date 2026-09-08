import {
  Component,
  ChangeDetectionStrategy,
  inject,
  type OnInit,
  type OnDestroy,
  type AfterViewInit,
  signal,
  computed,
  HostListener,
  ViewChild,
  type ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, FormControl, Validators, FormArray } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule, type MatChipInputEvent } from '@angular/material/chips';
import { MatAutocompleteModule, type MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TextFieldModule } from '@angular/cdk/text-field';
import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { NotificationService } from '../../../shared/notification';
import type {
  ResourceSummaryDto,
  TranslationStatus,
  CreateResourceDto,
  CreateResourceResponseDto,
  UpdateResourceDto,
  UpdateResourceResponseDto,
  SearchResultDto,
  FolderNodeDto,
} from '@simoncodes-ca/data-transfer';
import { BrowserApiService } from '../../services/browser-api.service';
import { BrowserStore } from '../../store/browser.store';
import { HttpErrorResponse } from '@angular/common/http';
import { ConfirmationDialog } from '../../../shared/components/confirmation-dialog/confirmation-dialog';
import type { ConfirmationDialogData } from '../../../shared/components/confirmation-dialog/confirmation-dialog-data';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { TRACKER_TOKENS } from '../../../../i18n-types/tracker-resources';
import { SimilarTranslations } from './similar-translations';
import { FolderPicker } from './folder-picker/folder-picker';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, catchError, takeUntil, tap } from 'rxjs/operators';
import { of } from 'rxjs';
import { isValidSegment, normalizeTag } from '@simoncodes-ca/domain';

export interface TranslationEditorDialogData {
  mode: 'create' | 'edit';
  resource?: ResourceSummaryDto;
  collectionName: string;
  folderPath?: string;
  availableLocales: string[];
  baseLocale: string;
  /** When true, the dialog opens in view-only mode: inputs disabled, no save. */
  readOnly?: boolean;
}

interface TranslationFormValue {
  key: string;
  baseValue: string;
  comment: string;
  translations: LocaleTranslation[];
}

interface LocaleTranslation {
  locale: string;
  value: string;
  status: TranslationStatus;
}

export interface TranslationEditorResult {
  key: string;
  baseValue: string;
  comment?: string;
  folderPath: string;
  translations?: LocaleTranslation[];
  success?: boolean;
  shouldOpenEdit?: boolean;
  existingResourceKey?: string;
  resource?: ResourceSummaryDto;
  /** Locales skipped during auto-translation due to ICU format incompatibility. */
  skippedLocales?: string[];
}

@Component({
  standalone: true,
  selector: 'app-translation-editor-dialog',
  templateUrl: './translation-editor-dialog.html',
  styleUrls: ['./translation-editor-dialog.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    TextFieldModule,
    MatChipsModule,
    MatAutocompleteModule,
    SimilarTranslations,
    FolderPicker,
    TranslocoPipe,
    MatTooltipModule,
  ],
})
export class TranslationEditorDialog implements OnInit, OnDestroy, AfterViewInit {
  private readonly dialogRef = inject(MatDialogRef<TranslationEditorDialog>);
  private readonly dialog = inject(MatDialog);
  private readonly browserApi = inject(BrowserApiService);
  private readonly browserStore = inject(BrowserStore);
  private readonly notifications = inject(NotificationService);
  private readonly transloco = inject(TranslocoService);
  private readonly destroy$ = new Subject<void>();
  private readonly baseValueSearch$ = new Subject<string>();

  readonly data = inject<TranslationEditorDialogData>(MAT_DIALOG_DATA);
  readonly TOKENS = TRACKER_TOKENS;

  @ViewChild('keyInput') keyInput?: ElementRef<HTMLInputElement>;
  @ViewChild('baseValueInput') baseValueInput?: ElementRef<HTMLTextAreaElement>;

  #commentConfirmationShown = false;
  #originalBaseValue = '';
  #originalTags: string[] = [];
  #originalFolderPath = '';
  /**
   * The folder path this dialog last derived from a dotted key. Typing `a.` then
   * `b.` has to extend `a`, not re-anchor on `b`; a folder the user picked on the
   * Location tab is never extended, only replaced.
   */
  #folderFromKey: string | null = null;
  #locationFlashTimer: ReturnType<typeof setTimeout> | undefined;

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly similarResources = signal<SearchResultDto[]>([]);
  readonly isSearchingSimilar = signal(false);
  readonly baseValueLength = signal(0);
  readonly isLocalesScrolled = signal(false);
  /** True while the location pill is highlighting a folder it just absorbed from the key field. */
  readonly locationAbsorbedFlash = signal(false);
  /** Live-region text announcing the same move to a screen reader, which cannot see the flash. */
  readonly locationAbsorbedMessage = signal('');
  /** Which tab is showing; owned here so validation can steer the user to the failure. */
  readonly selectedTabIndex = signal(0);
  /** Set once the user attempts to save, so errors surface on untouched fields too. */
  readonly submitAttempted = signal(false);

  readonly tagSeparatorKeyCodes = [ENTER, COMMA] as const;
  readonly tagInputText = signal('');
  readonly tagsList = signal<string[]>([]);
  readonly inheritedTagsList = computed(() => this.data.resource?.inheritedTags ?? []);

  readonly form = new FormGroup({
    key: new FormControl<string>('', {
      validators: [Validators.required, Validators.pattern(/^[a-zA-Z0-9_-]+$/)],
      nonNullable: true,
    }),
    baseValue: new FormControl<string>('', {
      validators: [Validators.required],
      nonNullable: true,
    }),
    comment: new FormControl<string>('', {
      nonNullable: true,
    }),
    translations: new FormArray<
      FormGroup<{
        locale: FormControl<string>;
        value: FormControl<string>;
        status: FormControl<TranslationStatus>;
      }>
    >([]),
  });

  readonly selectedFolderPath = signal<string>('');

  readonly rootFolders = computed(() => this.browserStore.rootFolders());

  readonly otherLocales = computed(() =>
    this.data.availableLocales.filter((locale) => locale !== this.data.baseLocale),
  );

  readonly translationStatusOptions: TranslationStatus[] = ['new', 'translated', 'stale', 'verified'];

  readonly isEditMode = computed(() => this.data.mode === 'edit');
  /** Whether the dialog is view-only because the collection is read-only. */
  readonly isReadOnly = computed(() => this.data.readOnly === true);
  readonly dialogTitle = computed(() =>
    this.isEditMode()
      ? TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.EDITTITLE
      : TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.CREATETITLE,
  );
  readonly dialogSubtitle = computed(() =>
    this.isEditMode()
      ? TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.EDITSUBTITLE
      : TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.CREATESUBTITLE,
  );
  readonly saveButtonLabel = computed(() =>
    this.isEditMode()
      ? TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.UPDATEBUTTON
      : TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.SAVEBUTTON,
  );
  readonly hasSearchQuery = computed(() => this.baseValueLength() >= 3);

  /**
   * Bumped on every form status change. Reactive forms are not signal-based, so
   * anything computed from validity has to read this to stay live.
   */
  readonly formRevision = signal(0);

  /**
   * The base-info tab owns both required controls, so it is the only tab that
   * can hold a blocking error today. Reading `formRevision` keeps this live.
   */
  readonly baseTabHasError = computed(() => {
    this.formRevision();
    if (!this.submitAttempted()) {
      return false;
    }
    return this.form.controls.key.invalid || this.form.controls.baseValue.invalid;
  });

  /** Localized label for a translation status, so the spine never shows raw enum text. */
  readonly statusLabels: Record<TranslationStatus, string> = {
    new: TRACKER_TOKENS.BROWSER.STATUS.NEW,
    translated: TRACKER_TOKENS.BROWSER.STATUS.TRANSLATED,
    stale: TRACKER_TOKENS.BROWSER.STATUS.STALE,
    verified: TRACKER_TOKENS.BROWSER.STATUS.VERIFIED,
  };

  /** Explains a disabled Other Locales tab instead of leaving it silently grey. */
  readonly otherLocalesTabTooltip = computed(() =>
    this.otherLocales().length === 0
      ? this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.NOOTHERLOCALESTOOLTIP)
      : '',
  );

  /** Explains a disabled Change Location tab instead of leaving it silently grey. */
  readonly locationTabTooltip = computed(() =>
    this.isReadOnly() ? this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.READONLYTABTOOLTIP) : '',
  );

  /** The complete dot-delimited key, for the location pill's tooltip. */
  readonly fullKeyPreview = computed(() => {
    this.formRevision();
    const folder = this.selectedFolderPath();
    const key = this.form.controls.key.value.trim();
    if (!key) {
      return folder;
    }
    return folder ? `${folder}.${key}` : key;
  });

  readonly allTagSuggestions = computed(() => {
    const seen = new Set<string>();
    for (const resource of this.browserStore.translations()) {
      for (const tag of resource.tags ?? []) {
        seen.add(tag);
      }
    }
    return [...seen].sort();
  });

  readonly filteredTagSuggestions = computed(() => {
    const input = this.tagInputText().toLowerCase();
    const existing = new Set([...this.tagsList(), ...this.inheritedTagsList()]);
    return this.allTagSuggestions().filter((t) => !existing.has(t) && (input === '' || t.includes(input)));
  });

  ngOnInit(): void {
    // Initialize folder path from dialog data
    this.selectedFolderPath.set(this.data.folderPath || '');
    this.#initializeOtherLocaleFormControls();

    if (this.isEditMode() && this.data.resource) {
      const baseValue = this.data.resource.translations[this.data.baseLocale] || '';
      const comment = this.data.resource.comment || '';

      this.form.patchValue({
        key: this.data.resource.key,
        baseValue,
        comment,
      });

      this.tagsList.set(this.data.resource.tags ?? []);

      this.#originalBaseValue = baseValue;

      this.#populateOtherLocaleTranslations();
    }

    this.#originalTags = [...this.tagsList()];
    this.#originalFolderPath = this.selectedFolderPath();

    this.#setupSimilarResourcesSearch();

    if (!this.isEditMode()) {
      this.#setupDottedKeyAbsorption();
    }

    this.form.statusChanges.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.formRevision.update((revision) => revision + 1);
    });
    this.form.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.formRevision.update((revision) => revision + 1);
    });

    // View-only mode: lock down all inputs. Save is hidden in the template.
    if (this.isReadOnly()) {
      this.form.disable({ emitEvent: false });
    }

    this.#guardAgainstAccidentalClose();
  }

  /**
   * Escape and backdrop clicks used to discard the whole form without a word.
   * Take ownership of both so an edited entry always gets a confirmation first.
   */
  #guardAgainstAccidentalClose(): void {
    this.dialogRef.disableClose = true;

    this.dialogRef
      .keydownEvents()
      .pipe(takeUntil(this.destroy$))
      .subscribe((event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          void this.onCancel();
        }
      });

    this.dialogRef
      .backdropClick()
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        void this.onCancel();
      });
  }

  /** True when closing now would throw away work the user has done. */
  hasUnsavedChanges(): boolean {
    if (this.isReadOnly() || this.isSubmitting()) {
      return false;
    }

    if (this.form.dirty) {
      return true;
    }

    if (this.selectedFolderPath() !== this.#originalFolderPath) {
      return true;
    }

    const tags = this.tagsList();
    return tags.length !== this.#originalTags.length || tags.some((tag, i) => tag !== this.#originalTags[i]);
  }

  ngOnDestroy(): void {
    clearTimeout(this.#locationFlashTimer);
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngAfterViewInit(): void {
    this.dialogRef.afterOpened().subscribe(() => {
      if (this.isEditMode()) {
        this.baseValueInput?.nativeElement.focus();
      } else {
        this.keyInput?.nativeElement.focus();
      }
    });
  }

  #initializeOtherLocaleFormControls(): void {
    const translationsArray = this.form.controls.translations;
    translationsArray.clear();

    this.otherLocales().forEach((locale) => {
      const localeGroup = new FormGroup({
        locale: new FormControl<string>(locale, { nonNullable: true }),
        value: new FormControl<string>('', { nonNullable: true }),
        status: new FormControl<TranslationStatus>('new', {
          nonNullable: true,
        }),
      });

      translationsArray.push(localeGroup);
    });
  }

  #populateOtherLocaleTranslations(): void {
    if (!this.data.resource) {
      return;
    }

    const translationsArray = this.form.controls.translations;

    translationsArray.controls.forEach((control) => {
      const locale = control.value.locale;
      if (!locale) {
        return;
      }
      const value = this.data.resource?.translations[locale] || '';
      const status = this.data.resource?.status[locale] || 'new';

      control.patchValue({ value, status });
    });
  }

  #setupSimilarResourcesSearch(): void {
    this.form.controls.baseValue.valueChanges.pipe(takeUntil(this.destroy$)).subscribe((value) => {
      this.baseValueLength.set(value.trim().length);
      const shouldSearch = this.#shouldSearchForSimilar(value);
      if (shouldSearch) {
        this.baseValueSearch$.next(value);
      } else {
        this.similarResources.set([]);
      }
    });

    this.baseValueSearch$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        tap(() => this.isSearchingSimilar.set(true)),
        switchMap((query) => {
          if (!query || query.trim().length < 3) {
            return of({
              query: '',
              results: [],
              totalFound: 0,
              limited: false,
            });
          }

          return this.browserApi.searchTranslations(this.data.collectionName, query, 10).pipe(
            catchError(() =>
              of({
                query: '',
                results: [],
                totalFound: 0,
                limited: false,
              }),
            ),
          );
        }),
        tap(() => this.isSearchingSimilar.set(false)),
        takeUntil(this.destroy$),
      )
      .subscribe((searchResults) => {
        // Filter out current resource in edit mode
        const filteredResults =
          this.isEditMode() && this.data.resource
            ? searchResults.results.filter((r) => r.key !== this.#buildOriginalFullKey())
            : searchResults.results;
        this.similarResources.set(filteredResults);
      });
  }

  /**
   * The primary user arrives holding a full dotted key — `apps.common.buttons.ok` —
   * and the key control only accepts a single segment. Rather than rejecting the
   * one string they have, take the dotted prefix as the folder and keep the leaf.
   *
   * Listening on `valueChanges` covers every way text arrives: typed, pasted,
   * dropped, or completed by the browser. The pattern validator stays on as the
   * backstop for characters that are invalid in any position.
   */
  #setupDottedKeyAbsorption(): void {
    this.form.controls.key.valueChanges.pipe(takeUntil(this.destroy$)).subscribe((value) => {
      this.#absorbDottedKey(value);
    });
  }

  #absorbDottedKey(rawValue: string): void {
    if (!rawValue.includes('.')) {
      return;
    }

    // Empty segments cover leading, trailing and consecutive dots in one pass;
    // a trailing dot means the user has finished a folder but not started a leaf.
    const segments = rawValue.split('.').filter((segment) => segment.length > 0);
    const leaf = rawValue.endsWith('.') ? '' : (segments.pop() ?? '');

    // Anything the pattern validator would reject is left in the field verbatim,
    // so the error names the real problem instead of a silently mangled key.
    if (segments.some((segment) => !isValidSegment(segment))) {
      return;
    }

    this.#setKeyControl(leaf);

    if (segments.length === 0) {
      return;
    }

    const prefix = segments.join('.');
    const isContinuation = this.#folderFromKey !== null && this.selectedFolderPath() === this.#folderFromKey;
    const nextFolder = isContinuation ? `${this.#folderFromKey}.${prefix}` : prefix;

    this.#folderFromKey = nextFolder;
    this.selectedFolderPath.set(nextFolder);
    this.#announceLocationAbsorbed(nextFolder);
  }

  /** Writes the leaf back without re-entering the subscription that produced it. */
  #setKeyControl(leaf: string): void {
    const control = this.form.controls.key;
    control.setValue(leaf, { emitEvent: false });
    control.markAsDirty();
    control.updateValueAndValidity({ emitEvent: false });
    this.formRevision.update((revision) => revision + 1);
  }

  /**
   * The prefix leaves the field the user is looking at and lands in a pill above
   * it, so say so twice: a highlight for the eye, a live region for the reader.
   */
  #announceLocationAbsorbed(folderPath: string): void {
    this.locationAbsorbedMessage.set(
      this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.LOCATIONFROMKEYX, { folder: folderPath }),
    );

    clearTimeout(this.#locationFlashTimer);
    this.locationAbsorbedFlash.set(false);
    // Let the class drop for a frame so a second paste re-runs the animation.
    requestAnimationFrame(() => this.locationAbsorbedFlash.set(true));
    this.#locationFlashTimer = setTimeout(() => this.locationAbsorbedFlash.set(false), 900);
  }

  #shouldSearchForSimilar(currentValue: string): boolean {
    if (!currentValue || currentValue.trim().length < 3) {
      return false;
    }

    if (this.isEditMode()) {
      return currentValue !== this.#originalBaseValue;
    }

    return true;
  }

  // Escape is handled through `dialogRef.keydownEvents()` in
  // `#guardAgainstAccidentalClose`. A window-scoped listener also fired for
  // keystrokes aimed at the confirmation dialogs stacked on top of this one,
  // closing the editor underneath them and destroying the form.

  @HostListener('window:keydown.control.enter', ['$event'])
  @HostListener('window:keydown.meta.enter', ['$event'])
  onCtrlEnter(event: Event): void {
    event.preventDefault();
    void this.onSubmit();
  }

  onTabChange(index: number): void {
    this.selectedTabIndex.set(index);
    this.isLocalesScrolled.set(false);
  }

  onLocalesScroll(event: Event): void {
    this.isLocalesScrolled.set((event.target as HTMLElement).scrollTop > 0);
  }

  async onCancel(): Promise<void> {
    if (this.hasUnsavedChanges() && !(await this.#confirmDiscard())) {
      return;
    }
    this.dialogRef.close();
  }

  #confirmDiscard(): Promise<boolean> {
    const dialogData: ConfirmationDialogData = {
      title: this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.UNSAVED.TITLE),
      message: this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.UNSAVED.MESSAGE),
      confirmButtonText: this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.UNSAVED.DISCARD),
      cancelButtonText: this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.UNSAVED.KEEPEDITING),
    };

    return new Promise((resolve) => {
      this.dialog
        .open<ConfirmationDialog, ConfirmationDialogData, boolean>(ConfirmationDialog, {
          data: dialogData,
          width: '440px',
          disableClose: true,
        })
        .afterClosed()
        .subscribe((discard) => resolve(discard === true));
    });
  }

  onFolderConfirmed(folderPath: string): void {
    this.#folderFromKey = null;
    this.selectedFolderPath.set(folderPath);
  }

  onFolderCreated(folder: FolderNodeDto): void {
    // Store's createFolderAt already updated rootFolders, just update selection
    this.#folderFromKey = null;
    this.selectedFolderPath.set(folder.fullPath);
  }

  addTag(event: MatChipInputEvent): void {
    const normalized = normalizeTag(event.value);
    if (normalized && !this.tagsList().includes(normalized)) {
      this.tagsList.update((tags) => [...tags, normalized]);
    }
    event.chipInput?.clear();
    this.tagInputText.set('');
  }

  addTagFromAutocomplete(event: MatAutocompleteSelectedEvent): void {
    const normalized = normalizeTag(event.option.value as string);
    if (normalized && !this.tagsList().includes(normalized)) {
      this.tagsList.update((tags) => [...tags, normalized]);
    }
    this.tagInputText.set('');
  }

  removeTag(tag: string): void {
    if (this.inheritedTagsList().includes(tag)) return;
    this.tagsList.update((tags) => tags.filter((t) => t !== tag));
  }

  onTagInputChange(event: Event): void {
    this.tagInputText.set((event.target as HTMLInputElement).value);
  }

  onSimilarResourceClick(result: SearchResultDto): void {
    const fullKey = result.key;
    this.#copyToClipboard(fullKey, this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.KEYCOPIED));
  }

  #copyToClipboard(text: string, successMessage: string): void {
    const failedMessage = this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.COPYFAILED);

    if (!navigator.clipboard?.writeText) {
      this.notifications.error(failedMessage);
      return;
    }

    navigator.clipboard
      .writeText(text)
      .then(() => {
        this.notifications.success(successMessage);
      })
      .catch(() => {
        this.notifications.error(failedMessage);
      });
  }

  async onSubmit(): Promise<void> {
    if (this.isReadOnly() || this.isSubmitting()) {
      return;
    }

    // The save button stays enabled so an invalid form can explain itself
    // rather than presenting a dead control with no error anywhere on screen.
    if (this.form.invalid) {
      this.#revealValidationFailure();
      return;
    }

    const formValue = this.form.getRawValue() as TranslationFormValue;
    const commentValue = formValue.comment.trim();

    if (!commentValue && !this.#commentConfirmationShown) {
      const shouldProceed = await this.#showCommentConfirmation();

      if (!shouldProceed) {
        return;
      }
    }

    if (this.isEditMode()) {
      this.#handleEditSubmit(formValue, commentValue);
    } else {
      this.#handleCreateSubmit(formValue, commentValue);
    }
  }

  /**
   * Names the problem, steers to the tab that holds it, and puts the caret in
   * the offending field. Both required controls live on the base-info tab.
   */
  #revealValidationFailure(): void {
    this.submitAttempted.set(true);
    this.form.markAllAsTouched();
    this.formRevision.update((revision) => revision + 1);
    this.errorMessage.set(this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.FIXERRORS));

    this.selectedTabIndex.set(0);

    queueMicrotask(() => {
      const target = this.form.controls.key.invalid ? this.keyInput : this.baseValueInput;
      target?.nativeElement.focus();
    });
  }

  #handleEditSubmit(formValue: TranslationFormValue, commentValue: string): void {
    if (!this.data.resource) {
      this.errorMessage.set(this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.ERROR.MISSINGRESOURCE));
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    const originalKey = this.#buildOriginalFullKey();
    const newKey = formValue.key;
    const newFolderPath = this.selectedFolderPath();
    const originalFolderPath = this.data.folderPath || '';

    // The key control is readonly in edit mode (`html`), so `newKey` can only
    // ever equal the original; renaming is a move, handled by the CLI.
    const hasFolderChanged = newFolderPath !== originalFolderPath;

    const filledTranslations = formValue.translations.filter((translation) => {
      const hasValue = translation.value.trim().length > 0;
      const originalStatus = this.data.resource?.status[translation.locale] ?? 'new';
      const hasStatusChange = translation.status !== originalStatus;
      return hasValue || hasStatusChange;
    });

    const locales: Record<string, { value: string; status: TranslationStatus }> = {};
    filledTranslations.forEach((translation) => {
      locales[translation.locale] = { value: translation.value, status: translation.status };
    });

    const updateDto: UpdateResourceDto = {
      key: originalKey,
      baseValue: formValue.baseValue,
      comment: commentValue || undefined,
      tags: this.tagsList(),
    };

    if (hasFolderChanged) {
      updateDto.targetFolder = newFolderPath || undefined;
    }

    if (Object.keys(locales).length > 0) {
      updateDto.locales = locales;
    }

    this.browserApi.updateResource(this.data.collectionName, updateDto).subscribe({
      next: (response: UpdateResourceResponseDto) => {
        this.dialogRef.close({
          key: newKey,
          baseValue: formValue.baseValue,
          comment: commentValue || undefined,
          folderPath: newFolderPath,
          translations: filledTranslations.length > 0 ? filledTranslations : undefined,
          success: true,
          resource: response.resource,
          skippedLocales: response.skippedLocales?.length ? response.skippedLocales : undefined,
        });
      },
      error: (error: unknown) => {
        this.isSubmitting.set(false);
        this.#handleUpdateError(error);
      },
    });
  }

  #handleCreateSubmit(formValue: TranslationFormValue, commentValue: string): void {
    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    const fullKey = this.#buildFullKey(formValue.key);

    const filledTranslations = formValue.translations
      .filter((translation) => translation.value.trim().length > 0)
      .map((translation) => ({
        locale: translation.locale,
        value: translation.value,
        status: 'new' as TranslationStatus,
      }));

    const createDto: CreateResourceDto = {
      key: fullKey,
      baseValue: formValue.baseValue,
      comment: commentValue || undefined,
      tags: this.tagsList().length > 0 ? this.tagsList() : undefined,
      baseLocale: this.data.baseLocale,
      translations: filledTranslations.length > 0 ? filledTranslations : undefined,
    };

    this.browserApi.createResource(this.data.collectionName, createDto).subscribe({
      next: (response: CreateResourceResponseDto) => {
        this.dialogRef.close({
          key: formValue.key,
          baseValue: formValue.baseValue,
          comment: commentValue || undefined,
          folderPath: this.selectedFolderPath(),
          translations: filledTranslations.length > 0 ? filledTranslations : undefined,
          success: true,
          skippedLocales: response.skippedLocales?.length ? response.skippedLocales : undefined,
        });
      },
      error: (error: unknown) => {
        this.isSubmitting.set(false);
        this.#handleCreateError(error, fullKey);
      },
    });
  }

  #buildFullKey(key: string): string {
    const folderPath = this.selectedFolderPath();
    if (!folderPath) {
      return key;
    }
    return `${folderPath}.${key}`;
  }

  #buildOriginalFullKey(): string {
    if (!this.data.resource) {
      return '';
    }
    const folderPath = this.data.folderPath || '';
    const key = this.data.resource.key;
    if (!folderPath) {
      return key;
    }
    return `${folderPath}.${key}`;
  }

  #handleCreateError(error: unknown, fullKey: string): void {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 409) {
        this.#showKeyConflictDialog(fullKey);
        return;
      }

      if (error.status === 400) {
        const message =
          error.error?.message ||
          error.message ||
          this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.ERROR.INVALIDREQUEST);
        this.errorMessage.set(message);
        return;
      }

      this.errorMessage.set(
        error.error?.message ||
          error.message ||
          this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.ERROR.CREATEFAILED),
      );
      return;
    }

    this.errorMessage.set(this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.ERROR.UNEXPECTED));
  }

  #handleUpdateError(error: unknown): void {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 404) {
        this.errorMessage.set(this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.ERROR.NOTFOUND));
        return;
      }

      if (error.status === 400) {
        const message =
          error.error?.message ||
          error.message ||
          this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.ERROR.INVALIDREQUEST);
        this.errorMessage.set(message);
        return;
      }

      this.errorMessage.set(
        error.error?.message ||
          error.message ||
          this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.ERROR.UPDATEFAILED),
      );
      return;
    }

    this.errorMessage.set(this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.ERROR.UNEXPECTED));
  }

  #showKeyConflictDialog(existingKey: string): void {
    const dialogData: ConfirmationDialogData = {
      title: this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.CONFLICT.TITLE),
      message: this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.CONFLICT.MESSAGEX, {
        key: existingKey,
      }),
      confirmButtonText: this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.CONFLICT.EDITEXISTING),
      cancelButtonText: this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.CONFLICT.CHOOSEDIFFERENTKEY),
    };

    const dialogRef = this.dialog.open<ConfirmationDialog, ConfirmationDialogData, boolean>(ConfirmationDialog, {
      data: dialogData,
      width: '500px',
    });

    dialogRef.afterClosed().subscribe((shouldEditExisting) => {
      if (shouldEditExisting) {
        this.dialogRef.close({
          key: this.form.controls.key.value,
          baseValue: this.form.controls.baseValue.value,
          comment: this.form.controls.comment.value.trim() || undefined,
          folderPath: this.selectedFolderPath(),
          shouldOpenEdit: true,
          existingResourceKey: existingKey,
        });
      }
    });
  }

  async #showCommentConfirmation(): Promise<boolean> {
    this.#commentConfirmationShown = true;

    const confirmationDialogData: ConfirmationDialogData = {
      title: this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.COMMENTCONFIRM.TITLE),
      message: this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.COMMENTCONFIRM.MESSAGE),
      confirmButtonText: this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.COMMENTCONFIRM.SAVEANYWAY),
      cancelButtonText: this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.COMMENTCONFIRM.ADDCOMMENT),
    };

    const confirmationDialogRef = this.dialog.open(ConfirmationDialog, {
      data: confirmationDialogData,
      width: '400px',
      disableClose: true,
    });

    const confirmed = await confirmationDialogRef.afterClosed().toPromise();

    if (!confirmed) {
      this.#commentConfirmationShown = false;
    }

    return confirmed === true;
  }

  getLocaleFormGroup(index: number): FormGroup<{
    locale: FormControl<string>;
    value: FormControl<string>;
    status: FormControl<TranslationStatus>;
  }> {
    return this.form.controls.translations.at(index) as FormGroup<{
      locale: FormControl<string>;
      value: FormControl<string>;
      status: FormControl<TranslationStatus>;
    }>;
  }

  /**
   * Renders a locale as a name the reader recognises ("French (Canada)") with
   * the raw code as the fallback, rather than shouting `FR-CA` at them.
   */
  getLocaleDisplayName(locale: string | undefined): string {
    if (!locale) {
      return '';
    }

    const code = locale.toUpperCase();
    try {
      const names = new Intl.DisplayNames([this.transloco.getActiveLang()], { type: 'language' });
      const name = names.of(locale);
      return name && name.toLowerCase() !== locale.toLowerCase() ? name : code;
    } catch {
      return code;
    }
  }

  getKeyErrorMessage(): string {
    const keyControl = this.form.controls.key;

    if (keyControl.hasError('required')) {
      return TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.KEYREQUIRED;
    }

    if (keyControl.hasError('pattern')) {
      return TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.KEYPATTERNERROR;
    }

    return '';
  }
}
