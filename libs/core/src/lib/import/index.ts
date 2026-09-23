// The import module: format adapters turn a file into resources; importResources applies them.

export { detectImportFormat } from './import-common';
export { importResources } from './import-resources';
export { generateImportSummary } from './import-summary';
export { parseJsonImport } from './parse-json-import';
export { parseXliffImport } from './parse-xliff-import';
export type {
  ICUAutoFix,
  ICUAutoFixError,
  ImportChange,
  ImportChangeType,
  ImportedResource,
  ImportFormat,
  ImportParseOptions,
  ImportResult,
  ImportRunOptions,
  ImportStrategy,
  ImportSummaryOptions,
  StatusTransition,
} from './types';
