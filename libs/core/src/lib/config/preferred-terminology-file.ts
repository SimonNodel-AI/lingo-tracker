import { resolve } from 'node:path';
import {
  normalizePreferredTermRules,
  type PreferredTermRule,
  type PreferredTermRuleError,
  sortPreferredTermRules,
  validatePreferredTermRules,
} from '@simoncodes-ca/domain';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { LingoTrackerError } from '../errors/lingo-tracker-error';
import {
  readTermFile,
  resolveTermFilePath,
  type TermFile,
  type TermFileKind,
  type TermFileRead,
  writeTermFile,
} from './term-file';

/**
 * Default location of the preferred-terminology file, resolved against the directory
 * holding `.lingo-tracker.json`. Used whenever the config has no explicit
 * `preferredTerminologyFile` pointer. There is one global file; collections cannot
 * override it.
 */
export const DEFAULT_PREFERRED_TERMINOLOGY_FILENAME = '.lingo-tracker-preferred-terminology.json';

/** Outcome of reading the preferred-terminology file. Never thrown; problems are reported in-band. */
export interface LoadPreferredTerminologyResult {
  /** Normalized rules in file order; empty when the file is absent or broken. */
  rules: PreferredTermRule[];
  /** Absolute path of the file, whether or not it exists yet. */
  filePath: string;
  /** Set when the file exists but cannot be used: unreadable, malformed JSON, wrong shape, or invalid rules. */
  error?: string;
  /** Set when an explicitly configured file does not exist. */
  warning?: string;
}

/** Thrown by `writePreferredTerminology` when the rule list fails validation. The file is left untouched. */
export class PreferredTerminologyValidationError extends LingoTrackerError {
  readonly errors: PreferredTermRuleError[];

  constructor(errors: PreferredTermRuleError[]) {
    super(`Invalid preferred terminology rules: ${formatRuleErrors(errors)}`, 'INVALID_PREFERRED_TERMINOLOGY');
    this.errors = errors;
  }
}

/** The preferred-terminology file: a bare JSON array of `{ discouraged, preferred, reason? }` rules, in file order. */
const PREFERRED_TERMINOLOGY: TermFileKind<PreferredTermRule> = {
  label: 'Preferred terminology file',
  items: 'rules',
  parse: (items, filePath) => {
    const errors = validatePreferredTermRules(items);
    return errors.length > 0
      ? { error: `Preferred terminology file has invalid rules: ${filePath} (${formatRuleErrors(errors)})` }
      : { value: normalizePreferredTermRules(items as PreferredTermRule[]) };
  },
  serialize: (rules) => sortPreferredTermRules(normalizePreferredTermRules(rules)),
};

/**
 * The preferred-terminology file: the config's `preferredTerminologyFile` pointer resolved
 * against `cwd` (the directory holding the config file), falling back to the default filename.
 * A pointer that is neither a string nor unset (`null` counts as unset) is reported through
 * `invalid`: `.lingo-tracker.json` is hand-edited and not schema-validated.
 */
export function resolvePreferredTerminologyFile(
  config: Pick<LingoTrackerConfig, 'preferredTerminologyFile'>,
  cwd: string = process.cwd(),
): TermFile {
  const invalid = invalidPointerError(config);
  if (invalid !== undefined) {
    return { path: resolve(cwd, DEFAULT_PREFERRED_TERMINOLOGY_FILENAME), explicit: false, invalid };
  }
  const pointer = config.preferredTerminologyFile ?? DEFAULT_PREFERRED_TERMINOLOGY_FILENAME;
  return { path: resolveTermFilePath(pointer, cwd), explicit: config.preferredTerminologyFile != null };
}

/**
 * Absolute path of the preferred-terminology file (see {@link resolvePreferredTerminologyFile}).
 *
 * @throws {Error} The pointer is neither a string nor unset.
 */
export function resolvePreferredTerminologyFilePath(
  config: Pick<LingoTrackerConfig, 'preferredTerminologyFile'>,
  cwd: string = process.cwd(),
): string {
  const file = resolvePreferredTerminologyFile(config, cwd);
  if (file.invalid !== undefined) {
    throw new Error(file.invalid);
  }
  return file.path;
}

/**
 * Reads the preferred-terminology file (see `readTermFile` for the missing-file and problem rules).
 *
 * Never throws. A non-string pointer, malformed JSON, a non-array payload, or any rule failing
 * validation sets `error` and returns no rules: terminology checks are advisory, so callers warn
 * and skip them rather than abort, except `validate`, which reports a broken file as a failure.
 */
export function loadPreferredTerminology(
  config: Pick<LingoTrackerConfig, 'preferredTerminologyFile'>,
  cwd: string = process.cwd(),
): LoadPreferredTerminologyResult {
  const { value, filePath, error, warning } = readTermFile(
    PREFERRED_TERMINOLOGY,
    resolvePreferredTerminologyFile(config, cwd),
  );
  return { rules: value, filePath, ...(error !== undefined && { error }), ...(warning !== undefined && { warning }) };
}

/** Reads the preferred-terminology file at a resolved location. Never throws. */
export function readPreferredTerminologyFile(file: TermFile): TermFileRead<PreferredTermRule> {
  return readTermFile(PREFERRED_TERMINOLOGY, file);
}

/**
 * Writes the preferred-terminology file: normalized, sorted by discouraged term, 2-space
 * JSON with a trailing newline. Sorting keeps an added rule to a small diff regardless
 * of where it lands. An empty `reason` is dropped rather than written as `""`.
 *
 * Throws `PreferredTerminologyValidationError` (with the per-row errors attached) when
 * the rules fail validation, and `ParentDirectoryMissingError` when the parent directory is missing;
 * in both cases the file is left untouched. The file is created when absent.
 */
export function writePreferredTerminology(filePath: string, rules: readonly PreferredTermRule[]): void {
  // Validate before normalizing: rules may arrive from an untyped source (the API), and
  // normalizing trims fields that might not be strings. Validation trims on its own.
  const errors = validatePreferredTermRules(rules);
  if (errors.length > 0) {
    throw new PreferredTerminologyValidationError(errors);
  }
  writeTermFile(PREFERRED_TERMINOLOGY, filePath, [...rules]);
}

/** Error message for a `preferredTerminologyFile` that is set but not a string; `undefined` when usable. */
function invalidPointerError(config: Pick<LingoTrackerConfig, 'preferredTerminologyFile'>): string | undefined {
  const pointer: unknown = config.preferredTerminologyFile;
  if (pointer === undefined || pointer === null || typeof pointer === 'string') {
    return undefined;
  }
  const type = Array.isArray(pointer) ? 'array' : typeof pointer;
  return `"preferredTerminologyFile" in .lingo-tracker.json must be a string path (got ${type})`;
}

/** One `row N field: message` entry per error, rows 1-based, joined into a single line. */
function formatRuleErrors(errors: readonly PreferredTermRuleError[]): string {
  return errors.map((error) => `row ${error.index + 1} ${error.field}: ${error.message}`).join('; ');
}
