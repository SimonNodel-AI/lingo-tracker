import { LowerCasePipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { ExportFormatDto, ExportJsonStructureDto, TranslationStatus } from '@simoncodes-ca/data-transfer';
import { finalize } from 'rxjs';
import { TRACKER_TOKENS } from '../../../i18n-types/tracker-resources';
import { ChipInput } from '../../shared/chip-input/chip-input';
import { codeMarkup } from '../../shared/code-markup';
import { LOCAL_STORAGE } from '../../shared/storage/browser-storage';
import { addTagToList, removeTagFromList } from '../../shared/tag-list-edit';
import { STATUS_PRESENTATION } from '../../shared/translation-status/translation-status-presentation';
import { splitAfterSeparators } from '../../shared/utils/split-after-separators';
import { SegmentedControl, type SegmentOption } from '../bundle-form-dialog/segmented-control';
import { CollectionsStore } from '../store/collections.store';
import type { ExportDialogData, ExportDialogResult } from './export-dialog-data';
import { ExportForm, type ExportSection } from './export-form';
import { entryShape } from './export-preview';

/** The CLI prompt order. */
const STATUS_ORDER: readonly TranslationStatus[] = ['new', 'stale', 'translated', 'verified'];

type FooterState = 'ready' | 'checking' | 'nothing' | 'invalid' | 'noLocales' | 'previewFailed' | 'planErrors';

@Component({
  selector: 'app-export-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LowerCasePipe,
    NgTemplateOutlet,
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatTooltipModule,
    TranslocoPipe,
    ChipInput,
    SegmentedControl,
  ],
  templateUrl: './export-dialog.html',
  styleUrl: './export-dialog.scss',
})
export class ExportDialog {
  readonly #dialogRef = inject<MatDialogRef<ExportDialog, ExportDialogResult | undefined>>(MatDialogRef);
  readonly #data = inject<ExportDialogData>(MAT_DIALOG_DATA);
  readonly #transloco = inject(TranslocoService);
  readonly #destroyRef = inject(DestroyRef);
  readonly store = inject(CollectionsStore);

  readonly TOKENS = TRACKER_TOKENS;
  readonly STATUS_ORDER = STATUS_ORDER;
  readonly codeMarkup = codeMarkup;
  /** Technical literal, not copy: the placeholder shown in the file name field. */
  readonly localePlaceholder = '{locale}';

  readonly formatOptions: readonly SegmentOption<ExportFormatDto>[] = [
    { value: 'xliff', label: TRACKER_TOKENS.EXPORT.DIALOG.FORMAT.XLIFF, icon: 'description' },
    { value: 'json', label: TRACKER_TOKENS.EXPORT.DIALOG.FORMAT.JSON, icon: 'data_object' },
  ];
  readonly structureOptions: readonly SegmentOption<ExportJsonStructureDto>[] = [
    { value: 'hierarchical', label: TRACKER_TOKENS.EXPORT.DIALOG.JSON.HIERARCHICAL, icon: 'account_tree' },
    { value: 'flat', label: TRACKER_TOKENS.EXPORT.DIALOG.JSON.FLAT, icon: 'view_list' },
  ];

  readonly model = new ExportForm({
    data: this.#data,
    translate: (key) => this.#transloco.translate(key),
    config: () => this.store.config(),
    dryRun: (request) => this.store.dryRunExport(request),
    storage: inject(LOCAL_STORAGE),
  });
  readonly saving = this.model.saving;
  readonly previewOpen = signal(false);
  readonly plan = this.model.preview.plan;

  readonly fileSuffix = computed(() => (this.model.draft().format === 'json' ? '.json' : '.xliff'));
  /** Sections with a visible error, plus Output when the server says the folder is unusable. */
  readonly railErrors = computed<ReadonlySet<string>>(() => {
    const errors = new Set<string>(this.model.sectionErrors());
    if (this.plan()?.outputProblem) errors.add('output');
    return errors;
  });
  readonly statusSummary = computed(() =>
    STATUS_ORDER.filter((status) => this.model.draft().statuses.includes(status)),
  );
  readonly allStatuses = computed(() => this.statusSummary().length === STATUS_ORDER.length);
  readonly collectionCount = computed(() => {
    const draft = this.model.draft();
    const names = this.model.collectionNames();
    return draft.allCollections ? names.length : draft.collections.filter((name) => names.includes(name)).length;
  });
  /** Checklist rows in the Collections page's grid order (case-insensitive by name). */
  readonly collectionRows = computed(() => {
    const collections = this.store.config()?.collections ?? {};
    return [...this.model.collectionNames()]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map((name) => ({
        name,
        folderParts: splitAfterSeparators(collections[name]?.translationsFolder ?? ''),
        readOnly: collections[name]?.readOnly === true,
      }));
  });
  readonly skippedCodes = computed(() =>
    this.skipped()
      .map((entry) => entry.locale)
      .join(', '),
  );
  /** Field-level error flags: shown only once the section's errors are revealed. */
  readonly patternInvalid = computed(
    () =>
      this.model.sectionErrors().has('output') && this.model.form.controls.filenamePattern.hasError('patternLocale'),
  );
  readonly basePropertyInvalid = computed(
    () =>
      this.model.sectionErrors().has('json') &&
      this.model.form.controls.json.controls.basePropertyName.hasError('basePropertyReserved'),
  );
  readonly noTargetLocales = computed(
    () => this.store.config() !== null && this.collectionCount() > 0 && this.model.availableLocales().length === 0,
  );
  readonly dirParts = computed(() => splitAfterSeparators(this.plan()?.outputDirectory ?? ''));
  readonly resolvedPathMarkup = computed(() => this.dirParts().map(codeMarkup).join('<wbr>'));
  readonly files = computed(() =>
    (this.plan()?.files ?? []).map((file) => ({
      ...file,
      parts: splitAfterSeparators(file.path.slice(file.path.lastIndexOf('/') + 1)),
    })),
  );
  readonly skipped = computed(() => this.plan()?.skippedLocales ?? []);
  readonly notes = computed(() => {
    const plan = this.plan();
    return plan ? [...plan.errors, ...plan.hierarchicalConflicts, ...plan.warnings] : [];
  });
  readonly shape = computed(() => entryShape(this.model.draft(), this.plan()?.exampleKey));

  readonly footerState = computed<FooterState>(() => {
    if (this.noTargetLocales()) return 'noLocales';
    if (!this.model.valid()) return 'invalid';
    const preview = this.model.preview;
    if (preview.stale() || preview.status() === 'loading' || preview.status() === 'waiting') return 'checking';
    const plan = this.plan();
    if (preview.status() === 'error') return 'previewFailed';
    if (!plan) return 'checking';
    if (plan.outputProblem) return 'invalid';
    if (plan.errors.length > 0) return 'planErrors';
    return plan.files.length === 0 || plan.entriesTotal === 0 ? 'nothing' : 'ready';
  });
  readonly canSubmit = computed(() => this.footerState() === 'ready' && !this.saving() && !this.store.isExporting());
  readonly primary = computed(() => {
    const plan = this.plan();
    const overwrites = plan?.overwriteCount ?? 0;
    return overwrites > 0
      ? { token: TRACKER_TOKENS.EXPORT.DIALOG.FOOTER.EXPORTOVERWRITEX, count: overwrites }
      : { token: TRACKER_TOKENS.EXPORT.DIALOG.FOOTER.EXPORTX, count: plan?.files.length ?? 0 };
  });

  constructor() {
    // The config can arrive after the dialog opens; reseed and reconcile once it does.
    effect(() => {
      if (this.store.config()) untracked(() => this.model.configLoaded());
    });
    this.#destroyRef.onDestroy(() => this.model.destroy());
  }

  statusLabel(status: TranslationStatus): string {
    return STATUS_PRESENTATION[status].labelToken;
  }

  activate(section: ExportSection): void {
    this.model.activeSection.set(section);
  }

  retryPreview(): void {
    this.model.retryPreview();
  }

  /** The footer's invalid state is actionable: show the errors and jump to the first marked section. */
  fixSections(): void {
    if (!this.model.revealErrors() && this.plan()?.outputProblem) this.activate('output');
  }

  togglePreview(): void {
    this.previewOpen.update((open) => !open);
  }

  toggleCollection(name: string, checked: boolean): void {
    const control = this.model.form.controls.collections;
    const rest = control.value.filter((existing) => existing !== name);
    control.markAsTouched();
    control.setValue(checked ? [...rest, name] : rest);
  }

  toggleLocale(locale: string): void {
    const control = this.model.form.controls.locales;
    const next = control.value.includes(locale)
      ? control.value.filter((existing) => existing !== locale)
      : [...control.value, locale];
    control.markAsTouched();
    control.setValue(next);
  }

  toggleStatus(status: TranslationStatus): void {
    const control = this.model.form.controls.statuses;
    const next = control.value.includes(status)
      ? control.value.filter((existing) => existing !== status)
      : [...control.value, status];
    control.markAsTouched();
    control.setValue(STATUS_ORDER.filter((candidate) => next.includes(candidate)));
  }

  selectAllStatuses(): void {
    this.model.form.controls.statuses.setValue([...STATUS_ORDER]);
  }

  addTag(raw: string): void {
    const control = this.model.form.controls.tags;
    const tags = addTagToList(control.value, raw);
    if (tags !== control.value) control.setValue([...tags]);
  }

  removeTag(tag: string): void {
    const control = this.model.form.controls.tags;
    control.setValue([...removeTagFromList(control.value, tag)]);
  }

  onCancel(): void {
    this.#dialogRef.close(undefined);
  }

  onSubmit(): void {
    if (!this.canSubmit()) return;
    // A start request in flight must not be orphaned by Esc or a backdrop click.
    this.#dialogRef.disableClose = true;
    this.model
      .submit((request) => this.store.startExport(request))
      .pipe(
        finalize(() => {
          this.#dialogRef.disableClose = false;
        }),
        takeUntilDestroyed(this.#destroyRef),
      )
      .subscribe({ next: (job) => this.#dialogRef.close(job), error: () => undefined });
  }
}
