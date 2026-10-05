import {
  validateListEdit,
  mergeListEdit,
  normalizeProtectedTerms,
  validatePreferredTermRules,
} from '@simoncodes-ca/domain';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import {
  CollectionNotFoundError,
  InvalidProjectTermsEditError,
  InvalidCollectionError,
  PreferredTerminologyValidationError,
} from '../errors/lingo-tracker-error';
import { patchCollectionEntry } from './collection-entry';
import { guardedConfigWrite } from './config-file-operations';
import type { OpenedProject } from './open-collection';
import {
  editPreferredTerminology,
  type LoadPreferredTerminologyResult,
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
} from './set-protected-terms';
import { assertWritableTermFilePath } from './term-file';
import { protectedTermsTargetView, readProjectTermsView } from './project-terms-view';
import type { CompanionFileWrite } from './config-write-transaction';

/** Replacements and incremental edits both write the explicitly selected scope. */
export type ProtectedTermsChange =
  | { readonly kind: 'replace'; readonly replace: readonly string[]; readonly edit?: never }
  | { readonly kind: 'edit'; readonly edit: ProtectedTermsEdit; readonly replace?: never }
  | { readonly kind: 'view'; readonly edit?: never; readonly replace?: never };

export interface ProjectTermsUpdate {
  readonly protectedTerms?: {
    readonly target: { readonly collection?: string };
    readonly change: ProtectedTermsChange;
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
  readonly pointer?: PointerChange;
  readonly nextConfig: LingoTrackerConfig;
  readonly view: ProjectTermsUpdateView;
  readonly preferredPath?: string;
  readonly protectedPath?: string;
}

/** Checks edit combinations and submitted values once, before a pointer or term file changes. */
function validateProjectTermsUpdate(update: ProjectTermsUpdate): ValidatedEdit {
  const protectedRequest = update.protectedTerms;
  const preferredRequest = update.preferredTerminology;
  const protectedEdit = protectedRequest?.change.edit;
  const replacing = protectedRequest !== undefined && protectedRequest.change.kind === 'replace';
  let hasProtectedEdit = false;

  if (protectedRequest !== undefined) {
    if (protectedRequest.file !== undefined && typeof protectedRequest.file !== 'string') {
      throw new InvalidProjectTermsEditError('Protected terms file path must be a string', 'protected-file-path');
    }
    hasProtectedEdit = validateListEdit(protectedEdit ?? {}, {
      shape: () => new InvalidCollectionError('protectedTerms must be an array of strings'),
      conflict: () =>
        new InvalidProjectTermsEditError(
          'A replacement list cannot be combined with additions or removals',
          'protected-conflict',
        ),
      combinationsFirst: true,
      ...(!replacing &&
        !protectedRequest.list &&
        protectedRequest.file === undefined && {
          missing: () =>
            new InvalidProjectTermsEditError(
              'A protected terms update needs a list edit, list view, or file path',
              'protected-missing',
            ),
        }),
    });
    if (replacing) assertProtectedTerms(protectedRequest.change.replace);
    if (replacing && hasProtectedEdit) {
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
  return { replacing, hasProtectedEdit, hasPreferredEdit };
}

interface PointerChange {
  readonly destination?: string;
  readonly carried: readonly string[];
  readonly message: string;
}

/** Resolve a pointer change independently from the list change. */
function planProtectedTermsPointer(
  project: OpenedProject,
  request: NonNullable<ProjectTermsUpdate['protectedTerms']>,
  protectedTerms: ProtectedTermsView | undefined,
) {
  const { sourceConfig: currentConfig, projectRoot: cwd } = project;
  let nextConfig = currentConfig;
  let pointerChange: PointerChange | undefined;
  let protectedTermsFileChange: ProjectTermsUpdateView['protectedTermsFileChange'];
  if (request.file !== undefined) {
    const pointer = request.file.trim() || undefined;
    const collectionName = request.target.collection;
    if (collectionName && !Object.keys(currentConfig.collections ?? {}).includes(collectionName)) {
      throw new CollectionNotFoundError(collectionName);
    }
    let filePath: string | undefined;
    if (collectionName) {
      if (pointer !== undefined) filePath = resolveProtectedTermsFilePath(pointer, cwd);
    } else {
      filePath = resolveGlobalProtectedTermsFilePath({ ...currentConfig, protectedTermsFile: pointer }, cwd);
    }
    if (filePath !== undefined) assertWritableProtectedTermsPath(filePath);
    const carried = collectionName
      ? readCollectionProtectedTerms(currentConfig.collections[collectionName], cwd).terms
      : readGlobalProtectedTerms(currentConfig, cwd).terms;
    let message = `Global protected terms file set to ${filePath}`;
    if (collectionName) {
      message =
        filePath === undefined
          ? `Collection "${collectionName}" protected terms file cleared`
          : `Collection "${collectionName}" protected terms file set to ${filePath}`;
    }
    protectedTermsFileChange = { message, filePath };
    pointerChange = {
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
  return { nextConfig, pointerChange, protectedTermsFileChange, protectedTerms };
}

/** Validate and read without writing. The caller can show the view before applying the edit. */
export function planProjectTermsUpdate(project: OpenedProject, update: ProjectTermsUpdate): ProjectTermsUpdatePlan {
  const validated = validateProjectTermsUpdate(update);
  const { projectRoot: cwd, sourceConfig: currentConfig } = project;
  const protectedRequest = update.protectedTerms;
  const { replacing } = validated;
  const preferredRequest = update.preferredTerminology;
  const collectionName = protectedRequest?.target.collection;
  if (
    protectedRequest !== undefined &&
    !replacing &&
    collectionName &&
    currentConfig.collections[collectionName] === undefined
  ) {
    throw new CollectionNotFoundError(collectionName);
  }
  const needsProtectedView = protectedRequest !== undefined && !replacing;
  const needsPreferredView = preferredRequest !== undefined && preferredRequest.set === undefined;
  const snapshot = needsProtectedView || needsPreferredView ? readProjectTermsView(project) : undefined;
  let protectedTerms: ProtectedTermsView | undefined;
  if (needsProtectedView && protectedRequest !== undefined && snapshot !== undefined) {
    protectedTerms = protectedTermsTargetView(snapshot, protectedRequest.target);
  }
  const preferredTerminology =
    preferredRequest !== undefined && preferredRequest.set === undefined ? snapshot?.preferredTerminology : undefined;
  const pointerPlan =
    protectedRequest === undefined
      ? { nextConfig: currentConfig, protectedTerms, pointerChange: undefined, protectedTermsFileChange: undefined }
      : planProtectedTermsPointer(project, protectedRequest, protectedTerms);
  const { nextConfig, pointerChange, protectedTermsFileChange } = pointerPlan;
  protectedTerms = pointerPlan.protectedTerms;
  const preferredPath = validated.hasPreferredEdit ? resolvePreferredTerminologyFilePath(nextConfig, cwd) : undefined;
  if (preferredPath !== undefined) assertWritableTermFilePath('preferred terminology file', preferredPath);
  let protectedPath: string | undefined;
  if (replacing || validated.hasProtectedEdit) {
    if (collectionName) {
      const collection = nextConfig.collections[collectionName];
      if (collection === undefined) throw new CollectionNotFoundError(collectionName);
      protectedPath = resolveWritableCollectionProtectedTermsPath(collectionName, collection, cwd);
    } else {
      protectedPath = resolveGlobalProtectedTermsFilePath(nextConfig, cwd);
    }
  }
  if (protectedPath !== undefined) assertWritableProtectedTermsPath(protectedPath);
  const view = { protectedTerms, preferredTerminology, protectedTermsFileChange };
  const resolved: ResolvedProjectTermsUpdate = {
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
  const { pointer, preferredPath, protectedPath, view } = resolved;
  const writes: CompanionFileWrite[] = [];
  if (pointer?.destination !== undefined) {
    const destination = pointer.destination;
    writes.push({ path: destination, write: () => writeProtectedTermsFile(destination, [...pointer.carried]) });
  }
  let preferredTerminologyResult: PreferredTerminologyEditResult | undefined;
  const preferredRequest = update.preferredTerminology;
  if (preferredPath !== undefined && preferredRequest !== undefined) {
    writes.push({
      path: preferredPath,
      write: () => {
        preferredTerminologyResult = editPreferredTerminology(
          resolved.nextConfig,
          preferredRequest,
          cwd,
          view.preferredTerminology,
        );
      },
    });
  }
  let protectedTermsResult: ProtectedTermsEditResult | undefined;
  const protectedRequest = update.protectedTerms;
  if (protectedPath !== undefined && protectedRequest !== undefined) {
    const change = protectedRequest.change;
    let terms: string[] | undefined;
    switch (change.kind) {
      case 'replace':
        terms = normalizeProtectedTerms([...change.replace]);
        break;
      case 'edit':
        if (view.protectedTerms !== undefined) {
          terms = mergeListEdit(view.protectedTerms.storedTerms, change.edit, normalizeProtectedTerms);
        }
        break;
      case 'view':
        break;
    }
    if (terms !== undefined) {
      const nextTerms = terms;
      writes.push({
        path: protectedPath,
        write: () => {
          writeProtectedTermsFile(protectedPath, nextTerms);
          protectedTermsResult = { terms: nextTerms, filePath: protectedPath };
        },
      });
    }
  }
  configWrite.transaction(pointer === undefined ? undefined : resolved.nextConfig, writes);
  return { ...view, protectedTermsResult, preferredTerminologyResult };
}

/** Convenience entry point for callers that do not show a preview. */
export function updateProjectTerms(project: OpenedProject, update: ProjectTermsUpdate): ProjectTermsUpdateResult {
  return planProjectTermsUpdate(project, update).apply();
}
