import type { DestroyRef, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Observable } from 'rxjs';
import { ApiError } from '../../shared/api-error/api-error';

/** The part of a refused Config Write a form needs to render. */
export interface ConfigRefusal {
  kind: 'conflict' | 'invalid' | 'other';
  /** API details survive every refusal kind; a caller decides which ones to show. */
  details: readonly unknown[];
  error: unknown;
}

export function classifyConfigRefusal(error: unknown): ConfigRefusal {
  if (error instanceof ApiError) {
    if (error.kind === 'conflict') return { kind: 'conflict', details: error.details, error };
    if (error.kind === 'invalid') return { kind: 'invalid', details: error.details, error };
    return { kind: 'other', details: error.details, error };
  }
  return { kind: 'other', details: [], error };
}

/**
 * Dialog Config Submit: owns the close lock and subscription for one cold Config Write.
 * Closing while the write is in flight destroys the dialog and cancels its subscription,
 * losing the outcome of a write the server may already have made. The caller disables
 * Cancel and the close icon; this lock also blocks Esc and the backdrop. On refusal,
 * the previous lock value is restored. Destruction mid-write still cancels the write.
 */
export function submitDialogConfigWrite<TResult>(options: {
  dialogRef: { disableClose: boolean | undefined; close(result: TResult): void };
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
