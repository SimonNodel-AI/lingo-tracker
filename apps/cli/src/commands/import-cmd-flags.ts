import { defineFlags } from '../runner/flag-record';
import { importHelpText } from '../runner/help-text';
import { IMPORT_OPTION_TABLE } from './import-option-table';
import type { ImportCommandOptions } from './import-options';
import { tableFlags } from './option-table';

export const IMPORT_FLAGS = defineFlags<ImportCommandOptions>()(tableFlags(IMPORT_OPTION_TABLE));

export const IMPORT_REGISTRATION = {
  name: 'import',
  description: 'Import translation resources from XLIFF or JSON',
  flags: IMPORT_FLAGS,
  helpText: () => importHelpText(),
};
