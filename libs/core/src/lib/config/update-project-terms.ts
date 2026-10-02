import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import {
  listEditProblem,
  mergeListEdit,
  normalizeProtectedTerms,
  validatePreferredTermRules,
} from '@simoncodes-ca/domain';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import {
  CollectionNotFoundError,
  ConfigChangedError,
  InvalidProjectTermsEditError,
  PreferredTerminologyValidationError,
} from '../errors/lingo-tracker-error';
import { patchCollectionEntry } from './collection-entry';
import { guardedConfigWrite, updateConfig } from './config-file-operations';
import { loadConfig } from './load-config';
import type { OpenedProject } from './open-collection';
import {
  editPreferredTerminology,
  type LoadPreferredTerminologyResult,
  loadPreferredTerminology,
  type PreferredTerminologyEdit,
  type PreferredTerminologyEditResult,
  resolvePreferredTerminologyFilePath,
} from './preferred-terminology-file';
import {
  assertWritableProtectedTermsPath,
  readCollectionProtectedTerms,
  readGlobalProtectedTerms,
  resolveGlobalProtectedTermsFilePath,
  resolveProtectedTermsFilePath,
  resolveWritableCollectionProtectedTermsPath,
  writeProtectedTermsFile,
} from './protected-terms-file';
import {
  assertProtectedTerms,
  type ProtectedTermsEdit,
  type ProtectedTermsEditResult,
  type ProtectedTermsView,
  readProtectedTermsTarget,
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

interface ResolvedProjectTermsUpdate {
  readonly validated: ValidatedEdit;
  readonly pointer?: PointerChange & {
    readonly destination?: string;
    readonly carried: readonly string[];
    readonly message: string;
  };
  readonly nextConfig: LingoTrackerConfig;
  readonly view: ProjectTermsUpdateView;
  readonly preferredPath?: string;
  readonly protectedPath?: string;
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
      throw new InvalidProjectTermsEditError('Protected terms file path must be a string', 'protected-file-path');
    }
    if (protectedProblem === 'conflict') {
      throw new InvalidProjectTermsEditError(
        'A replacement list cannot be combined with additions or removals',
        'protected-conflict',
      );
    }
    if (!replacing && protectedProblem === 'missing' && !protectedRequest.list && protectedRequest.file === undefined) {
      throw new InvalidProjectTermsEditError(
        'A protected terms update needs a list edit, list view, or file path',
        'protected-missing',
      );
    }
    if (replacing) assertProtectedTerms(protectedRequest.replace);
    if (protectedEdit?.add !== undefined) assertProtectedTerms(protectedEdit.add);
    if (protectedEdit?.remove !== undefined) assertProtectedTerms(protectedEdit.remove);
    if (protectedEdit?.set !== undefined) assertProtectedTerms(protectedEdit.set);
    if (replacing && protectedProblem !== 'missing') {
      throw new InvalidProjectTermsEditError(
        'A replacement list cannot be combined with another list edit',
        'protected-replacement-conflict',
      );
    }
  }

  const hasPreferredEdit =
    preferredRequest?.set !== undefined ||
    preferredRequest?.upsert !== undefined ||
    preferredRequest?.remove !== undefined;
  if (preferredRequest !== undefined) {
    if (!hasPreferredEdit && !preferredRequest.list) {
      throw new InvalidProjectTermsEditError(
        'A preferred terminology update needs a rule edit or list view',
        'preferred-missing',
      );
    }
    if (preferredRequest.remove !== undefined && typeof preferredRequest.remove !== 'string') {
      throw new InvalidProjectTermsEditError('A rule to remove must name a discouraged term', 'preferred-remove-shape');
    }
    if (
      Number(preferredRequest.set !== undefined) +
        Number(preferredRequest.upsert !== undefined) +
        Number(preferredRequest.remove !== undefined) >
      1
    ) {
      throw new InvalidProjectTermsEditError(
        'Only one preferred terminology edit can be applied at a time',
        'preferred-conflict',
      );
    }
    if (preferredRequest.set !== undefined) {
      if (!Array.isArray(preferredRequest.set)) {
        throw new InvalidProjectTermsEditError(
          'Preferred terminology replacement must be an array of rules',
          'preferred-replacement-shape',
        );
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
export function planProjectTermsUpdate(project: OpenedProject, update: ProjectTermsUpdate): ProjectTermsUpdatePlan {
  const validated = validateProjectTermsUpdate(update);
  const { projectRoot: cwd, sourceConfig: currentConfig } = project;
  const protectedRequest = update.protectedTerms;
  const { replacing } = validated;
  const preferredRequest = update.preferredTerminology;
  let protectedTerms =
    protectedRequest !== undefined && !replacing
      ? readProtectedTermsTarget(project, protectedRequest.target ?? {})
      : undefined;
  const preferredTerminology =
    preferredRequest !== undefined && preferredRequest.set === undefined
      ? loadPreferredTerminology(currentConfig, cwd)
      : undefined;
  let protectedTermsFileChange: ProjectTermsUpdateView['protectedTermsFileChange'];
  let pointerChange: ResolvedProjectTermsUpdate['pointer'];
  let nextConfig = currentConfig;
  if (protectedRequest?.file !== undefined) {
    const pointer = protectedRequest.file.trim() || undefined;
    const collectionName = protectedRequest.target?.collection;
    if (collectionName && !Object.keys(currentConfig.collections ?? {}).includes(collectionName)) {
      throw new CollectionNotFoundError(collectionName);
    }
    const filePath = collectionName
      ? pointer === undefined
        ? undefined
        : resolveProtectedTermsFilePath(pointer, cwd)
      : resolveGlobalProtectedTermsFilePath({ ...currentConfig, protectedTermsFile: pointer }, cwd);
    if (filePath !== undefined) assertWritableProtectedTermsPath(filePath);
    const previous = collectionName
      ? currentConfig.collections?.[collectionName]?.protectedTermsFile
      : currentConfig.protectedTermsFile;
    const carried = collectionName
      ? readCollectionProtectedTerms(currentConfig.collections[collectionName], cwd).terms
      : readGlobalProtectedTerms(currentConfig, cwd).terms;
    protectedTermsFileChange = {
      message: collectionName
        ? filePath === undefined
          ? `Collection "${collectionName}" protected terms file cleared`
          : `Collection "${collectionName}" protected terms file set to ${filePath}`
        : `Global protected terms file set to ${filePath}`,
      filePath,
    };
    pointerChange = {
      collection: collectionName,
      previous,
      next: pointer,
      destination: filePath,
      carried,
      message: protectedTermsFileChange.message,
    };
    if (collectionName) {
      nextConfig = patchCollectionEntry(currentConfig, collectionName, { protectedTermsFile: pointer ?? '' });
    } else {
      nextConfig = { ...currentConfig, protectedTermsFile: pointer };
      if (pointer === undefined) delete nextConfig.protectedTermsFile;
    }
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
  const preferredPath = validated.hasPreferredEdit ? resolvePreferredTerminologyFilePath(nextConfig, cwd) : undefined;
  if (preferredPath !== undefined) assertWritableTermFilePath('preferred terminology file', preferredPath);
  const collectionName = protectedRequest?.target?.collection;
  const protectedPath = replacing
    ? resolveGlobalProtectedTermsFilePath(nextConfig, cwd)
    : validated.hasProtectedEdit && collectionName
      ? resolveWritableCollectionProtectedTermsPath(collectionName, nextConfig.collections[collectionName], cwd)
      : validated.hasProtectedEdit
        ? protectedTerms?.globalFilePath
        : undefined;
  if (protectedPath !== undefined) assertWritableProtectedTermsPath(protectedPath);
  const view = { protectedTerms, preferredTerminology, protectedTermsFileChange };
  const resolved: ResolvedProjectTermsUpdate = {
    validated,
    pointer: pointerChange,
    nextConfig,
    view,
    preferredPath,
    protectedPath,
  };
  return {
    view,
    apply: () => applyProjectTermsUpdate(project, update, resolved),
  };
}

/** Apply a validated plan, restoring changed files and pointers after a failure. */
function applyProjectTermsUpdate(
  project: OpenedProject,
  update: ProjectTermsUpdate,
  resolved: ResolvedProjectTermsUpdate,
): ProjectTermsUpdateResult {
  const { projectRoot: cwd } = project;
  const configWrite = guardedConfigWrite(project);
  configWrite.assertUnchanged();
  const { pointer, preferredPath, protectedPath, validated, view } = resolved;
  const snapshots = new Map<string, FileSnapshot>();
  const changed: string[] = [];
  let pointerWritten = false;

  try {
    for (const path of new Set(
      [pointer?.destination, preferredPath, protectedPath].filter((path): path is string => path !== undefined),
    )) {
      snapshots.set(path, snapshotFile(path));
    }
    if (pointer) {
      configWrite.write(resolved.nextConfig);
      pointerWritten = true;
      if (pointer.destination) {
        changed.push(pointer.destination);
        writeProtectedTermsFile(pointer.destination, [...pointer.carried]);
      }
    }

    let preferredTerminologyResult: PreferredTerminologyEditResult | undefined;
    if (preferredPath && update.preferredTerminology) {
      changed.push(preferredPath);
      preferredTerminologyResult = editPreferredTerminology(
        resolved.nextConfig,
        update.preferredTerminology,
        cwd,
        view.preferredTerminology,
      );
    }

    let protectedTermsResult: ProtectedTermsEditResult | undefined;
    if (protectedPath && update.protectedTerms) {
      changed.push(protectedPath);
      const terms =
        validated.replacing && update.protectedTerms.replace !== undefined
          ? normalizeProtectedTerms([...update.protectedTerms.replace])
          : update.protectedTerms.edit && view.protectedTerms
            ? mergeListEdit(view.protectedTerms.storedTerms, update.protectedTerms.edit, normalizeProtectedTerms)
            : undefined;
      if (terms !== undefined) {
        writeProtectedTermsFile(protectedPath, terms);
        protectedTermsResult = { terms, filePath: protectedPath };
      }
    }
    return { ...view, protectedTermsResult, preferredTerminologyResult };
  } catch (error) {
    if (error instanceof ConfigChangedError) throw error;
    const restoreFailures: unknown[] = [];
    for (const path of [...new Set(changed)].reverse()) {
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
    if (pointerWritten && pointer) {
      try {
        restorePointer(pointer, cwd);
      } catch (restoreError) {
        restoreFailures.push(restoreError);
      }
    }
    attachRestoreFailure(error, restoreFailures);
    throw error;
  }
}

/** Convenience entry point for callers that do not show a preview. */
export function updateProjectTerms(project: OpenedProject, update: ProjectTermsUpdate): ProjectTermsUpdateResult {
  return planProjectTermsUpdate(project, update).apply();
}
