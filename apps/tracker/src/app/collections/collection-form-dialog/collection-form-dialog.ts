import { Component, ChangeDetectionStrategy, computed, inject, DestroyRef, type OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, FormControl, FormArray, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { MatChipInputEvent } from '@angular/material/chips';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { isUnderNodeModules, validateLocale } from '@simoncodes-ca/domain';
import type { CollectionFormDialogData } from './collection-form-dialog-data';
import type { LingoTrackerCollectionDto } from '@simoncodes-ca/data-transfer';
import { TRACKER_TOKENS } from '../../../i18n-types/tracker-resources';
import { CollectionsStore } from '../store/collections.store';
import { injectConfirm } from '../../shared/confirm';
import { NamedEntrySubmit } from '../store/dialog-config-submit';
import { addTagToList, removeTagFromList } from '../../shared/tag-list-edit';
import { ProtectedTermsChips } from '../../shared/protected-terms/protected-terms-chips';

/** What the dialog closes with: the collection as the server has now accepted it. */
export interface CollectionFormResult {
  name: string;
  config: LingoTrackerCollectionDto;
}

@Component({
  selector: 'app-collection-form-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatTooltipModule,
    TranslocoModule,
  ],
  templateUrl: './collection-form-dialog.html',
  styleUrl: './collection-form-dialog.scss',
})
export class CollectionFormDialog implements OnInit {
  readonly #dialogRef = inject(MatDialogRef<CollectionFormDialog>);
  readonly #data = inject<CollectionFormDialogData>(MAT_DIALOG_DATA);
  readonly #confirm = injectConfirm();
  readonly #translocoService = inject(TranslocoService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #store = inject(CollectionsStore);

  readonly TOKENS = TRACKER_TOKENS;

  /** True from submit until the server has answered. */
  readonly saving = signal(false);
  /** Why the server refused the last submit, unless the refusal belongs to the name field. */
  readonly submitError = signal<string | null>(null);

  /** Owns the server-taken-name validator and the create/update submit. */
  readonly #namedEntrySubmit: NamedEntrySubmit<CollectionFormResult> = new NamedEntrySubmit({
    nameControl: (): FormControl<string> => this.form.controls.name,
    fallbackTokens: {
      create: TRACKER_TOKENS.COLLECTIONS.TOAST.CREATEFAILED,
      update: TRACKER_TOKENS.COLLECTIONS.TOAST.UPDATEFAILED,
    },
    translate: (token) => this.#translocoService.translate(token),
    dialogRef: this.#dialogRef,
    saving: this.saving,
    destroyRef: this.#destroyRef,
  });

  readonly form = new FormGroup({
    name: new FormControl<string>('', {
      validators: [Validators.required, this.#namedEntrySubmit.nameValidator],
      nonNullable: true,
    }),
    translationsFolder: new FormControl<string>('', {
      validators: [Validators.required],
      nonNullable: true,
    }),
    baseLocale: new FormControl<string>('', { nonNullable: true }),
    locales: new FormArray<FormControl<string>>([]),
    readOnly: new FormControl<boolean>(false, { nonNullable: true }),
  });

  readonly addLocaleInput = new FormControl<string>('', { nonNullable: true });
  /** The config file name, wrapped in our own `<code>` so hints can set it in mono inside translated prose. */
  readonly configFileMarkup = '<code>.lingo-tracker.json</code>';
  readonly tagsList = signal<string[]>([]);
  readonly protectedTerms = new ProtectedTermsChips();
  readonly protectedTermsList = this.protectedTerms.values;
  /** The collection's `protectedTermsFile` pointer, preserved across an edit but not editable here. */
  readonly protectedTermsFile = signal<string | undefined>(undefined);
  /** Resolved path of that file, shown read-only so the source of a diff is obvious. */
  readonly protectedTermsFilePath = signal<string | undefined>(undefined);
  /** Terms live in a file, so without a pointer there is nowhere to save them — the editor stays hidden. */
  readonly canEditProtectedTerms = computed(() => this.protectedTermsFile() !== undefined);
  /**
   * Tags and protected terms are the rarely-touched part of a collection, so they sit behind a
   * disclosure. It opens by itself when there is already something in it to look at.
   */
  readonly advancedOpen = signal(false);

  #originalLocales: string[] = [];
  /** Tracks whether the user manually toggled read-only, so auto-detection stops overriding it. */
  #readOnlyTouchedByUser = false;

  get isEditMode(): boolean {
    return this.#data.mode === 'edit';
  }

  get dialogTitle(): string {
    return this.isEditMode
      ? TRACKER_TOKENS.COLLECTIONS.DIALOG.EDIT.TITLE
      : TRACKER_TOKENS.COLLECTIONS.DIALOG.CREATE.TITLE;
  }

  /** Whether the entered folder is under node_modules (drives the read-only hint). */
  get isNodeModulesPath(): boolean {
    return isUnderNodeModules(this.form.controls.translationsFolder.value);
  }

  get showNameError(): boolean {
    const control = this.form.controls.name;
    return (control.hasError('required') || control.hasError('nameExists')) && control.touched;
  }

  /** The server refused the name as taken; the next keystroke on the field clears it. */
  get showNameConflict(): boolean {
    return this.form.controls.name.hasError('nameExists');
  }

  get showFolderError(): boolean {
    const control = this.form.controls.translationsFolder;
    return control.hasError('required') && control.touched;
  }

  /** The one line under the locale chips: what clicking does, what is locked, or what empty means. */
  get localesHintToken(): string {
    if (this.isEditMode) return TRACKER_TOKENS.COLLECTIONS.DIALOG.BASEHINTEDIT;
    return this.form.controls.locales.length > 0
      ? TRACKER_TOKENS.COLLECTIONS.DIALOG.BASEHINTCREATE
      : TRACKER_TOKENS.COLLECTIONS.DIALOG.LOCALESINHERITHINT;
  }

  ngOnInit(): void {
    if (this.isEditMode && this.#data.config) {
      const configLocales = this.#data.config.locales ?? [];
      this.#originalLocales = [...configLocales];

      this.form.patchValue({
        name: this.#data.name ?? '',
        translationsFolder: this.#data.config.translationsFolder ?? '',
        baseLocale: this.#data.config.baseLocale ?? '',
        readOnly: this.#data.config.readOnly ?? false,
      });

      this.tagsList.set(this.#data.config.tags ?? []);
      this.protectedTerms.seedRaw(this.#data.config.protectedTerms ?? []);
      this.protectedTermsFile.set(this.#data.config.protectedTermsFile);
      this.protectedTermsFilePath.set(this.#data.config.protectedTermsFilePath);
      this.advancedOpen.set(this.tagsList().length > 0 || this.protectedTermsList().length > 0);
      // An existing read-only flag is the user's prior choice — don't let auto-detection override it.
      this.#readOnlyTouchedByUser = this.#data.config.readOnly !== undefined;

      for (const locale of configLocales) {
        this.form.controls.locales.push(new FormControl<string>(locale, { nonNullable: true }));
      }

      if (this.#data.name) {
        this.form.controls.name.disable();
      }
    }

    // A refusal stays on screen until the next edit.
    this.form.valueChanges.pipe(takeUntilDestroyed(this.#destroyRef)).subscribe(() => this.submitError.set(null));

    // Auto-default read-only for node_modules paths until the user overrides it.
    this.form.controls.translationsFolder.valueChanges
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((folder) => {
        if (this.#readOnlyTouchedByUser) return;
        this.form.controls.readOnly.setValue(isUnderNodeModules(folder), { emitEvent: false });
      });
  }

  onReadOnlyToggle(): void {
    this.#readOnlyTouchedByUser = true;
  }

  toggleAdvanced(): void {
    this.advancedOpen.update((open) => !open);
  }

  /**
   * The locale shown as BASE. In edit mode a collection without its own `baseLocale` inherits the
   * global one, so the inherited value is what gets marked and locked; only an explicit choice
   * is ever written back.
   */
  get displayedBaseLocale(): string {
    const own = this.form.controls.baseLocale.value;
    if (own) return own;
    return this.isEditMode ? (this.#data.effectiveBaseLocale ?? '') : '';
  }

  isBaseLocale(locale: string): boolean {
    return this.displayedBaseLocale === locale;
  }

  /** The base locale is a create-time decision; after that it anchors every checksum and is locked. */
  setBaseLocale(locale: string): void {
    if (this.isEditMode) return;
    if (!this.form.controls.locales.getRawValue().includes(locale)) return;
    this.form.controls.baseLocale.setValue(locale);
  }

  canRemoveLocale(index: number): boolean {
    const locale = this.form.controls.locales.at(index)?.value;
    return !(this.isEditMode && locale === this.displayedBaseLocale);
  }

  addLocale(): void {
    const input = this.addLocaleInput.value.trim().toLowerCase();
    if (!input) return;

    try {
      validateLocale(input);
    } catch {
      this.addLocaleInput.setErrors({ invalidLocale: true });
      this.addLocaleInput.markAsTouched();
      return;
    }

    const currentLocales = this.form.controls.locales.getRawValue();
    if (currentLocales.includes(input)) {
      this.addLocaleInput.setErrors({ duplicateLocale: true });
      this.addLocaleInput.markAsTouched();
      return;
    }

    this.addLocaleInput.setErrors(null);
    this.form.controls.locales.push(new FormControl<string>(input, { nonNullable: true }));

    if (!this.isEditMode && this.form.controls.locales.length === 1) {
      this.form.controls.baseLocale.setValue(input);
    }

    this.addLocaleInput.setValue('');
  }

  /** Leaving the input with a locale typed but not confirmed should not silently drop it. */
  addLocaleIfPending(): void {
    if (this.addLocaleInput.value.trim()) {
      this.addLocale();
    }
  }

  /** Enter or comma commits the typed tag or term, like the Material chip input it replaces. */
  onChipInputKeydown(event: KeyboardEvent, input: HTMLInputElement, kind: 'tag' | 'term'): void {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    this.commitChipInput(input, kind);
  }

  commitChipInput(input: HTMLInputElement, kind: 'tag' | 'term'): void {
    if (!input.value.trim()) {
      input.value = '';
      return;
    }
    if (kind === 'tag') {
      this.addTagValue(input.value);
    } else {
      this.addProtectedTermValue(input.value);
    }
    input.value = '';
  }

  addTagValue(value: string): void {
    const tags = this.tagsList();
    const next = addTagToList(tags, value);
    if (next !== tags) this.tagsList.set([...next]);
  }

  addCollectionTag(event: MatChipInputEvent): void {
    this.addTagValue(event.value);
    event.chipInput?.clear();
  }

  removeCollectionTag(tag: string): void {
    this.tagsList.update((tags) => [...removeTagFromList(tags, tag)]);
  }

  /**
   * Adds a protected term, trimming and deduping case-sensitively while preserving
   * the entered casing and punctuation (`iPhone`, `Node.js`, `C++` stay verbatim).
   */
  addProtectedTermValue(value: string): void {
    this.protectedTerms.add(value);
  }

  addProtectedTerm(event: MatChipInputEvent): void {
    this.addProtectedTermValue(event.value);
    event.chipInput?.clear();
  }

  removeProtectedTerm(term: string): void {
    this.protectedTerms.remove(term);
  }

  removeLocale(index: number): void {
    if (!this.canRemoveLocale(index)) {
      return;
    }

    const removedLocale = this.form.controls.locales.at(index).value;
    this.form.controls.locales.removeAt(index);

    if (!this.isEditMode && this.form.controls.baseLocale.value === removedLocale) {
      const first = this.form.controls.locales.at(0);
      this.form.controls.baseLocale.setValue(first ? first.value : '');
    }
  }

  onCancel(): void {
    this.#dialogRef.close();
  }

  async onSubmit(): Promise<void> {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    if (this.isEditMode) {
      const localesArray = this.form.controls.locales.getRawValue();
      const removedLocales = this.#originalLocales.filter((l) => !localesArray.includes(l));

      if (removedLocales.length > 0) {
        const confirmed = await this.#confirm({
          title: this.#translocoService.translate(TRACKER_TOKENS.COLLECTIONS.DIALOG.REMOVECONFIRMTITLE),
          message: this.#translocoService.translate(TRACKER_TOKENS.COLLECTIONS.DIALOG.REMOVECONFIRMBODY, {
            locales: removedLocales.join(', '),
          }),
          confirmButtonText: this.#translocoService.translate(TRACKER_TOKENS.COMMON.ACTIONS.SAVE),
          actionType: 'destructive',
        });
        if (confirmed) this.#save();
        return;
      }
    }

    this.#save();
  }

  #save(): void {
    const result = this.#buildResult();
    const existingName = this.isEditMode ? this.#data.name : undefined;
    this.submitError.set(null);
    this.#namedEntrySubmit.submit({
      existingName,
      name: result.name,
      create: () => this.#store.createCollection({ name: result.name, collection: result.config }),
      update: (name, patch) => this.#store.updateCollection(name, { ...patch, collection: result.config }),
      result,
      onRefusal: (refusal) => {
        if (refusal.kind === 'message') this.submitError.set(refusal.message);
      },
    });
  }

  #buildResult(): CollectionFormResult {
    const raw = this.form.getRawValue();
    const localesArray = raw.locales;
    const tags = this.tagsList();
    const protectedTermsFile = this.protectedTermsFile();
    const protectedTerms = this.protectedTermsList();
    return {
      name: raw.name,
      config: {
        translationsFolder: raw.translationsFolder,
        // Always sent: an empty list is how "remove every own locale, inherit global" reaches the API.
        locales: localesArray,
        // The base locale is create-time-only and locked once a collection exists (see
        // `setBaseLocale`/`displayedBaseLocale`), so there is no form path that clears an existing
        // override — omitting it here when unset is therefore always correct, never a lost edit.
        ...(raw.baseLocale ? { baseLocale: raw.baseLocale } : {}),
        readOnly: raw.readOnly,
        // Always sent: an empty list is how "remove every tag" reaches the API.
        tags,
        // Always sent: '' is how "no file for this collection" reaches the API. The pointer
        // itself isn't user-editable here, so this mirrors whatever was loaded; the terms are
        // only sent when there is a file to write them to.
        protectedTermsFile: protectedTermsFile ?? '',
        ...(protectedTermsFile ? { protectedTerms } : {}),
      },
    };
  }
}
