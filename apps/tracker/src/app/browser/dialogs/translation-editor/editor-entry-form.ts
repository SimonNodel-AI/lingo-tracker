import { computed, signal } from '@angular/core';
import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';
import type { ResourceSummaryDto, TranslationStatus } from '@simoncodes-ca/data-transfer';
import { DEFAULT_MISSING_METADATA_STATUS, isNeedsWorkStatus, summaryTarget } from '@simoncodes-ca/domain';
import { merge, type Subscription } from 'rxjs';
import { segmentValidator } from '../../../shared/validators/segment.validator';
import {
  addTag as addDraftTag,
  hasUnsavedChanges,
  type LocaleDraft,
  removeTag as removeDraftTag,
  type ResourceEntryDraft,
} from './resource-entry-draft';

/** The editable fields and their plain draft snapshot, independent of the dialog DOM. */
export class EditorEntryForm {
  readonly form = new FormGroup({
    key: new FormControl<string>('', { validators: [Validators.required, segmentValidator], nonNullable: true }),
    baseValue: new FormControl<string>('', { validators: [Validators.required], nonNullable: true }),
    comment: new FormControl<string>('', { nonNullable: true }),
    translations: new FormArray<
      FormGroup<{
        locale: FormControl<string>;
        value: FormControl<string>;
        status: FormControl<TranslationStatus>;
      }>
    >([]),
  });

  readonly #tags = signal<readonly string[]>([]);
  readonly tags = this.#tags.asReadonly();
  readonly formState = signal(this.form.getRawValue());
  readonly localeSummaries = computed<LocaleDraft[]>(() => this.formState().translations);
  readonly localesNeedingWork = computed(() =>
    this.localeSummaries().filter((locale) => isNeedsWorkStatus(locale.status)),
  );
  readonly needWorkCount = computed(() => this.localesNeedingWork().length);

  readonly #changes: Subscription;
  #initialDraft: ResourceEntryDraft | undefined;

  constructor() {
    this.#changes = merge(this.form.valueChanges, this.form.statusChanges).subscribe(() => this.publishSnapshot());
  }

  seed(
    availableLocales: readonly string[],
    baseLocale: string,
    resource: ResourceSummaryDto | undefined,
    folderPath: string,
  ): void {
    const translations = this.form.controls.translations;
    translations.clear();
    for (const locale of availableLocales.filter((candidate) => candidate !== baseLocale)) {
      const target = resource ? summaryTarget(resource, locale) : undefined;
      translations.push(
        new FormGroup({
          locale: new FormControl(locale, { nonNullable: true }),
          value: new FormControl(target?.value ?? '', { nonNullable: true }),
          status: new FormControl<TranslationStatus>(target?.status ?? DEFAULT_MISSING_METADATA_STATUS, {
            nonNullable: true,
          }),
        }),
      );
    }
    if (resource) {
      this.form.patchValue({ key: resource.entryKey, baseValue: resource.base.value, comment: resource.comment || '' });
      this.#tags.set([...resource.tags]);
    }
    this.publishSnapshot();
    this.#initialDraft = this.draft(folderPath);
  }

  publishSnapshot(): void {
    this.formState.set(this.form.getRawValue());
  }

  addTag(raw: string): void {
    this.#tags.update((tags) => addDraftTag(tags, raw));
  }

  removeTag(tag: string, inherited: readonly string[]): void {
    this.#tags.update((tags) => removeDraftTag(tags, tag, inherited));
  }

  draft(folderPath: string): ResourceEntryDraft {
    const { key, baseValue, comment, translations } = this.form.getRawValue();
    return { key, baseValue, comment, translations, folderPath, tags: this.tags() };
  }

  initialBaseValue(): string | undefined {
    return this.#initialDraft?.baseValue;
  }

  hasUnsavedChanges(folderPath: string): boolean {
    return (
      this.#initialDraft !== undefined && hasUnsavedChanges(this.draft(folderPath), this.#initialDraft, this.form.dirty)
    );
  }

  destroy(): void {
    this.#changes.unsubscribe();
  }
}
