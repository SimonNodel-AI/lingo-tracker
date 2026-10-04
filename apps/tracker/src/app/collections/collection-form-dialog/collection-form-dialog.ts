import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { TRACKER_TOKENS } from '../../../i18n-types/tracker-resources';
import { ChipInput } from '../../shared/chip-input/chip-input';
import { CONFIG_FILE_MARKUP } from '../../shared/code-markup';
import { injectConfirm } from '../../shared/confirm';
import { CollectionsStore } from '../store/collections.store';
import type { CollectionDraftResult } from './collection-draft';
import { CollectionForm } from './collection-form';
import type { CollectionFormDialogData } from './collection-form-dialog-data';

/** What the dialog closes with: the collection as the server has now accepted it. */
export type CollectionFormResult = CollectionDraftResult;

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
    ChipInput,
  ],
  templateUrl: './collection-form-dialog.html',
  styleUrl: './collection-form-dialog.scss',
})
export class CollectionFormDialog {
  readonly #dialogRef = inject(MatDialogRef<CollectionFormDialog>);
  readonly #data = inject<CollectionFormDialogData>(MAT_DIALOG_DATA);
  readonly #confirm = injectConfirm();
  readonly #translocoService = inject(TranslocoService);
  readonly #store = inject(CollectionsStore);

  readonly TOKENS = TRACKER_TOKENS;
  readonly configFileMarkup = CONFIG_FILE_MARKUP;

  readonly model = new CollectionForm(this.#data, {
    translate: (token) => this.#translocoService.translate(token),
    destroyRef: inject(DestroyRef),
  });
  /** True from submit until the server has answered. */
  readonly saving = this.model.saving;

  get dialogTitle(): string {
    return this.model.isEditMode
      ? TRACKER_TOKENS.COLLECTIONS.DIALOG.EDIT.TITLE
      : TRACKER_TOKENS.COLLECTIONS.DIALOG.CREATE.TITLE;
  }

  onCancel(): void {
    this.#dialogRef.close();
  }

  async onSubmit(): Promise<void> {
    if (this.model.saving() || !this.model.validate()) return;

    const removed = this.model.removedLocales();
    if (removed.length > 0) {
      const confirmed = await this.#confirm({
        title: TRACKER_TOKENS.COLLECTIONS.DIALOG.REMOVECONFIRMTITLE,
        message: {
          token: TRACKER_TOKENS.COLLECTIONS.DIALOG.REMOVECONFIRMBODY,
          params: { locales: removed.join(', ') },
        },
        confirmButtonText: TRACKER_TOKENS.COMMON.ACTIONS.SAVE,
        actionType: 'destructive',
      });
      if (!confirmed) return;
    }
    this.model.submit({
      dialog: this.#dialogRef,
      create: (result) => this.#store.createCollection({ name: result.name, collection: result.config }),
      update: (name, patch, result) => this.#store.updateCollection(name, { ...patch, collection: result.config }),
    });
  }
}
