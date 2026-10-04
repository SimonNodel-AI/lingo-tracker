import { type DestroyRef, signal, type WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Observable } from 'rxjs';
import type { AbstractControl, FormControl, ValidationErrors } from '@angular/forms';
import { apiErrorMessage } from '../../shared/api-error/api-error';
import { type ConfigRefusal, classifyConfigRefusal } from './config-write';

/**
 * Dialog Config Submit: owns the close lock and subscription for one cold Config Write.
 * Closing while the write is in flight destroys the dialog and cancels its subscription,
 * losing the outcome of a write the server may already have made. The caller disables
 * Cancel and the close icon; this lock also blocks Esc and the backdrop. On refusal,
 * the previous lock value is restored. Destruction mid-write still cancels the write.
 */
export function submitDialogConfigWrite<TResult>(options: {
  dialogRef: DialogCloser<TResult>;
  write: Observable<unknown>;
  saving: WritableSignal<boolean>;
  result: TResult;
  destroyRef: DestroyRef;
  onRefusal: (refusal: ConfigRefusal) => void;
}): void {
  const previousDisableClose = options.dialogRef.disableClose;
  options.saving.set(true);
  options.dialogRef.disableClose = true;
  options.write.pipe(takeUntilDestroyed(options.destroyRef)).subscribe({
    next: () => options.dialogRef.close(options.result),
    error: (error: unknown) => {
      options.saving.set(false);
      options.dialogRef.disableClose = previousDisableClose;
      options.onRefusal(classifyConfigRefusal(error));
    },
  });
}

/** A refusal either belongs to the editable name or has a message for the form to render. */
export type NamedEntryRefusal =
  | { kind: 'name-conflict' }
  | { kind: 'message'; message: string; details: readonly unknown[] };

/** The dialog's close handle: what a write locks while it is in flight and closes on success. */
export interface DialogCloser<TResult> {
  disableClose: boolean | undefined;
  close(result: TResult): void;
}

/** What a form needs from its dialog's injection context to submit and to cancel a write on destroy. */
export interface FormSubmitEnv {
  translate: (token: string) => string;
  destroyRef: DestroyRef;
}

interface NamedEntrySubmitConfig {
  /** The control is read after form construction; its validator needs this helper during construction. */
  nameControl: () => FormControl<string>;
  normalizeName?: (value: unknown) => string;
  fallbackTokens: { create: string; update: string };
  env: FormSubmitEnv;
}

/** One submit policy for a named collection or bundle. The form keeps its own field rendering. */
export class NamedEntrySubmit<TResult> {
  #serverTakenName: string | undefined;

  /** True from submit until the server has answered. */
  readonly saving = signal(false);

  constructor(private readonly config: NamedEntrySubmitConfig) {}

  private normalizeName(value: unknown): string {
    return this.config.normalizeName?.(value) ?? String(value ?? '');
  }

  readonly nameValidator = (control: AbstractControl): ValidationErrors | null => {
    const value = this.normalizeName(control.value);
    return value === this.#serverTakenName ? { nameExists: { name: value } } : null;
  };

  submit(options: {
    dialog: DialogCloser<TResult>;
    existingName: string | undefined;
    name: string;
    create: () => Observable<unknown>;
    update: (existingName: string, patch: { name: string | undefined }) => Observable<unknown>;
    result: TResult;
    onRefusal: (refusal: NamedEntryRefusal) => void;
  }): void {
    const write =
      options.existingName === undefined
        ? options.create()
        : options.update(options.existingName, {
            name: options.name !== options.existingName ? options.name : undefined,
          });
    submitDialogConfigWrite({
      dialogRef: options.dialog,
      write,
      saving: this.saving,
      result: options.result,
      destroyRef: this.config.env.destroyRef,
      onRefusal: (refusal) => {
        const nameControl = this.config.nameControl();
        if (refusal.kind === 'conflict' && nameControl.enabled) {
          this.#serverTakenName = this.normalizeName(options.name);
          nameControl.updateValueAndValidity();
          nameControl.markAsTouched();
          options.onRefusal({ kind: 'name-conflict' });
          return;
        }
        const token =
          options.existingName === undefined ? this.config.fallbackTokens.create : this.config.fallbackTokens.update;
        options.onRefusal({
          kind: 'message',
          message: apiErrorMessage(refusal.error, this.config.env.translate(token)),
          details: refusal.details,
        });
      },
    });
  }
}
