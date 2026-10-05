import {
  CONFIG_FILENAME,
  type CollectionTagEditProblem,
  type ErrorCode,
  LingoTrackerError,
  isProtectedTermsEditProblem,
  isPreferredTerminologyEditProblem,
  type PreferredTerminologyEditProblem,
  PreferredTerminologyValidationError,
  type ProtectedTermsEditProblem,
} from '@simoncodes-ca/core';
import { ConsoleFormatter } from '../utils/console-formatter';
import { CommandOutput } from './command-output';

/** Shared with the command definition so renaming the command retains its advice. */
export const ADD_RESOURCE_COMMAND_NAME = 'Add resource';

/** Terminal text only; the original error remains available to the runner. */
export interface CliErrorWording {
  readonly message: string;
  readonly details?: readonly string[];
  /** Unindented follow-up line (the config initialization hint). */
  readonly hint?: string;
  /** Defaults to true; import source messages already contain the underlying reason. */
  readonly includeCause?: boolean;
}

type Rule = (error: LingoTrackerError, commandName?: string) => CliErrorWording;
const original: Rule = (error) => ({ message: error.message });

const tagProblems = {
  'tag-conflict': () => ({ message: '--set-tags cannot be combined with --add-tag or --remove-tag' }),
  'tag-missing': () => ({ message: 'Provide at least one of --add-tag, --remove-tag, or --set-tags' }),
} satisfies Record<CollectionTagEditProblem, Rule>;

const protectedProblems = {
  'protected-conflict': () => ({ message: '--set cannot be combined with --add or --remove' }),
  'protected-missing': () => ({ message: 'Provide at least one of --add, --remove, --set, --list, or --file' }),
  'protected-file-path': original,
  'protected-replacement-conflict': original,
} satisfies Record<ProtectedTermsEditProblem, Rule>;

const preferredProblems = {
  'preferred-missing': () => ({
    message: 'Provide one of --list, --add <discouraged> --preferred <preferred>, or --remove <discouraged>',
  }),
  'preferred-conflict': () => ({ message: '--add and --remove cannot be combined; run them separately' }),
  'preferred-orphan-flags': () => ({ message: '--preferred and --reason can only be used with --add' }),
  'preferred-incomplete-flags': () => ({ message: '--add requires --preferred <preferred>' }),
  'preferred-remove-shape': original,
  'preferred-replacement-shape': original,
  'preferred-upsert-shape': original,
} satisfies Record<PreferredTerminologyEditProblem, Rule>;

function problemWording(error: LingoTrackerError, table: Readonly<Partial<Record<string, Rule>>>): CliErrorWording {
  const problem = 'problem' in error && typeof error.problem === 'string' ? error.problem : undefined;
  return (
    problem === undefined || Object.getOwnPropertyDescriptor(table, problem) === undefined
      ? original
      : (table[problem] ?? original)
  )(error);
}

function projectTermsWording(error: LingoTrackerError): CliErrorWording {
  const problem = 'problem' in error ? error.problem : undefined;
  if (isProtectedTermsEditProblem(problem)) return protectedProblems[problem](error);
  if (isPreferredTerminologyEditProblem(problem)) return preferredProblems[problem](error);
  return original(error);
}

function preferredValidation(error: LingoTrackerError): CliErrorWording {
  if (!(error instanceof PreferredTerminologyValidationError)) return original(error);
  return {
    message: 'Preferred terminology not saved:',
    details: error.errors.map((ruleError) => {
      const row = error.submittedRules?.[ruleError.index];
      const label = row ? `"${row.discouraged} → ${row.preferred}"` : `row ${ruleError.index + 1}`;
      return `${label}: ${ruleError.message}`;
    }),
  };
}

/** Explicit even for unchanged messages: a new core/provider code requires a CLI decision. */
const CLI_BY_CODE = {
  AUTO_TRANSLATION_DISABLED: (error) => ({
    message: `${error.message}. Set translation.enabled = true in your configuration`,
  }),
  BASE_LOCALE_IMMUTABLE: original,
  BUNDLE_ALREADY_EXISTS: original,
  BUNDLE_NOT_FOUND: (error) => ({ message: `${error.message}.` }),
  CANNOT_TRANSLATE_BASE_LOCALE: original,
  COLLECTION_ALREADY_EXISTS: original,
  COLLECTION_BASE_LOCALE_MISMATCH: original,
  COLLECTION_NOT_FOUND: original,
  COLLECTION_READ_ONLY: original,
  COLLECTION_RENAME_BUNDLE_CONFLICT: original,
  COLLECTION_REQUIRED_BY_BUNDLE: original,
  CONFIG_CHANGED: original,
  CONFIG_NOT_FOUND: () => ({
    message: `Configuration file ${CONFIG_FILENAME} not found.`,
    hint: 'Run "lingo-tracker init" to initialize a project.',
  }),
  CONFIG_PARSE_FAILED: (error) => ({
    message: `Failed to parse configuration file: ${'reason' in error ? String(error.reason) : error.message}`,
  }),
  CORE_OPERATION_ERROR: original,
  FOLDER_MOVE_INTO_DESCENDANT: original,
  FOLDER_NOT_FOUND: original,
  GLOSSARY_EXTRACTOR_ERROR: (error) =>
    'mode' in error && error.mode === 'ai'
      ? { message: 'The "ai" extractor is not yet implemented. Use --extractor ngram (the default).' }
      : original(error),
  GLOSSARY_NO_COLLECTIONS: original,
  IMPORT_SOURCE_ERROR: (error) => ({
    message: 'stage' in error && error.stage === 'format' ? error.message : `Import failed: ${error.message}`,
    includeCause: false,
  }),
  INVALID_BUNDLE_DEFINITION: original,
  INVALID_BUNDLE_LOCALES: original,
  INVALID_COLLECTION: (error) => problemWording(error, tagProblems),
  INVALID_COLLECTION_FOLDER: original,
  INVALID_CONFIG: original,
  INVALID_FOLDER_PATH: original,
  INVALID_IMPORT_LOCALE: (error) => ({ message: `Import failed: ${error.message}`, includeCause: false }),
  INVALID_LOCALE: original,
  INVALID_NAME: original,
  INVALID_PREFERRED_TERMINOLOGY: preferredValidation,
  INVALID_PROJECT_TERMS_EDIT: projectTermsWording,
  INVALID_PROTECTED_TERMS_FILE: original,
  INVALID_RESOURCE_KEY: original,
  INVALID_TRANSLATION_STATUS: original,
  LOCALE_ALREADY_EXISTS: original,
  LOCALE_NOT_FOUND: original,
  MULTIPLE_BUNDLE_CONSTANT_NAME: () => ({
    message: 'Cannot use --token-constant-name with multiple bundles. Please target a single bundle.',
  }),
  NO_TRANSLATION_TARGET_LOCALES: original,
  PARENT_DIRECTORY_MISSING: original,
  PROTECTED_TERMS_FILE_NOT_SET: (error) => ({
    message: `Collection "${'collectionName' in error ? String(error.collectionName) : ''}" has no protected terms file. Set one first with --file <path>.`,
  }),
  RESOURCE_ALREADY_EXISTS: (error, commandName) =>
    commandName === ADD_RESOURCE_COMMAND_NAME
      ? { message: error.message, details: ['Use --override to replace it, or edit-resource to change it.'] }
      : original(error),
  RESOURCE_NOT_FOUND: original,
  TRANSLATION_LOCALE_NOT_CONFIGURED: original,
  AUTH_ERROR: original,
  INVALID_REQUEST: original,
  INVALID_REQUEST_TIMEOUT: original,
  INVALID_RESPONSE: original,
  MISSING_API_KEY: original,
  RATE_LIMIT: original,
  SERVER_ERROR: original,
  TIMEOUT: original,
  UNKNOWN_PROVIDER: original,
} satisfies Record<ErrorCode, Rule>;

const rules: Readonly<Partial<Record<string, Rule>>> = CLI_BY_CODE;

/** Typed core errors take precedence over command hooks. Unknown typed codes keep their message. */
export function cliErrorWording(error: unknown, commandName?: string): CliErrorWording | undefined {
  if (!(error instanceof LingoTrackerError)) return undefined;
  return (
    Object.getOwnPropertyDescriptor(rules, error.code) !== undefined ? (rules[error.code] ?? original) : original
  )(error, commandName);
}

/** The runner and commands share complete diagnostic rendering, including details, hints and causes. */
export function printCliError(
  error: unknown,
  options: {
    readonly commandName?: string;
    readonly formatError?: () => string | undefined;
    /** Text for a non-Error thrown value; defaults to String(error). */
    readonly fallbackMessage?: string;
  } = {},
): void {
  const wording = cliErrorWording(error, options.commandName);
  const message =
    wording?.message ??
    options.formatError?.() ??
    (error instanceof Error ? error.message : (options.fallbackMessage ?? String(error)));
  const cause = error instanceof Error && 'cause' in error ? error.cause : undefined;
  const details = [...(wording?.details ?? [])];
  if (wording?.includeCause !== false && cause instanceof Error) details.push(cause.message);
  if (details.length > 0) ConsoleFormatter.error(message, details);
  else ConsoleFormatter.error(message);
  if (wording?.hint) CommandOutput.error(wording.hint);
}
