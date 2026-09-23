import { OverlayModule } from '@angular/cdk/overlay';
import { TextFieldModule } from '@angular/cdk/text-field';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  type AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  HostListener,
  inject,
  type OnDestroy,
  type OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatAutocompleteModule, type MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type {
  CreateResourceResponseDto,
  FolderNodeDto,
  ResourceSummaryDto,
  SearchResultDto,
  TranslationStatus,
  UpdateResourceResponseDto,
} from '@simoncodes-ca/data-transfer';
import {
  applyPreferredTerm,
  findPreferredTermFindings,
  type PreferredTermRule,
  resolveResourceKey,
  summaryTarget,
} from '@simoncodes-ca/domain';
import { of, Subject } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap, takeUntil, tap } from 'rxjs/operators';
import { TRACKER_TOKENS } from '../../../../i18n-types/tracker-resources';
import { CollectionsStore } from '../../../collections/store/collections.store';
import { ConfirmationDialog } from '../../../shared/components/confirmation-dialog/confirmation-dialog';
import type { ConfirmationDialogData } from '../../../shared/components/confirmation-dialog/confirmation-dialog-data';
import { NotificationService } from '../../../shared/notification';
import { statusLabelTokenFor } from '../../../shared/translation-status/translation-status-presentation';
import { segmentValidator } from '../../../shared/validators/segment.validator';
import { BrowserApiService } from '../../services/browser-api.service';
import { BrowserStore } from '../../store/browser.store';
import { filterFolderTree } from '../../store/folder-tree.utils';
import { FolderPicker } from './folder-picker/folder-picker';
import { PreferredTermAdvisories } from './preferred-term-advisories/preferred-term-advisories';
import {
  absorbDottedKey,
  addTag,
  type ContextTreeNode,
  collisionFor,
  contextTree,
  editedLocales,
  folderEntryKeys,
  hasUnsavedChanges,
  type KnownEntries,
  type LocaleDraft,
  removeTag,
  type ResourceEntryDraft,
  toCreateDto,
  toUpdateDto,
} from './resource-entry-draft';
import { SimilarTranslations } from './similar-translations';
import { filterSimilarByValue, SIMILAR_SEARCH_MAX_RESULTS } from './similar-value-filter';

/**
 * The id of the dialog's heading. The MatDialog container is labelled by this id
 * (`ariaLabelledBy`) and the template stamps it onto the `<h2>`, so the two can
 * never drift apart.
 */
export const TRANSLATION_EDITOR_TITLE_ID = 'translation-editor-title';

/** Id of the preferred-terminology advisories, joined to the base value's `aria-describedby`. */
export const PREFERRED_TERM_ADVISORIES_ID = 'translation-editor-preferred-terms';

/** Typing pause before preferred-terminology findings refresh; matches the similar search. */
export const PREFERRED_TERM_DEBOUNCE_MS = 300;

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

export interface TranslationEditorResult {
  key: string;
  baseValue: string;
  comment?: string;
  folderPath: string;
  translations?: LocaleDraft[];
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
  styleUrls: ['./translation-editor-dialog.scss', './translation-editor-context.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    OverlayModule,
    TextFieldModule,
    MatAutocompleteModule,
    SimilarTranslations,
    FolderPicker,
    TranslocoPipe,
    MatTooltipModule,
    PreferredTermAdvisories,
  ],
})
export class TranslationEditorDialog implements OnInit, OnDestroy, AfterViewInit {
  private readonly dialogRef = inject(MatDialogRef<TranslationEditorDialog>);
  private readonly dialog = inject(MatDialog);
  private readonly browserApi = inject(BrowserApiService);
  private readonly browserStore = inject(BrowserStore);
  private readonly notifications = inject(NotificationService);
  private readonly transloco = inject(TranslocoService);
  readonly #collectionsStore = inject(CollectionsStore);
  private readonly destroy$ = new Subject<void>();
  private readonly baseValueSearch$ = new Subject<string>();

  readonly data = inject<TranslationEditorDialogData>(MAT_DIALOG_DATA);
  readonly TOKENS = TRACKER_TOKENS;
  /** Exposed to the template so the heading id matches the container's `aria-labelledby`. */
  readonly titleId = TRANSLATION_EDITOR_TITLE_ID;

  @ViewChild('keyInput') keyInput?: ElementRef<HTMLInputElement>;
  @ViewChild('baseValueInput') baseValueInput?: ElementRef<HTMLTextAreaElement>;
  /** The Comment field, so the empty-comment confirmation can hand the caret to it. */
  @ViewChild('commentInput') commentInput?: ElementRef<HTMLTextAreaElement>;
  /** The tree inside the location popover, so "New folder" can reuse its creation flow. */
  @ViewChild(FolderPicker) folderPicker?: FolderPicker;
  /** Focus anchors: opening a panel moves focus in, closing it hands focus back. */
  @ViewChild('locationPill') locationPill?: ElementRef<HTMLButtonElement>;
  @ViewChild('otherLocalesRow') otherLocalesRow?: ElementRef<HTMLButtonElement>;
  @ViewChild('folderFilterInput') folderFilterInput?: ElementRef<HTMLInputElement>;
  @ViewChild('drawerFirstControl') drawerFirstControl?: ElementRef<HTMLElement>;

  #commentConfirmationShown = false;
  /** The draft as the dialog opened, for the unsaved-work check and the similar search. */
  #initialDraft: ResourceEntryDraft | undefined;
  /**
   * The folder path this dialog last derived from a dotted key. Typing `a.` then
   * `b.` has to extend `a`, not re-anchor on `b`; a folder the user picked on the
   * Location tab is never extended, only replaced.
   */
  #folderFromKey: string | null = null;
  #locationFlashTimer: ReturnType<typeof setTimeout> | undefined;
  #keyCopiedTimer: ReturnType<typeof setTimeout> | undefined;

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly similarResources = signal<SearchResultDto[]>([]);
  readonly isSearchingSimilar = signal(false);
  readonly baseValueLength = signal(0);
  /** The English value as typed, for the exact-match test against the pinned hits. */
  readonly baseValueText = signal('');
  /** True while the location pill is highlighting a folder it just absorbed from the key field. */
  readonly locationAbsorbedFlash = signal(false);
  /** Live-region text announcing the same move to a screen reader, which cannot see the flash. */
  readonly locationAbsorbedMessage = signal('');
  /** Set once the user attempts to save, so errors surface on untouched fields too. */
  readonly submitAttempted = signal(false);
  /** True for a moment after the footer key is copied, so the button can confirm it. */
  readonly keyJustCopied = signal(false);

  /** The folder picker popover anchored to the location pill. */
  readonly isFolderPopoverOpen = signal(false);
  /** The folder staged inside the popover; only committed by "Use this folder". */
  readonly stagedFolderPath = signal<string | null>(null);
  /** Filter text typed in the popover, matched against folder paths. */
  readonly folderFilter = signal('');
  /** The other-locales drawer sliding over the context column. */
  readonly isLocalesDrawerOpen = signal(false);
  /** The context disclosure shown in place of the column below 1100px. */
  readonly isContextOpen = signal(false);
  /**
   * Entry keys per folder path, loaded once each and kept for the dialog's life.
   * The browser's own folder is never re-fetched — the store already holds it —
   * and picking a folder in the popover never moves the browser behind us.
   */
  readonly #loadedFolderEntries = signal<ReadonlyMap<string, readonly string[]>>(new Map());
  /** Folders whose entries are in flight. A folder in here claims no collision yet. */
  readonly #loadingFolders = signal<ReadonlySet<string>>(new Set());

  /**
   * The base value preferred terminology is checked against. Lags the field by a
   * typing pause, except on open and after "Use …", where it is set at once.
   */
  readonly #terminologyCheckedValue = signal('');

  /**
   * Rules from `GET /config`. A rule file that failed to load yields none (D1):
   * the Settings page reports the error, the editor stays quiet.
   */
  readonly #preferredTermRules = computed<readonly PreferredTermRule[]>(() => {
    const config = this.#collectionsStore.config();
    if (!config || config.preferredTerminologyError) {
      return [];
    }
    return config.preferredTerminology ?? [];
  });

  /** One finding per rule the base value breaks. Advice only: never feeds validity. */
  readonly preferredTermFindings = computed(() => {
    const rules = this.#preferredTermRules();
    const value = this.#terminologyCheckedValue();
    return rules.length > 0 && value ? findPreferredTermFindings(value, rules) : [];
  });

  readonly preferredTermAdvisoriesId = PREFERRED_TERM_ADVISORIES_ID;

  /**
   * The base value's `aria-describedby`: the error or ICU hint as before, plus
   * the advisories while there are any.
   */
  readonly baseValueDescribedBy = computed(() => {
    const ids = [this.showBaseValueError() ? 'translation-editor-base-value-error' : 'translation-editor-icu-hint'];
    if (this.preferredTermFindings().length > 0) {
      ids.push(PREFERRED_TERM_ADVISORIES_ID);
    }
    return ids.join(' ');
  });

  readonly tagInputText = signal('');
  readonly tagsList = signal<readonly string[]>([]);
  readonly inheritedTagsList = computed(() => this.data.resource?.inheritedTags ?? []);

  readonly form = new FormGroup({
    key: new FormControl<string>('', {
      validators: [Validators.required, segmentValidator],
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
      ? TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.EDITSUBTITLEX
      : TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.CREATESUBTITLEX,
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
   * The entry being edited, by its own key. Edit mode locks the key, so the
   * draft module never lets it collide with itself and marks it `editing`.
   */
  readonly #ownKey = this.data.mode === 'edit' ? this.data.resource?.entryKey : undefined;

  /** Everything the draft module needs to know which entries a folder holds. */
  readonly #knownEntries = computed<KnownEntries>(() => ({
    rootFolders: this.rootFolders(),
    browserFolderPath: this.browserStore.currentFolderPath(),
    browserEntries: this.browserStore.translations(),
    fetched: this.#loadedFolderEntries(),
  }));

  /** Live "this key is already taken in the target folder" state; see `collisionFor`. */
  readonly keyCollision = computed(() => {
    this.formRevision();
    return collisionFor(this.form.controls.key.value, this.selectedFolderPath(), this.#knownEntries(), this.#ownKey);
  });

  /** Live form validity, for the footer's earned check glyph. */
  readonly isFormValid = computed(() => {
    this.formRevision();
    return this.form.valid && !this.keyCollision();
  });

  /** True once the key control is both invalid and worth complaining about. */
  readonly showKeyError = computed(() => {
    this.formRevision();
    return this.form.controls.key.invalid && (this.form.controls.key.touched || this.submitAttempted());
  });

  /** True once the English value is both missing and worth complaining about. */
  readonly showBaseValueError = computed(() => {
    this.formRevision();
    return this.form.controls.baseValue.invalid && (this.form.controls.baseValue.touched || this.submitAttempted());
  });

  /** Transloco token for a status label, from the shared status presentation, so the spine never shows raw enum text. */
  readonly statusLabelToken = statusLabelTokenFor;

  /** Explains a disabled Other locales row instead of leaving it silently grey. */
  readonly otherLocalesDisabledTooltip = computed(() =>
    this.otherLocales().length === 0
      ? this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.NOOTHERLOCALESTOOLTIP)
      : '',
  );

  /** Explains a disabled location trigger instead of leaving it silently grey. */
  readonly locationDisabledTooltip = computed(() =>
    this.isReadOnly() ? this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.READONLYTABTOOLTIP) : '',
  );

  /** The complete dot-delimited key, for the location pill's tooltip. */
  readonly fullKeyPreview = computed(() => {
    this.formRevision();
    const folder = this.selectedFolderPath();
    const key = this.form.controls.key.value.trim();
    return key ? resolveResourceKey(key, folder) : folder;
  });

  /** The base locale under a name a reader recognises ("English"), for the value label. */
  readonly baseLocaleName = computed(() => this.getLocaleDisplayName(this.data.baseLocale));

  /** The target folder split into the segments the location pill renders with `›` between them. */
  readonly folderSegments = computed(() =>
    this.selectedFolderPath()
      .split('.')
      .filter((segment) => segment.length > 0),
  );

  /** Every non-base locale with the value and status the form currently holds. */
  readonly localeSummaries = computed<LocaleDraft[]>(() => {
    this.formRevision();
    return this.form.controls.translations.controls.map((group) => group.getRawValue());
  });

  /**
   * The locales a reviewer still owes work on. The context column lists these
   * alone: a locale that is already translated or verified is not news.
   */
  readonly localesNeedingWork = computed<LocaleDraft[]>(() =>
    this.localeSummaries().filter((locale) => locale.status === 'new' || locale.status === 'stale'),
  );

  /** Locales that are new or stale: the ones a reviewer still owes work on. */
  readonly needWorkCount = computed(() => this.localesNeedingWork().length);

  /** The right-hand summary on the "Other locales" row, already localized. */
  readonly otherLocalesSummary = computed(() =>
    this.isEditMode()
      ? this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.NEEDWORKX, { count: this.needWorkCount() })
      : this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.AUTOTRANSLATEDX, {
          count: this.otherLocales().length,
        }),
  );

  /** How many similar values are pinned in the context column right now. */
  readonly similarCount = computed(() => this.similarResources().length);

  /**
   * The similar-values block only exists once the search has hits to show. It
   * never stands in for a pending search: the results clear the moment the
   * English value changes, so an empty block would be a placeholder, not news.
   */
  readonly showSimilarContext = computed(() => this.similarCount() > 0);

  /**
   * A pinned hit whose base value is the typed value, ignoring case. The entry
   * is not merely similar — it is the same string under a key that already
   * exists, which is the one case worth saying out loud.
   */
  readonly exactMatch = computed(() => {
    const typed = this.baseValueText().trim().toLowerCase();
    if (!typed) {
      return undefined;
    }
    return this.similarResources().find((result) => result.base.value.trim().toLowerCase() === typed);
  });

  /** The key carrying the exact same text, or '' when no hit matches verbatim. */
  readonly exactMatchKey = computed(() => this.exactMatch()?.fullKey ?? '');

  /** The one-line summary the narrow "Context" disclosure carries. */
  readonly contextSummary = computed(() => {
    // The key itself is not summarised here: the footer carries it in full, and
    // the form's own key error carries the collision.
    const parts = [
      this.selectedFolderPath() || this.transloco.translate(TRACKER_TOKENS.BROWSER.FOLDERPICKER.ROOTLABEL),
    ];
    if (this.similarCount() > 0) {
      parts.push(
        this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.CONTEXT.SIMILARCOUNTX, {
          count: this.similarCount(),
        }),
      );
    }
    return parts.join(' · ');
  });

  /** The mini tree in "Where it lands"; see `contextTree` in the draft module. */
  readonly contextTree = computed<ContextTreeNode[]>(() => {
    this.formRevision();
    return contextTree(
      {
        folderPath: this.selectedFolderPath(),
        key: this.form.controls.key.value,
        known: this.#knownEntries(),
        loadingFolders: this.#loadingFolders(),
        ownKey: this.#ownKey,
      },
      (count) => this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.CONTEXT.MOREENTRIESX, { count }),
    );
  });

  /** Root folders narrowed by the popover's filter, pruned to the matching subtrees. */
  readonly filteredRootFolders = computed(() => filterFolderTree(this.rootFolders(), this.folderFilter()));

  /** The folder the popover's primary button would commit. */
  readonly popoverFolderPath = computed(() => this.stagedFolderPath() ?? this.selectedFolderPath());

  /**
   * App-owned markup, never translator input, so the ICU hint can carry a <code>
   * run. The braces are HTML entities: a literal `{count}` handed to Transloco
   * as a parameter is re-read as an ICU argument and resolves to `undefined`.
   */
  readonly icuPlaceholderMarkup = '<code>&#123;count&#125;</code>';

  readonly allTagSuggestions = computed(() => {
    const seen = new Set<string>();
    for (const resource of this.browserStore.translations()) {
      for (const tag of resource.tags) {
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
    this.#setSelectedFolder(this.data.folderPath || '');
    this.#initializeOtherLocaleFormControls();

    if (this.isEditMode() && this.data.resource) {
      const baseValue = this.data.resource.base.value;
      const comment = this.data.resource.comment || '';

      this.form.patchValue({
        key: this.data.resource.entryKey,
        baseValue,
        comment,
      });

      this.tagsList.set([...this.data.resource.tags]);

      this.#populateOtherLocaleTranslations();
    }

    this.#initialDraft = this.#draft();

    this.#setupSimilarResourcesSearch();
    this.#setupPreferredTermCheck();

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
    if (this.isReadOnly() || this.isSubmitting() || !this.#initialDraft) {
      return false;
    }
    return hasUnsavedChanges(this.#draft(), this.#initialDraft, this.form.dirty);
  }

  /** The form, the target folder and the tags as one plain draft. */
  #draft(): ResourceEntryDraft {
    const { key, baseValue, comment, translations } = this.form.getRawValue();
    return { key, baseValue, comment, translations, folderPath: this.selectedFolderPath(), tags: this.tagsList() };
  }

  /** The entry an edit started from, or undefined in create mode. */
  #originalEntry(): ResourceSummaryDto | undefined {
    return this.isEditMode() ? this.data.resource : undefined;
  }

  ngOnDestroy(): void {
    clearTimeout(this.#locationFlashTimer);
    clearTimeout(this.#keyCopiedTimer);
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
      const target = this.data.resource ? summaryTarget(this.data.resource, locale) : undefined;
      const value = target?.value ?? '';
      const status = target?.status ?? 'new';

      control.patchValue({ value, status });
    });
  }

  #setupSimilarResourcesSearch(): void {
    this.form.controls.baseValue.valueChanges.pipe(takeUntil(this.destroy$)).subscribe((value) => {
      this.baseValueLength.set(value.trim().length);
      this.baseValueText.set(value);

      // Hits are pinned to the text that produced them. The moment that text
      // changes they are stale, so they go now rather than after the debounce —
      // a list that no longer describes the field is worse than no list.
      this.similarResources.set([]);

      if (this.#shouldSearchForSimilar(value)) {
        this.baseValueSearch$.next(value);
      } else {
        this.isSearchingSimilar.set(false);
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

          return this.browserApi.searchTranslations(this.data.collectionName, query, SIMILAR_SEARCH_MAX_RESULTS).pipe(
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
        const original = this.#originalEntry();
        const withoutSelf = original
          ? searchResults.results.filter((r) => r.fullKey !== original.fullKey)
          : searchResults.results;

        // The API matches keys too, and reports a key match ahead of a value one.
        // Everything downstream — the count, the exact-duplicate caption, what
        // stays pinned — reads this signal, so the key-only hits go before it.
        this.similarResources.set(filterSimilarByValue(withoutSelf, searchResults.query || this.baseValueText()));
      });
  }

  /**
   * Findings follow the base value after a typing pause, so the notes do not
   * flicker per keystroke. An existing value is checked at once, so an entry
   * that already uses a discouraged term says so as soon as it opens.
   */
  #setupPreferredTermCheck(): void {
    const control = this.form.controls.baseValue;
    this.#terminologyCheckedValue.set(control.value);
    control.valueChanges
      .pipe(debounceTime(PREFERRED_TERM_DEBOUNCE_MS), takeUntil(this.destroy$))
      .subscribe((value) => this.#terminologyCheckedValue.set(value));
  }

  /**
   * "Use …": rewrites the rule's discouraged term to the preferred spelling
   * through the ordinary value-change path, as if typed, and never saves. The
   * note goes at once rather than after the debounce, and the caret goes back
   * to the field because the button it was on no longer exists.
   */
  onApplyPreferredTerm(rule: PreferredTermRule): void {
    if (this.isReadOnly()) {
      return;
    }
    const control = this.form.controls.baseValue;
    const next = applyPreferredTerm(control.value, rule);
    if (next !== control.value) {
      control.markAsDirty();
      control.setValue(next);
    }
    this.#terminologyCheckedValue.set(next);
    this.#focusOnceRendered(() => this.baseValueInput?.nativeElement);
  }

  /**
   * A dotted key typed into the single-segment key field moves its prefix into the
   * location pill; `absorbDottedKey` holds the rule.
   *
   * Listening on `valueChanges` covers every way text arrives: typed, pasted,
   * dropped, or completed by the browser. The segment validator stays on as the
   * backstop for characters that are invalid in any position.
   */
  #setupDottedKeyAbsorption(): void {
    this.form.controls.key.valueChanges.pipe(takeUntil(this.destroy$)).subscribe((value) => {
      const absorbed = absorbDottedKey(value, this.selectedFolderPath(), this.#folderFromKey);
      if (!absorbed) {
        return;
      }

      this.#setKeyControl(absorbed.leaf);

      if (absorbed.folder !== undefined) {
        this.#folderFromKey = absorbed.folder;
        this.#setSelectedFolder(absorbed.folder);
        this.#announceLocationAbsorbed(absorbed.folder);
      }
    });
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
      return currentValue !== this.#initialDraft?.baseValue;
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

  /** The single writer of the target folder, so nothing can move it unseen. */
  #setSelectedFolder(folderPath: string): void {
    this.selectedFolderPath.set(folderPath);
    this.#ensureFolderEntries(folderPath);
  }

  /**
   * Fetches a folder's own entries once, so the collision check and the "Where
   * it lands" tree work for any folder the user picks — not only the one the
   * browser happens to be showing. Deliberately a plain read: the store's
   * `selectFolder` would navigate the list behind the dialog.
   */
  #ensureFolderEntries(folderPath: string): void {
    if (
      this.isEditMode() ||
      folderEntryKeys(folderPath, this.#knownEntries()) ||
      this.#loadingFolders().has(folderPath)
    ) {
      return;
    }

    this.#loadingFolders.update((paths) => new Set(paths).add(folderPath));

    this.browserApi
      .getResourceTree(this.data.collectionName, folderPath, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (tree) => {
          const keys = tree.resources.map((resource) => resource.entryKey);
          this.#loadedFolderEntries.update((entries) => new Map(entries).set(folderPath, keys));
          this.#finishFolderLoad(folderPath);
        },
        // A folder we cannot read claims nothing. The save path still guards.
        error: () => this.#finishFolderLoad(folderPath),
      });
  }

  #finishFolderLoad(folderPath: string): void {
    this.#loadingFolders.update((paths) => {
      const next = new Set(paths);
      next.delete(folderPath);
      return next;
    });
    this.formRevision.update((revision) => revision + 1);
  }

  // ── Location popover ──────────────────────────────────────────────────────

  toggleFolderPopover(): void {
    if (this.isReadOnly()) {
      return;
    }
    if (this.isFolderPopoverOpen()) {
      this.closeFolderPopover();
      return;
    }
    this.openFolderPopover();
  }

  openFolderPopover(): void {
    if (this.isReadOnly()) {
      return;
    }
    this.stagedFolderPath.set(null);
    this.folderFilter.set('');
    this.isFolderPopoverOpen.set(true);
    this.#focusOnceRendered(() => this.folderFilterInput?.nativeElement);
  }

  /**
   * Confirm, Escape and a backdrop click all land here, so focus comes back to
   * the pill that opened the popover rather than the top of the dialog. The
   * `(detach)` binding fires a second time after we have already closed; the
   * `wasOpen` check keeps that from stealing focus from wherever it went next.
   */
  closeFolderPopover(restoreFocus = true): void {
    const wasOpen = this.isFolderPopoverOpen();
    this.isFolderPopoverOpen.set(false);
    this.stagedFolderPath.set(null);
    if (wasOpen && restoreFocus) {
      this.#focusOnceRendered(() => this.locationPill?.nativeElement);
    }
  }

  /** Opens the picker's own inline folder-name field under the staged folder. */
  startNewFolder(): void {
    this.folderPicker?.onAddFolder(this.popoverFolderPath());
  }

  onFolderFilterInput(event: Event): void {
    this.folderFilter.set((event.target as HTMLInputElement).value);
  }

  /** Confirms the folder staged in the popover and closes it. */
  confirmStagedFolder(): void {
    const staged = this.stagedFolderPath();
    if (staged !== null) {
      this.onFolderConfirmed(staged);
    }
    this.closeFolderPopover();
  }

  // ── Other-locales drawer ──────────────────────────────────────────────────

  openLocalesDrawer(): void {
    if (this.otherLocales().length === 0) {
      return;
    }
    this.isLocalesDrawerOpen.set(true);
    this.#focusOnceRendered(() => this.drawerFirstControl?.nativeElement);
  }

  /** Done, Escape and the back arrow all hand focus back to the row that opened it. */
  closeLocalesDrawer(restoreFocus = true): void {
    const wasOpen = this.isLocalesDrawerOpen();
    this.isLocalesDrawerOpen.set(false);
    if (wasOpen && restoreFocus) {
      this.#focusOnceRendered(() => this.otherLocalesRow?.nativeElement);
    }
  }

  /**
   * Focus after the view that holds the target exists. A microtask would run
   * before change detection has rendered a panel that was just opened.
   *
   * `afterFocus` runs on the same element once it holds focus, for callers that
   * also have a caret to place or a field to scroll into view.
   */
  #focusOnceRendered<T extends HTMLElement>(target: () => T | undefined, afterFocus?: (element: T) => void): void {
    setTimeout(() => {
      const element = target();
      if (!element) {
        return;
      }
      element.focus();
      afterFocus?.(element);
    });
  }

  toggleContext(): void {
    this.isContextOpen.update((open) => !open);
  }

  /** Writes a status from the per-locale pill menu into the same FormArray as before. */
  setLocaleStatus(index: number, status: TranslationStatus): void {
    const group = this.getLocaleFormGroup(index);
    group.controls.status.setValue(status);
    group.controls.status.markAsDirty();
  }

  async onCancel(): Promise<void> {
    // Escape and the close button reach here; an open panel is the nearest thing
    // to dismiss, so it goes first and the form stays untouched.
    if (this.isFolderPopoverOpen()) {
      this.closeFolderPopover();
      return;
    }
    if (this.isLocalesDrawerOpen()) {
      this.closeLocalesDrawer();
      return;
    }
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

  /** The picker inside the popover stages a folder; the popover's button commits it. */
  onFolderStaged(folderPath: string): void {
    this.stagedFolderPath.set(folderPath);
  }

  onFolderConfirmed(folderPath: string): void {
    this.#folderFromKey = null;
    this.#setSelectedFolder(folderPath);
  }

  onFolderCreated(folder: FolderNodeDto): void {
    // Store's createFolderAt already updated rootFolders, just update selection
    this.#folderFromKey = null;
    this.#setSelectedFolder(folder.fullPath);
    this.stagedFolderPath.set(folder.fullPath);
  }

  /** Enter and comma commit the typed tag; Backspace on an empty field removes the last one. */
  onTagKeydown(event: KeyboardEvent, input: HTMLInputElement): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.addTagValue(input.value);
      input.value = '';
      return;
    }
    if (event.key === 'Backspace' && input.value === '') {
      const tags = this.tagsList();
      if (tags.length > 0) {
        this.removeTag(tags[tags.length - 1]);
      }
    }
  }

  addTagValue(rawValue: string): void {
    this.tagsList.update((tags) => addTag(tags, rawValue));
    this.tagInputText.set('');
  }

  addTagFromAutocomplete(event: MatAutocompleteSelectedEvent, input: HTMLInputElement): void {
    this.addTagValue(event.option.value as string);
    input.value = '';
  }

  removeTag(tag: string): void {
    this.tagsList.update((tags) => removeTag(tags, tag, this.inheritedTagsList()));
  }

  onTagInputChange(event: Event): void {
    this.tagInputText.set((event.target as HTMLInputElement).value);
  }

  /**
   * Leaves for the entry that already holds this key. Same close payload as the
   * conflict dialog's "Edit existing", and the same unsaved-work guard as any
   * other way out of the dialog.
   */
  async openExistingResource(): Promise<void> {
    const existingKey = resolveResourceKey(this.form.controls.key.value.trim(), this.selectedFolderPath());

    if (this.hasUnsavedChanges() && !(await this.#confirmDiscard())) {
      return;
    }

    this.dialogRef.close({
      key: this.form.controls.key.value,
      baseValue: this.form.controls.baseValue.value,
      comment: this.form.controls.comment.value.trim() || undefined,
      folderPath: this.selectedFolderPath(),
      shouldOpenEdit: true,
      existingResourceKey: existingKey,
    });
  }

  onSimilarResourceClick(result: SearchResultDto): void {
    this.#copyToClipboard(result.fullKey, this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.KEYCOPIED));
  }

  /**
   * The footer is the only place the full dotted key is spelled out, so it is
   * also the place to take it from. Same clipboard path and same snackbar the
   * row's key chip uses, plus a check glyph while the toast is still up.
   */
  copyFullKey(): void {
    this.#copyToClipboard(
      this.fullKeyPreview(),
      this.transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.COPIEDTOCLIPBOARD),
      () => this.#flashKeyCopied(),
    );
  }

  #flashKeyCopied(): void {
    clearTimeout(this.#keyCopiedTimer);
    this.keyJustCopied.set(true);
    this.#keyCopiedTimer = setTimeout(() => this.keyJustCopied.set(false), 1500);
  }

  #copyToClipboard(text: string, successMessage: string, onCopied?: () => void): void {
    const failedMessage = this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.COPYFAILED);

    if (!navigator.clipboard?.writeText) {
      this.notifications.error(failedMessage);
      return;
    }

    navigator.clipboard
      .writeText(text)
      .then(() => {
        this.notifications.success(successMessage);
        onCopied?.();
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

    // The key is already taken, and the writer would overwrite the entry rather
    // than refuse it. Stop before the network and offer the same two ways out
    // the save-time conflict offers, so both routes end in the same place.
    if (this.keyCollision()) {
      this.#showKeyConflictDialog(resolveResourceKey(this.form.controls.key.value.trim(), this.selectedFolderPath()));
      return;
    }

    if (!this.form.controls.comment.value.trim() && !this.#commentConfirmationShown) {
      const shouldProceed = await this.#showCommentConfirmation();

      if (!shouldProceed) {
        return;
      }
    }

    const draft = this.#draft();
    if (this.isEditMode()) {
      this.#handleEditSubmit(draft);
    } else {
      this.#handleCreateSubmit(draft);
    }
  }

  /**
   * Names the problem, dismisses anything covering the form, and puts the caret
   * in the offending field.
   */
  #revealValidationFailure(): void {
    this.submitAttempted.set(true);
    this.form.markAllAsTouched();
    this.formRevision.update((revision) => revision + 1);
    this.errorMessage.set(this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.FIXERRORS));

    // Focus belongs to the offending field, not to whatever opened the panel.
    this.closeFolderPopover(false);
    this.closeLocalesDrawer(false);

    queueMicrotask(() => {
      const target = this.form.controls.key.invalid ? this.keyInput : this.baseValueInput;
      target?.nativeElement.focus();
    });
  }

  #handleEditSubmit(draft: ResourceEntryDraft): void {
    const original = this.#originalEntry();
    if (!original) {
      this.errorMessage.set(this.transloco.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.ERROR.MISSINGRESOURCE));
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    // The key control is readonly in edit mode (`html`), so `draft.key` can only
    // ever equal the original; renaming is a move, handled by the CLI.
    const edited = editedLocales(draft, original);

    this.browserStore.updateResource(this.data.collectionName, toUpdateDto(draft, original)).subscribe({
      next: (response: UpdateResourceResponseDto) => {
        this.dialogRef.close({
          key: draft.key,
          baseValue: draft.baseValue,
          comment: draft.comment.trim() || undefined,
          folderPath: draft.folderPath,
          translations: edited.length > 0 ? edited : undefined,
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

  #handleCreateSubmit(draft: ResourceEntryDraft): void {
    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    const createDto = toCreateDto(draft);

    this.browserStore.createResource(this.data.collectionName, createDto).subscribe({
      next: (response: CreateResourceResponseDto) => {
        this.dialogRef.close({
          key: draft.key,
          baseValue: draft.baseValue,
          comment: createDto.comment,
          folderPath: draft.folderPath,
          translations: createDto.translations,
          success: true,
          skippedLocales: response.skippedLocales?.length ? response.skippedLocales : undefined,
        });
      },
      error: (error: unknown) => {
        this.isSubmitting.set(false);
        this.#handleCreateError(error, createDto.key);
      },
    });
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
      this.#focusCommentField();
    }

    return confirmed === true;
  }

  /**
   * "Add comment" asked for the Comment field, so put the caret in it. The
   * confirmation's focus trap hands focus back to the Save button as it closes,
   * and `afterClosed()` resolves in that same turn — deferring a task past it
   * (the `#focusOnceRendered` pattern) is what keeps CDK from taking it back.
   */
  #focusCommentField(): void {
    this.#focusOnceRendered(
      () => this.commentInput?.nativeElement,
      (textarea) => {
        // The field may be below the fold on a scrolled form.
        textarea.scrollIntoView?.({ block: 'nearest' });
        // Selects whatever is there, so a rewrite types over it; an empty field
        // just parks the caret.
        textarea.setSelectionRange(0, textarea.value.length);
      },
    );
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
