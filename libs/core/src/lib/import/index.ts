// The import module: runImport handles a source file; importResources applies parsed resources.

export { assertImportableLocale } from './assert-importable-locale';
export { detectImportFormat } from './import-common';
export { inspectImportSource, type ImportSourceInspection } from './inspect-import-source';
export { importResources } from './import-resources';
export { generateImportSummary } from './import-summary';
export { parseJsonImport } from './parse-json-import';
export { parseXliffImport } from './parse-xliff-import';
export type { ImportRunWarning, RunImportOptions, RunImportResult } from './run-import';
export { runImport } from './run-import';
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
  ImportSummaryOptions,
  StatusTransition,
} from './types';
