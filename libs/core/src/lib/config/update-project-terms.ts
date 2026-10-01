import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { listEditProblem, normalizeProtectedTerms, validatePreferredTermRules } from '@simoncodes-ca/domain';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { ConfigChangedError, InvalidProjectTermsEditError } from '../errors/lingo-tracker-error';
import { patchCollectionEntry } from './collection-entry';
import { createConfigFileOperations, updateConfig } from './config-file-operations';
import { configReadVersion, loadConfig } from './load-config';
import {
  editPreferredTerminology,
  type LoadPreferredTerminologyResult,
  loadPreferredTerminology,
  type PreferredTerminologyEdit,
  type PreferredTerminologyEditResult,
  PreferredTerminologyValidationError,
  resolvePreferredTerminologyFilePath,
} from './preferred-terminology-file';
import {
  assertWritableProtectedTermsPath,
  resolveGlobalProtectedTermsFilePath,
  resolveProtectedTermsFilePath,
  resolveWritableCollectionProtectedTermsPath,
} from './protected-terms-file';
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

export interface ProjectTermsUpdatePlan {
  readonly view: ProjectTermsUpdateView;
  apply(): ProjectTermsUpdateResult;
}

interface ValidatedEdit {
  readonly replacing: boolean;
  readonly hasProtectedEdit: boolean;
  readonly hasPreferredEdit: boolean;
}

/** Checks edit combinations and submitted values once, before a pointer or term file changes. */
function validateProjectTermsUpdate(update: ProjectTermsUpdate): ValidatedEdit {
  const protectedRequest = update.protectedTerms;
  const preferredRequest = update.preferredTerminology;
  const protectedEdit = protectedRequest?.edit;
  const replacing = protectedRequest !== undefined && 'replace' in protectedRequest;
  const protectedProblem = protectedEdit === undefined ? 'missing' : listEditProblem(protectedEdit);

  if (protectedRequest !== undefined) {
    if (protectedRequest.file !== undefined && typeof protectedRequest.file !== 'string') {
      throw new InvalidProjectTermsEditError('Protected terms file path must be a string');
    }
    if (protectedProblem === 'conflict') {
      throw new InvalidProjectTermsEditError('A replacement list cannot be combined with additions or removals');
    }
    if (!replacing && protectedProblem === 'missing' && !protectedRequest.list && protectedRequest.file === undefined) {
      throw new InvalidProjectTermsEditError('A protected terms update needs a list edit, list view, or file path');
    }
    if (replacing) assertProtectedTerms(protectedRequest.replace);
    if (protectedEdit?.add !== undefined) assertProtectedTerms(protectedEdit.add);
    if (protectedEdit?.remove !== undefined) assertProtectedTerms(protectedEdit.remove);
    if (protectedEdit?.set !== undefined) assertProtectedTerms(protectedEdit.set);
    if (replacing && protectedProblem !== 'missing') {
      throw new InvalidProjectTermsEditError('A replacement list cannot be combined with another list edit');
    }
  }

  const hasPreferredEdit =
    preferredRequest?.set !== undefined ||
    preferredRequest?.upsert !== undefined ||
    preferredRequest?.remove !== undefined;
  if (preferredRequest !== undefined) {
    if (preferredRequest.remove !== undefined && typeof preferredRequest.remove !== 'string') {
      throw new InvalidProjectTermsEditError('A rule to remove must name a discouraged term');
    }
    if (!hasPreferredEdit && !preferredRequest.list) {
      throw new InvalidProjectTermsEditError('A preferred terminology update needs a rule edit or list view');
    }
    if (
      Number(preferredRequest.set !== undefined) +
        Number(preferredRequest.upsert !== undefined) +
        Number(preferredRequest.remove !== undefined) >
      1
    ) {
      throw new InvalidProjectTermsEditError('Only one preferred terminology edit can be applied at a time');
    }
    if (preferredRequest.set !== undefined) {
      if (!Array.isArray(preferredRequest.set)) {
        throw new InvalidProjectTermsEditError('Preferred terminology replacement must be an array of rules');
      }
      const errors = validatePreferredTermRules(preferredRequest.set);
      if (errors.length > 0) throw new PreferredTerminologyValidationError(errors, preferredRequest.set);
    }
  }
  return { replacing, hasProtectedEdit: protectedProblem !== 'missing', hasPreferredEdit };
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

/** Validate and read without writing. The caller can show the view before applying the edit. */
export function planProjectTermsUpdate(
  config: LingoTrackerConfig | undefined,
  update: ProjectTermsUpdate,
  options: { readonly cwd?: string } = {},
): ProjectTermsUpdatePlan {
  const validated = validateProjectTermsUpdate(update);
  const cwd = options.cwd ?? process.cwd();
  const currentConfig = config ?? loadConfig({ cwd });
  const protectedRequest = update.protectedTerms;
  const { replacing } = validated;
  const preferredRequest = update.preferredTerminology;
  let protectedTerms =
    protectedRequest !== undefined && !replacing
      ? readProtectedTermsTarget(currentConfig, protectedRequest.target ?? {}, cwd)
      : undefined;
  const preferredTerminology =
    preferredRequest !== undefined && preferredRequest.set === undefined
      ? loadPreferredTerminology(currentConfig, cwd)
      : undefined;
  let protectedTermsFileChange: ProjectTermsUpdateView['protectedTermsFileChange'];
  if (protectedRequest?.file !== undefined) {
    const pointer = protectedRequest.file.trim() || undefined;
    const collectionName = protectedRequest.target?.collection;
    const filePath = collectionName
      ? pointer === undefined
        ? undefined
        : resolveProtectedTermsFilePath(pointer, cwd)
      : resolveGlobalProtectedTermsFilePath({ ...currentConfig, protectedTermsFile: pointer }, cwd);
    if (filePath !== undefined) assertWritableProtectedTermsPath(filePath);
    protectedTermsFileChange = {
      message: collectionName
        ? filePath === undefined
          ? `Collection "${collectionName}" protected terms file cleared`
          : `Collection "${collectionName}" protected terms file set to ${filePath}`
        : `Global protected terms file set to ${filePath}`,
      filePath,
    };
    if (protectedTerms !== undefined) {
      const collectionTerms = collectionName && filePath === undefined ? [] : protectedTerms.collectionTerms;
      const previousPath = collectionName ? protectedTerms.collectionFilePath : protectedTerms.globalFilePath;
      protectedTerms = {
        ...protectedTerms,
        globalFilePath: collectionName ? protectedTerms.globalFilePath : (filePath ?? protectedTerms.globalFilePath),
        collectionFilePath: collectionName ? filePath : protectedTerms.collectionFilePath,
        collectionTerms,
        effectiveTerms: normalizeProtectedTerms([...protectedTerms.globalTerms, ...collectionTerms]),
        storedTerms: collectionName ? [...collectionTerms] : protectedTerms.storedTerms,
        warnings: protectedTerms.warnings.filter(
          (warning) => previousPath === undefined || !warning.includes(previousPath),
        ),
      };
    }
  }
  return {
    view: { protectedTerms, preferredTerminology, protectedTermsFileChange },
    apply: () => applyProjectTermsUpdate(currentConfig, update, cwd, validated),
  };
}

/** Apply a validated plan, restoring changed files and pointers after a failure. */
function applyProjectTermsUpdate(
  config: LingoTrackerConfig,
  update: ProjectTermsUpdate,
  cwd: string,
  validated: ValidatedEdit,
): ProjectTermsUpdateResult {
  const protectedRequest = update.protectedTerms;
  const preferredRequest = update.preferredTerminology;
  const protectedEdit = protectedRequest?.edit;
  const { replacing, hasProtectedEdit, hasPreferredEdit } = validated;
  const snapshots = new Map<string, FileSnapshot>();
  const changed: string[] = [];
  const markChanged = (path: string): void => {
    if (!snapshots.has(path)) snapshots.set(path, snapshotFile(path));
    if (!changed.includes(path)) changed.push(path);
  };
  let pointerChange: PointerChange | undefined;
  const configFile =
    configReadVersion(config) === undefined ? undefined : createConfigFileOperations({ cwd, snapshot: config });

  try {
    configFile?.assertUnchanged();
    let currentConfig = config;
    let protectedTermsFileChange: ProjectTermsUpdateView['protectedTermsFileChange'];
    if (protectedRequest?.file !== undefined) {
      const pointer = protectedRequest.file.trim() || undefined;
      const collectionName = protectedRequest.target?.collection;
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
        ? setCollectionProtectedTermsFile(collectionName, pointer, { cwd, config: currentConfig, configFile })
        : setGlobalProtectedTermsFile(pointer, { cwd, config: currentConfig, configFile });
      currentConfig = collectionName
        ? {
            ...currentConfig,
            collections: {
              ...currentConfig.collections,
              [collectionName]: { ...currentConfig.collections[collectionName], protectedTermsFile: pointer },
            },
          }
        : { ...currentConfig, protectedTermsFile: pointer };
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
        const result = setGlobalProtectedTerms(terms, { cwd, config: currentConfig });
        protectedTermsResult = { terms, filePath: result.filePath };
      } else if (hasProtectedEdit && protectedEdit !== undefined && protectedTerms !== undefined) {
        protectedTermsResult = editProtectedTerms(protectedRequest?.target ?? {}, protectedTerms, protectedEdit, {
          cwd,
          config: currentConfig,
        });
      }
    }
    return { ...view, protectedTermsResult, preferredTerminologyResult };
  } catch (error) {
    // The guarded handle rejects before it changes config or a term file.
    if (error instanceof ConfigChangedError) throw error;
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

/** Convenience entry point for callers that do not show a preview. */
export function updateProjectTerms(
  config: LingoTrackerConfig | undefined,
  update: ProjectTermsUpdate,
  options: { readonly cwd?: string } = {},
): ProjectTermsUpdateResult {
  return planProjectTermsUpdate(config, update, options).apply();
}
