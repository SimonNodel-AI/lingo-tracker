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
import type { ImportStrategyDto } from '@simoncodes-ca/data-transfer';
import { finalize } from 'rxjs';
import { TRACKER_TOKENS } from '../../../i18n-types/tracker-resources';
import { codeMarkup } from '../../shared/code-markup';
import { LOCAL_STORAGE } from '../../shared/storage/browser-storage';
import { STATUS_PRESENTATION } from '../../shared/translation-status/translation-status-presentation';
import { splitAfterSeparators } from '../../shared/utils/split-after-separators';
import { CollectionsStore } from '../store/collections.store';
import { formatModified } from './format-modified';
import type { ImportDialogData, ImportDialogResult } from './import-dialog-data';
import { changedAdvancedCount, changedOptionCount, effectiveOptions } from './import-draft';
import { type FilesProblem, ImportForm, type ImportSection } from './import-form';

type FooterState =
  | 'ready'
  | 'checking'
  | 'nothing'
  | 'noFiles'
  | 'invalid'
  | 'readOnly'
  | 'previewFailed'
  | 'planErrors';

interface StrategyCard {
  readonly value: ImportStrategyDto;
  readonly title: string;
  readonly hint: string;
}

const STRATEGY_CARDS: readonly StrategyCard[] = [
  {
    value: 'translation-service',
    title: TRACKER_TOKENS.IMPORT.DIALOG.STRATEGY.TRANSLATIONSERVICE,
    hint: TRACKER_TOKENS.IMPORT.DIALOG.STRATEGY.TRANSLATIONSERVICEHINT,
  },
  {
    value: 'verification',
    title: TRACKER_TOKENS.IMPORT.DIALOG.STRATEGY.VERIFICATION,
    hint: TRACKER_TOKENS.IMPORT.DIALOG.STRATEGY.VERIFICATIONHINT,
  },
  {
    value: 'migration',
    title: TRACKER_TOKENS.IMPORT.DIALOG.STRATEGY.MIGRATION,
    hint: TRACKER_TOKENS.IMPORT.DIALOG.STRATEGY.MIGRATIONHINT,
  },
  {
    value: 'update',
    title: TRACKER_TOKENS.IMPORT.DIALOG.STRATEGY.UPDATE,
    hint: TRACKER_TOKENS.IMPORT.DIALOG.STRATEGY.UPDATEHINT,
  },
];

const PROBLEM_MESSAGES: Readonly<Record<FilesProblem, string>> = {
  filesRequired: TRACKER_TOKENS.IMPORT.DIALOG.VALIDATION.FILESREQUIRED,
  // Only a replayed request can repeat a path; the checklist cannot, so the generic file message serves.
  duplicatePath: TRACKER_TOKENS.IMPORT.DIALOG.VALIDATION.FILESREQUIRED,
  localeRequired: TRACKER_TOKENS.IMPORT.DIALOG.VALIDATION.LOCALEREQUIRED,
  baseLocaleNeedsMigration: TRACKER_TOKENS.IMPORT.DIALOG.VALIDATION.BASELOCALENEEDSMIGRATION,
};

/** Rows listed beyond this stay in the well's scroll area; the stagger stops here. */
const STAGGER_ROWS = 12;
const ISSUE_ROWS = 5;
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * 1024;
const DISPLAY_DECIMALS = 1;

function sizeLabel(bytes: number): string {
  // Technical units, not copy.
  return bytes >= BYTES_PER_MB
    ? `${(bytes / BYTES_PER_MB).toFixed(DISPLAY_DECIMALS)} MB`
    : `${Math.round(bytes / BYTES_PER_KB)} KB`;
}

@Component({
  selector: 'app-import-dialog',
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
  ],
  templateUrl: './import-dialog.html',
  styleUrl: './import-dialog.scss',
})
export class ImportDialog {
  readonly #dialogRef = inject<MatDialogRef<ImportDialog, ImportDialogResult | undefined>>(MatDialogRef);
  readonly #data = inject<ImportDialogData>(MAT_DIALOG_DATA);
  readonly #transloco = inject(TranslocoService);
  readonly #destroyRef = inject(DestroyRef);
  readonly store = inject(CollectionsStore);

  readonly TOKENS = TRACKER_TOKENS;
  readonly strategyCards = STRATEGY_CARDS;
  readonly stagger = STAGGER_ROWS;
  readonly issueRows = ISSUE_ROWS;
  readonly statusLabel = (status: keyof typeof STATUS_PRESENTATION): string => STATUS_PRESENTATION[status].labelToken;

  readonly model = new ImportForm({
    data: this.#data,
    translate: (key) => this.#transloco.translate(key),
    config: () => this.store.config(),
    listSources: (collection, folder) => this.store.listImportSources(collection, folder),
    dryRun: (request) => this.store.dryRunImport(request),
    storage: inject(LOCAL_STORAGE),
  });
  readonly saving = this.model.saving;
  readonly previewOpen = signal(false);
  readonly #advancedChoice = signal<boolean | undefined>(undefined);
  /** Open by default when no primary option rows are shown (every strategy but migration); never persisted. */
  readonly advancedOpen = computed(() => this.#advancedChoice() ?? !this.isMigration());
  readonly listing = this.model.listing;

  /** A previous plan is never shown beside a failed preview. */
  readonly plan = computed(() => (this.model.preview.status() === 'error' ? undefined : this.model.preview.plan()));
  readonly options = computed(() => effectiveOptions(this.model.draft()));
  readonly isMigration = computed(() => this.model.draft().strategy === 'migration');
  readonly changedOptions = computed(() => changedOptionCount(this.model.draft()));
  readonly changedAdvanced = computed(() => changedAdvancedCount(this.model.draft()));
  readonly strategyTitle = computed(
    () => STRATEGY_CARDS.find((card) => card.value === this.model.draft().strategy)?.title ?? '',
  );
  readonly strategyNote = computed(() =>
    this.isMigration()
      ? TRACKER_TOKENS.IMPORT.DIALOG.STRATEGY.MIGRATIONNOTE
      : TRACKER_TOKENS.IMPORT.DIALOG.STRATEGY.PROTECTEDNOTE,
  );
  readonly railErrors = computed<ReadonlySet<string>>(() => new Set<string>(this.model.sectionErrors()));

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
  readonly folderShown = computed(() => this.model.listing()?.folder ?? this.model.draft().folder.trim());
  /** The folder as mono `<code>` runs that may break after each separator, as export's resolved path. */
  readonly folderMarkup = computed(() => splitAfterSeparators(this.folderShown()).map(codeMarkup).join('<wbr>'));
  readonly fileRows = computed(() =>
    this.model.rows().map((row) => ({
      ...row,
      formatToken:
        row.file.format === 'json'
          ? TRACKER_TOKENS.EXPORT.DIALOG.FORMAT.JSON
          : TRACKER_TOKENS.EXPORT.DIALOG.FORMAT.XLIFF,
      size: sizeLabel(row.file.sizeBytes),
      modified: formatModified(row.file.modifiedAt, new Date(), this.#transloco.getActiveLang()),
    })),
  );
  readonly allChecked = computed(() => {
    const selectable = this.model.rows().filter((row) => !row.blocked);
    return selectable.length > 0 && selectable.every((row) => row.checked);
  });
  readonly folderEmpty = computed(
    () =>
      this.model.listingStatus() === 'ready' && this.model.listing()?.exists === true && this.fileRows().length === 0,
  );
  readonly folderMissing = computed(
    () => this.model.listingStatus() === 'ready' && this.model.listing()?.exists === false,
  );
  /** Field-level messages: shown only once the section's errors are revealed. */
  readonly collectionError = computed(() => {
    if (!this.model.sectionErrors().has('source')) return undefined;
    const control = this.model.form.controls.collection;
    if (control.hasError('collectionReadOnly')) return TRACKER_TOKENS.IMPORT.DIALOG.VALIDATION.COLLECTIONREADONLY;
    return control.hasError('collectionRequired')
      ? TRACKER_TOKENS.IMPORT.DIALOG.VALIDATION.COLLECTIONREQUIRED
      : undefined;
  });
  readonly filesError = computed(() => {
    const problem = this.model.problem();
    const control = this.model.form.controls.files;
    return problem &&
      control.invalid &&
      (control.touched || this.model.submitAttempted() || this.model.hasObsoleteLocale())
      ? PROBLEM_MESSAGES[problem]
      : undefined;
  });

  readonly notes = computed(() => {
    const plan = this.plan();
    if (!plan) return [];
    const sizes = new Map((this.model.listing()?.files ?? []).map((file) => [file.path, file.sizeBytes]));
    const large = plan.largeFiles.map((path) => ({
      token: TRACKER_TOKENS.IMPORT.DIALOG.PREVIEW.LARGEFILEX,
      params: { size: ((sizes.get(path) ?? 0) / BYTES_PER_MB).toFixed(DISPLAY_DECIMALS) },
      text: undefined,
    }));
    const plain = [...plan.errors, ...plan.warnings].map((text) => ({ token: undefined, params: undefined, text }));
    return [...plain, ...large];
  });
  /** No-op transitions (`translated → translated`) say nothing; `—` → x rows stay. */
  readonly statusChanges = computed(() =>
    (this.plan()?.statusTransitions ?? []).filter((transition) => transition.from !== transition.to),
  );
  readonly planFiles = computed(() =>
    (this.plan()?.files ?? []).map((file) => ({
      ...file,
      name: file.path.slice(file.path.lastIndexOf('/') + 1),
      parts: splitAfterSeparators(file.path.slice(file.path.lastIndexOf('/') + 1)),
    })),
  );
  readonly localeCount = computed(() => new Set(this.planFiles().map((file) => file.locale)).size);
  readonly shownIssues = computed(() => (this.plan()?.issues ?? []).slice(0, ISSUE_ROWS));
  readonly moreIssues = computed(
    () => (this.plan()?.issues.length ?? 0) + (this.plan()?.truncated.issues ?? 0) - this.shownIssues().length,
  );
  readonly autoFixCount = computed(
    () => (this.plan()?.icuAutoFixes.length ?? 0) + (this.plan()?.truncated.icuAutoFixes ?? 0),
  );
  readonly shownAutoFixes = computed(() => (this.plan()?.icuAutoFixes ?? []).slice(0, ISSUE_ROWS));
  readonly moreAutoFixes = computed(() => this.autoFixCount() - this.shownAutoFixes().length);
  readonly willFail = computed(() => this.plan()?.totals.failed ?? 0);
  readonly everyFileUnreadable = computed(() => {
    const files = this.plan()?.files ?? [];
    return files.length > 0 && files.every((file) => file.sourceProblem !== undefined);
  });

  readonly footerState = computed<FooterState>(() => {
    const model = this.model;
    if (model.readOnly()) return 'readOnly';
    if (!model.settings()) return 'invalid';
    if (model.listingStatus() !== 'error' && model.checkedCount() === 0) return 'noFiles';
    if (!model.valid() || model.listingStatus() === 'error') return 'invalid';
    const preview = model.preview;
    if (
      model.listingStatus() === 'loading' ||
      preview.stale() ||
      preview.status() === 'loading' ||
      preview.status() === 'waiting'
    )
      return 'checking';
    if (preview.status() === 'error') return 'previewFailed';
    const plan = this.plan();
    if (!plan) return 'checking';
    if (this.everyFileUnreadable()) return 'planErrors';
    return plan.totals.changed === 0 && plan.totals.imported === 0 ? 'nothing' : 'ready';
  });
  readonly canSubmit = computed(
    () =>
      ['ready', 'checking', 'previewFailed'].includes(this.footerState()) &&
      this.model.listingStatus() === 'ready' &&
      !this.saving() &&
      !this.store.isImporting(),
  );
  /** The previous count stays on the button while a new preview loads. */
  readonly primary = computed(() => {
    const state = this.footerState();
    const plan = this.plan();
    if (state === 'previewFailed') return { token: TRACKER_TOKENS.IMPORT.DIALOG.FOOTER.IMPORTANYWAY, count: 0 };
    if ((state === 'ready' || state === 'checking') && plan)
      return { token: TRACKER_TOKENS.IMPORT.DIALOG.FOOTER.IMPORTX, count: plan.totals.imported };
    return { token: TRACKER_TOKENS.IMPORT.DIALOG.FOOTER.IMPORT, count: 0 };
  });

  constructor() {
    // The config can arrive after the dialog opens; reseed and reconcile once it does.
    effect(() => {
      if (this.store.config()) untracked(() => this.model.configLoaded());
    });
    this.#destroyRef.onDestroy(() => this.model.destroy());
  }

  /**
   * Focus follows the clicked rail item. Safari does not focus a button on click, which would
   * leave the ring on the item that had focus when the dialog opened beside the selected fill.
   */
  activate(section: ImportSection, event?: Event): void {
    this.model.activeSection.set(section);
    if (event?.currentTarget instanceof HTMLElement) event.currentTarget.focus({ preventScroll: true });
  }

  /** Arrow keys move through a radio group natively; this keeps the strategy rows in step with it. */
  chooseStrategy(strategy: ImportStrategyDto): void {
    this.model.setStrategy(strategy);
  }

  chooseCollection(name: string): void {
    this.model.selectCollection(name);
  }

  toggleFile(path: string, checked: boolean): void {
    this.model.toggleFile(path, checked);
  }

  onLocaleChange(path: string, event: Event): void {
    if (event.target instanceof HTMLSelectElement) this.model.setLocale(path, event.target.value);
  }

  setOption(name: Parameters<ImportForm['setOption']>[0], value: boolean): void {
    this.model.setOption(name, value);
  }

  toggleAllFiles(): void {
    this.model.setAllFiles(!this.allChecked());
  }

  retryListing(): void {
    this.model.retryListing();
  }

  retryPreview(): void {
    this.model.retryPreview();
  }

  /** The footer's invalid state is actionable: show the errors and jump to the first marked section. */
  fixSections(): void {
    this.model.revealErrors();
  }

  togglePreview(): void {
    this.previewOpen.update((open) => !open);
  }

  toggleAdvanced(): void {
    this.#advancedChoice.set(!this.advancedOpen());
  }

  onCancel(): void {
    this.#dialogRef.close(undefined);
  }

  onSubmit(): void {
    if (!this.canSubmit()) return;
    // A start request in flight must not be orphaned by Esc or a backdrop click.
    this.#dialogRef.disableClose = true;
    this.model
      .submit((request) => this.store.startImport(request))
      .pipe(
        finalize(() => {
          this.#dialogRef.disableClose = false;
        }),
        takeUntilDestroyed(this.#destroyRef),
      )
      .subscribe({ next: (job) => this.#dialogRef.close(job), error: () => undefined });
  }
}
