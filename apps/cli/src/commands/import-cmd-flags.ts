import type { ImportCommandOptions } from './import-options';
import { defineFlags } from '../runner/flag-record';
import { IMPORT_OPTION_TABLE } from './import-option-table';
import { tableFlags } from './option-table';
import { importHelpText } from '../runner/help-text';

export const IMPORT_FLAGS = defineFlags<ImportCommandOptions>()(tableFlags(IMPORT_OPTION_TABLE));

export const IMPORT_REGISTRATION = {
  name: 'import',
  description: 'Import translation resources from XLIFF or JSON',
  flags: IMPORT_FLAGS,
  helpText: () => importHelpText(),
};
