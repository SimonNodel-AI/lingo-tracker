import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { listEditProblem, normalizeProtectedTerms, validatePreferredTermRules } from '@simoncodes-ca/domain';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { InvalidCollectionError, InvalidProjectTermsEditError } from '../errors/lingo-tracker-error';
import { patchCollectionEntry } from './collection-entry';
import { updateConfig } from './config-file-operations';
import {
  editPreferredTerminology,
  loadPreferredTerminology,
  type LoadPreferredTerminologyResult,
  type PreferredTerminologyEdit,
  type PreferredTerminologyEditResult,
  PreferredTerminologyValidationError,
  resolvePreferredTerminologyFilePath,
} from './preferred-terminology-file';
import {
  assertProtectedTerms,
  editProtectedTerms,
  type ProtectedTermsEdit,
  type ProtectedTermsEditResult,
  type ProtectedTermsView,
  readProtectedTermsTarget,
  setCollectionProtectedTermsFile,
  setGlobalProtectedTerms,
  setGlobalProtectedTermsFile,
} from './set-protected-terms';
import {
  assertWritableProtectedTermsPath,
  resolveGlobalProtectedTermsFilePath,
  resolveProtectedTermsFilePath,
  resolveWritableCollectionProtectedTermsPath,
} from './protected-terms-file';
import { loadConfig } from './load-config';
import { assertWritableTermFilePath } from './term-file';

export interface ProjectTermsUpdate {
  readonly protectedTerms?: {
    readonly target?: { readonly collection?: string };
    readonly edit?: ProtectedTermsEdit;
    readonly replace?: readonly string[];
    readonly list?: boolean;
    readonly file?: string;
  };
  readonly preferredTerminology?: PreferredTerminologyEdit & { readonly list?: boolean };
}

export interface ProjectTermsUpdateView {
  readonly protectedTerms?: ProtectedTermsView;
  readonly preferredTerminology?: LoadPreferredTerminologyResult;
  readonly protectedTermsFileChange?: { readonly message: string; readonly filePath?: string };
}

export interface ProjectTermsUpdateResult extends ProjectTermsUpdateView {
  readonly protectedTermsResult?: ProtectedTermsEditResult;
  readonly preferredTerminologyResult?: PreferredTerminologyEditResult;
}

/** Checks command flag combinations and submitted values before a pointer or term file changes. */
function validateProjectTermsUpdate(update: ProjectTermsUpdate): void {
  const protectedRequest = update.protectedTerms;
  const preferredRequest = update.preferredTerminology;
  const protectedEdit = protectedRequest?.edit;
  const replacing = protectedRequest !== undefined && 'replace' in protectedRequest;

  if (protectedRequest !== undefined) {
    if (protectedEdit !== undefined && listEditProblem(protectedEdit) === 'conflict') {
      throw new InvalidProjectTermsEditError('--set cannot be combined with --add or --remove');
    }
    if (
      !replacing &&
      (protectedEdit === undefined || listEditProblem(protectedEdit) === 'missing') &&
      !protectedRequest.list &&
      protectedRequest.file === undefined
    ) {
      throw new InvalidProjectTermsEditError('Provide at least one of --add, --remove, --set, --list, or --file');
    }
    if (replacing) assertProtectedTerms(protectedRequest.replace);
    if (protectedEdit?.add !== undefined) assertProtectedTerms(protectedEdit.add);
    if (protectedEdit?.remove !== undefined) assertProtectedTerms(protectedEdit.remove);
    if (protectedEdit?.set !== undefined && typeof protectedEdit.set !== 'string') {
      throw new InvalidProjectTermsEditError('--set must be a comma-separated string');
    }
  }

  const hasPreferredEdit =
    preferredRequest?.set !== undefined ||
    preferredRequest?.add !== undefined ||
    preferredRequest?.remove !== undefined;
  if (preferredRequest !== undefined) {
    if (!hasPreferredEdit && !preferredRequest.list) {
      throw new InvalidProjectTermsEditError(
        'Provide one of --list, --add <discouraged> --preferred <preferred>, or --remove <discouraged>',
      );
    }
    if (preferredRequest.add !== undefined && preferredRequest.remove !== undefined) {
      throw new InvalidProjectTermsEditError('--add and --remove cannot be combined; run them separately');
    }
    if (
      preferredRequest.add === undefined &&
      (preferredRequest.preferred !== undefined || preferredRequest.reason !== undefined)
    ) {
      throw new InvalidProjectTermsEditError('--preferred and --reason can only be used with --add');
    }
    if (preferredRequest.add !== undefined && preferredRequest.preferred === undefined) {
      throw new InvalidProjectTermsEditError('--add requires --preferred <preferred>');
    }
    if (preferredRequest.set !== undefined) {
      if (!Array.isArray(preferredRequest.set)) {
        throw new InvalidCollectionError('preferredTerminology must be an array of rules');
      }
      const errors = validatePreferredTermRules(preferredRequest.set);
      if (errors.length > 0) throw new PreferredTerminologyValidationError(errors, preferredRequest.set);
    }
  }
}

interface FileSnapshot {
  readonly path: string;
  /** An existing directory is left alone; a file's bytes are restored, or a newly created file is removed. */
  readonly contents?: Buffer | null;
}

function snapshotFile(path: string): FileSnapshot {
  if (!existsSync(path)) return { path, contents: null };
  return statSync(path).isFile() ? { path, contents: readFileSync(path) } : { path };
}

/** Attach a restore failure without changing the original error's type, message, or HTTP mapping. */
function attachRestoreFailure(original: unknown, failures: unknown[]): void {
  if (!(original instanceof Error) || failures.length === 0) return;
  const restoreFailure =
    failures.length === 1 ? failures[0] : Object.assign(new Error('Project Terms restore failed'), { failures });
  const priorCause = (original as Error & { cause?: unknown }).cause;
  const cause =
    priorCause === undefined
      ? restoreFailure
      : Object.assign(new Error(`${String(priorCause)}; restore failed: ${String(restoreFailure)}`), {
          priorCause,
          restoreFailure,
        });
  Object.defineProperty(original, 'cause', { value: cause, configurable: true });
}

interface PointerChange {
  readonly collection?: string;
  readonly previous?: string;
  readonly next?: string;
}

/** Revert only our pointer when it still has the value this update wrote. */
function restorePointer(change: PointerChange, cwd: string): void {
  if (change.previous === change.next) return;
  const latest = loadConfig({ cwd });
  const currentPointer = change.collection
    ? latest.collections?.[change.collection]?.protectedTermsFile
    : latest.protectedTermsFile;
  if (currentPointer !== change.next) return;
  updateConfig((current) => {
    if (change.collection) {
      if (current.collections?.[change.collection]?.protectedTermsFile !== change.next) return current;
      return patchCollectionEntry(current, change.collection, { protectedTermsFile: change.previous ?? '' });
    }
    if (current.protectedTermsFile !== change.next) return current;
    if (change.previous === undefined) delete current.protectedTermsFile;
    else current.protectedTermsFile = change.previous;
    return current;
  }, cwd);
}

/** Validate both edits, expose the read view, then write; restore changed files after a failure. */
export function updateProjectTerms(
  config: LingoTrackerConfig | undefined,
  update: ProjectTermsUpdate,
  options: {
    readonly cwd?: string;
    /** Throwing aborts the update and restores any pointer change already made. */
    readonly beforeWrite?: (view: ProjectTermsUpdateView) => void;
  } = {},
): ProjectTermsUpdateResult {
  validateProjectTermsUpdate(update);
  const cwd = options.cwd ?? process.cwd();
  const protectedRequest = update.protectedTerms;
  const preferredRequest = update.preferredTerminology;
  const protectedEdit = protectedRequest?.edit;
  const replacing = protectedRequest !== undefined && 'replace' in protectedRequest;
  const hasProtectedEdit = protectedEdit !== undefined && listEditProblem(protectedEdit) !== 'missing';
  const hasPreferredEdit =
    preferredRequest?.set !== undefined ||
    preferredRequest?.add !== undefined ||
    preferredRequest?.remove !== undefined;
  const snapshots = new Map<string, FileSnapshot>();
  const changed: string[] = [];
  const markChanged = (path: string): void => {
    if (!snapshots.has(path)) snapshots.set(path, snapshotFile(path));
    if (!changed.includes(path)) changed.push(path);
  };
  let pointerChange: PointerChange | undefined;

  try {
    let currentConfig = config ?? loadConfig({ cwd });
    let protectedTermsFileChange: ProjectTermsUpdateView['protectedTermsFileChange'];
    if (protectedRequest?.file !== undefined) {
      const pointer = protectedRequest.file.trim() || undefined;
      const collectionName = protectedRequest.target?.collection;
      currentConfig = loadConfig({ cwd });
      pointerChange = {
        collection: collectionName,
        previous: collectionName
          ? currentConfig.collections?.[collectionName]?.protectedTermsFile
          : currentConfig.protectedTermsFile,
        next: pointer,
      };
      const destination = collectionName
        ? pointer === undefined
          ? undefined
          : resolveProtectedTermsFilePath(pointer, cwd)
        : resolveGlobalProtectedTermsFilePath({ ...currentConfig, protectedTermsFile: pointer }, cwd);
      if (destination !== undefined) markChanged(destination);
      protectedTermsFileChange = collectionName
        ? setCollectionProtectedTermsFile(collectionName, pointer, { cwd })
        : setGlobalProtectedTermsFile(pointer, { cwd });
      currentConfig = loadConfig({ cwd });
    }

    const protectedTerms =
      protectedRequest !== undefined && !replacing
        ? readProtectedTermsTarget(currentConfig, protectedRequest.target ?? {}, cwd)
        : undefined;
    const preferredTerminology =
      preferredRequest !== undefined && preferredRequest.set === undefined
        ? loadPreferredTerminology(currentConfig, cwd)
        : undefined;
    const view = { protectedTerms, preferredTerminology, protectedTermsFileChange };
    options.beforeWrite?.(view);

    const preferredPath = hasPreferredEdit ? resolvePreferredTerminologyFilePath(currentConfig, cwd) : undefined;
    if (preferredPath !== undefined) assertWritableTermFilePath('preferred terminology file', preferredPath);
    const collectionName = protectedRequest?.target?.collection;
    const protectedPath = replacing
      ? resolveGlobalProtectedTermsFilePath(currentConfig, cwd)
      : hasProtectedEdit && collectionName
        ? resolveWritableCollectionProtectedTermsPath(collectionName, currentConfig.collections[collectionName], cwd)
        : hasProtectedEdit
          ? protectedTerms?.globalFilePath
          : undefined;
    if (protectedPath !== undefined) assertWritableProtectedTermsPath(protectedPath);

    let preferredTerminologyResult: PreferredTerminologyEditResult | undefined;
    if (hasPreferredEdit && preferredRequest !== undefined && preferredPath !== undefined) {
      markChanged(preferredPath);
      preferredTerminologyResult = editPreferredTerminology(currentConfig, preferredRequest, cwd, preferredTerminology);
    }
    let protectedTermsResult: ProtectedTermsEditResult | undefined;
    if (protectedPath !== undefined) {
      markChanged(protectedPath);
      if (replacing && protectedRequest?.replace !== undefined) {
        const terms = normalizeProtectedTerms([...protectedRequest.replace]);
        const result = setGlobalProtectedTerms(terms, { cwd });
        protectedTermsResult = { terms, filePath: result.filePath };
      } else if (hasProtectedEdit && protectedEdit !== undefined && protectedTerms !== undefined) {
        protectedTermsResult = editProtectedTerms(protectedRequest?.target ?? {}, protectedTerms, protectedEdit, {
          cwd,
        });
      }
    }
    return { ...view, protectedTermsResult, preferredTerminologyResult };
  } catch (error) {
    const restoreFailures: unknown[] = [];
    for (const path of changed.reverse()) {
      const snapshot = snapshots.get(path);
      if (snapshot?.contents === undefined) continue;
      try {
        if (snapshot.contents === null) {
          if (existsSync(path)) unlinkSync(path);
        } else {
          writeFileSync(path, snapshot.contents);
        }
      } catch (restoreError) {
        restoreFailures.push(restoreError);
      }
    }
    if (pointerChange !== undefined) {
      try {
        restorePointer(pointerChange, cwd);
      } catch (restoreError) {
        restoreFailures.push(restoreError);
      }
    }
    attachRestoreFailure(error, restoreFailures);
    throw error;
  }
}
