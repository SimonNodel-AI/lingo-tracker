// The public surface of @simoncodes-ca/domain: browser-safe rules shared by core, the API, the CLI and the Tracker.
// Only names with a consumer outside this library are listed; everything else is a module-level detail.

// Shared types
export type { LocaleMetadata } from './lib/locale-metadata';
export type { TokenCasing } from './lib/token-casing';
export type { TranslationStatus } from './lib/translation-status';

// Keys: resource keys and generated-token identifiers
export { isJavaScriptReservedWord, isValidJavaScriptIdentifier, JS_IDENTIFIER_PATTERN } from './lib/js-identifier';
export {
  isValidSegment,
  type KeyValidationOptions,
  resolveResourceKey,
  splitResolvedKey,
  validateKey,
  validateTargetFolder,
} from './lib/resource-key';

// Staleness: how edits and imports move a locale's status
export {
  applyBaseChange,
  type EntryLocaleMetadata,
  type ImportStrategy,
  isUntranslatedCopy,
  needsTranslation,
  recordTranslation,
  type ResolveImportStatusParams,
  resolveImportStatus,
} from './lib/staleness';

// Status summary: roll-ups over many statuses
export { countByStatus, STATUS_PRECEDENCE, type StatusCounts, worstStatus } from './lib/translation-status-summary';

// ICU/Transloco: conversion, classification, placeholder repair and ICU checks
export { compareIcuArguments, type ArgumentMismatch } from './lib/icu-arguments';
export {
  autoFixICUPlaceholders,
  autoFixTranslocoPlaceholders,
  hasICUPlaceholders,
  hasTranslocoPlaceholders,
  type ICUAutoFixResult,
  validateICUSyntax,
} from './lib/icu-auto-fixer';
export { classifyICUContent, type ICUClassification } from './lib/icu-classifier';
export { findIcuCompileError, isIcuLocaleSupported } from './lib/icu-locale-validation';
export { icuToTransloco } from './lib/icu-to-transloco';
export { normalizeTranslocoSyntax } from './lib/normalize-transloco-syntax';
export { findUnportablePluralCases, type UnportablePluralCase } from './lib/portable-plural-categories';
export { hasUnbundlableBranchBody } from './lib/transloco-brace-scan';
export { translocoToICU } from './lib/transloco-to-icu';

// Validation: import keys, locales, values and key-set conflicts
export {
  detectDuplicateKeys,
  detectHierarchicalConflicts,
  isEmptyValue,
  isKeyTooLong,
  validateImportKey,
  validateLocale,
} from './lib/validation-utils';

// Terminology: protected terms, preferred terminology and similarity
export { normalizedLevenshtein } from './lib/normalized-levenshtein';
export {
  applyPreferredTerm,
  findPreferredTermFindings,
  normalizePreferredTermRules,
  type PreferredTermFinding,
  type PreferredTermRange,
  type PreferredTermRule,
  type PreferredTermRuleError,
  sortPreferredTermRules,
  validatePreferredTermRules,
} from './lib/preferred-terminology';
export {
  effectiveProtectedTerms,
  findProtectedTerms,
  findProtectedTermViolations,
  normalizeProtectedTerms,
} from './lib/protected-terms';

// References: resolving `{{t('other.key')}}` references across a key set
export { type KeyedValue, resolveAllReferences } from './lib/reference-resolver';

// Tags
export { effectiveTags } from './lib/effective-tags';
export { normalizeTag, normalizeTags } from './lib/normalize-tags';

// Utilities
export { escapeRegExp } from './lib/escape-regexp';
export { isUnderNodeModules } from './lib/node-modules';
