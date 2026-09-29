import { inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import type { ConfirmationDialogData } from './components/confirmation-dialog/confirmation-dialog-data';

export interface ConfirmOptions {
  width?: string;
  disableClose?: boolean;
  /** A session guard checked after the lazy import, before opening. */
  canOpen?: () => boolean;
}

/** Lazily opens the shared confirmation and accepts only an explicit true result. */
export function injectConfirm(): (data: ConfirmationDialogData, options?: ConfirmOptions) => Promise<boolean> {
  const dialog = inject(MatDialog);
  return async (data, options = {}) => {
    const { ConfirmationDialog } = await import('./components/confirmation-dialog/confirmation-dialog');
    if (options.canOpen && !options.canOpen()) return false;
    const ref = dialog.open<InstanceType<typeof ConfirmationDialog>, ConfirmationDialogData, boolean>(
      ConfirmationDialog,
      {
        data,
        ...(options.width !== undefined ? { width: options.width } : {}),
        ...(options.disableClose !== undefined ? { disableClose: options.disableClose } : {}),
      },
    );
    return (await firstValueFrom(ref.afterClosed(), { defaultValue: false })) === true;
  };
}
