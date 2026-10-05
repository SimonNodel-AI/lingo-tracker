import type { ExportCommandOptions } from './export-options';
import { defineFlags } from '../runner/flag-record';
import { EXPORT_OPTION_TABLE } from './export-option-table';
import { tableFlags } from './option-table';

export const EXPORT_FLAGS = defineFlags<ExportCommandOptions>()(tableFlags(EXPORT_OPTION_TABLE));

export const EXPORT_REGISTRATION = {
  name: 'export',
  description: 'Export translation resources to XLIFF or JSON',
  flags: EXPORT_FLAGS,
};
