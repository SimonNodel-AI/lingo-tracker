import type { ExportJobDto, ExportRequestDto } from '@simoncodes-ca/data-transfer';

export interface ExportDialogData {
  preselectedCollection?: string;
  request?: ExportRequestDto;
}

/** The accepted job returned when the dialog closes. */
export type ExportDialogResult = ExportJobDto;
