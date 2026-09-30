import { computed, inject } from '@angular/core';
import { patchState, signalStoreFeature, type, withComputed, withMethods, withState } from '@ngrx/signals';
import type { FolderNodeDto, ResourceSummaryDto } from '@simoncodes-ca/data-transfer';
import { splitResolvedKey } from '@simoncodes-ca/domain';
import { catchError, defer, finalize, map, of, type Observable } from 'rxjs';
import { ApiError } from '../../../shared/api-error/api-error';
import { BrowserApiService } from '../../services/browser-api.service';
import { extractFolderNameFromPath } from '../../utils/folder-path.utils';
import {
  collectAncestorPaths,
  findFolderInTree,
  folderMoveNoOp,
  insertFolderIntoTree,
  parentFolderPath,
  prunePathsUnder,
  rebaseExpandedPaths,
  rebaseFolderPaths,
  removeFolderFromTree,
} from '../folder-tree.utils';
import { captureSession } from '../session-guard';
import { startFolderDraft, cancelFolderDraft } from '../folder-draft';

export interface FolderWritesState {
  isAddingFolder: boolean;
  addFolderParentPath: string | null;
  /** Advances when an inline create error should be cleared. */
  folderCreateErrorEpoch: number;
  newlyCreatedFolderPath: string | null;
  isDeletingFolder: boolean;
  deletingFolderPath: string | null;
  movesInFlight: number;
}

export const initialFolderWritesState: FolderWritesState = {
  isAddingFolder: false,
  addFolderParentPath: null,
  folderCreateErrorEpoch: 0,
  newlyCreatedFolderPath: null,
  isDeletingFolder: false,
  deletingFolderPath: null,
  movesInFlight: 0,
};

type Refusal =
  | { kind: 'refused'; error: ApiError }
  | { kind: 'read-only' }
  | { kind: 'no-collection' }
  | { kind: 'stale-session' };
export type CreateFolderOutcome = Refusal | { kind: 'created'; folder: FolderNodeDto; created: boolean };
export type DeleteFolderOutcome = Refusal | { kind: 'deleted'; deleted: boolean };
export type MoveFolderOutcome =
  | Refusal
  | { kind: 'moved'; folderName: string; destinationFolderPath: string }
  | {
      kind: 'noop';
      reason: 'same-folder' | 'already-at-location';
    };
export type MoveResourceOutcome =
  | Refusal
  | { kind: 'moved'; entryKey: string; destinationFolderPath: string }
  | { kind: 'noop'; reason: 'already-in-folder' };

function refused(error: unknown): Refusal {
  return {
    kind: 'refused',
    error:
      error instanceof ApiError
        ? error
        : new ApiError({
            kind: 'other',
            status: 0,
            message: error instanceof Error ? error.message : undefined,
          }),
  };
}

/** All folder mutations, including a resource dropped onto a folder. Calls are cold. */
export function withFolderWritesFeature<_>() {
  return signalStoreFeature(
    {
      state: type<{
        sessionId: number;
        selectedCollection: string | null;
        isReadOnly: boolean;
        currentFolderPath: string;
        translations: ResourceSummaryDto[];
        loadedFolderPath: string | null;
        rootFolders: FolderNodeDto[];
        expandedFolders: ReadonlySet<string>;
      }>(),
      methods: type<{
        showFolder(path: string): void;
        reloadList(): void;
        loadRootFolders(): void;
        loadFolderChildren(path: string): void;
      }>(),
    },
    withState(initialFolderWritesState),
    withComputed(({ movesInFlight }) => ({
      isMoving: computed(() => movesInFlight() > 0),
    })),
    withMethods((store) => {
      const api = inject(BrowserApiService);

      function moving<T>(request: Observable<T>, inSession: () => boolean): Observable<T> {
        return defer(() => {
          patchState(store, { movesInFlight: store.movesInFlight() + 1 });
          return request.pipe(
            finalize(() => {
              if (inSession()) patchState(store, { movesInFlight: store.movesInFlight() - 1 });
            }),
          );
        });
      }

      return {
        folderMoveNoOp,
        captureFolderWriteSession(): () => boolean {
          return captureSession(store);
        },
        startAddingFolder(parentPath: string | null): void {
          if (!store.isReadOnly()) {
            patchState(store, startFolderDraft(parentPath), {
              folderCreateErrorEpoch: store.folderCreateErrorEpoch() + 1,
            });
          }
        },
        cancelAddingFolder(): void {
          patchState(store, cancelFolderDraft());
        },
        createFolder(folderName: string, parentPath: string | null): Observable<CreateFolderOutcome> {
          return defer(() => {
            if (store.isReadOnly()) return of({ kind: 'read-only' } as const);
            const collection = store.selectedCollection();
            if (!collection) return of({ kind: 'no-collection' } as const);
            const inSession = captureSession(store);
            return api.createFolder(collection, folderName, parentPath || undefined).pipe(
              map((response): CreateFolderOutcome => {
                if (!inSession()) return { kind: 'stale-session' };
                patchState(store, {
                  rootFolders: insertFolderIntoTree(store.rootFolders(), response.folder, parentPath),
                  newlyCreatedFolderPath: response.folder.fullPath,
                  folderCreateErrorEpoch: store.folderCreateErrorEpoch() + 1,
                });
                setTimeout(() => {
                  if (inSession() && store.newlyCreatedFolderPath() === response.folder.fullPath) {
                    patchState(store, { newlyCreatedFolderPath: null });
                  }
                }, 3000);
                return {
                  kind: 'created',
                  folder: response.folder,
                  created: response.created,
                };
              }),
              catchError((error: unknown) => of(inSession() ? refused(error) : ({ kind: 'stale-session' } as const))),
            );
          });
        },
        deleteFolder(folderPath: string): Observable<DeleteFolderOutcome> {
          return defer(() => {
            if (store.isReadOnly()) return of({ kind: 'read-only' } as const);
            const collection = store.selectedCollection();
            if (!collection) return of({ kind: 'no-collection' } as const);
            const inSession = captureSession(store);
            patchState(store, {
              isDeletingFolder: true,
              deletingFolderPath: folderPath,
            });
            return api.deleteFolder(collection, folderPath).pipe(
              map((response): DeleteFolderOutcome => {
                if (!inSession()) return { kind: 'stale-session' };
                patchState(store, {
                  isDeletingFolder: false,
                  deletingFolderPath: null,
                });
                if (response.deleted) {
                  patchState(store, {
                    rootFolders: removeFolderFromTree(store.rootFolders(), folderPath),
                    expandedFolders: prunePathsUnder(store.expandedFolders(), folderPath),
                  });
                  const shown = store.currentFolderPath();
                  if (shown === folderPath || shown.startsWith(`${folderPath}.`)) {
                    store.showFolder(parentFolderPath(folderPath) ?? '');
                  }
                }
                return { kind: 'deleted', deleted: response.deleted };
              }),
              catchError((error: unknown) => {
                if (inSession())
                  patchState(store, {
                    isDeletingFolder: false,
                    deletingFolderPath: null,
                  });
                return of(inSession() ? refused(error) : ({ kind: 'stale-session' } as const));
              }),
            );
          });
        },
        moveFolder({
          sourceFolderPath,
          destinationFolderPath,
        }: {
          sourceFolderPath: string;
          destinationFolderPath: string;
        }): Observable<MoveFolderOutcome> {
          return defer(() => {
            if (store.isReadOnly()) return of({ kind: 'read-only' } as const);
            const collection = store.selectedCollection();
            if (!collection) return of({ kind: 'no-collection' } as const);
            const noOp = folderMoveNoOp(sourceFolderPath, destinationFolderPath);
            if (noOp) return of({ kind: 'noop', reason: noOp } as const);
            const inSession = captureSession(store);
            const sourceNode = findFolderInTree(store.rootFolders(), sourceFolderPath);
            const folderName = extractFolderNameFromPath(sourceFolderPath);
            // A concurrent tree load can replace the optimistic tree while the request is pending.
            const optimisticTree = removeFolderFromTree(store.rootFolders(), sourceFolderPath);
            patchState(store, { rootFolders: optimisticTree });
            return moving(
              api.moveFolder(collection, sourceFolderPath, destinationFolderPath).pipe(
                map((): MoveFolderOutcome => {
                  if (!inSession()) return { kind: 'stale-session' };
                  const destinationLoaded = destinationFolderPath
                    ? (findFolderInTree(store.rootFolders(), destinationFolderPath)?.loaded ?? false)
                    : true;
                  if (sourceNode) {
                    const current = removeFolderFromTree(store.rootFolders(), sourceFolderPath);
                    patchState(store, {
                      rootFolders: insertFolderIntoTree(
                        current,
                        rebaseFolderPaths(sourceNode, destinationFolderPath),
                        destinationFolderPath || null,
                      ),
                    });
                    if (!destinationLoaded && destinationFolderPath) store.loadFolderChildren(destinationFolderPath);
                  } else store.loadRootFolders();
                  const expanded = rebaseExpandedPaths(
                    store.expandedFolders(),
                    sourceFolderPath,
                    destinationFolderPath,
                  );
                  if (destinationFolderPath) {
                    expanded.add(destinationFolderPath);
                    for (const ancestor of collectAncestorPaths(destinationFolderPath)) expanded.add(ancestor);
                  }
                  patchState(store, { expandedFolders: expanded });
                  store.showFolder(destinationFolderPath ? `${destinationFolderPath}.${folderName}` : folderName);
                  return { kind: 'moved', folderName, destinationFolderPath };
                }),
                catchError((error: unknown) => {
                  if (inSession() && sourceNode) {
                    // Undo only this removal against the current tree. Never restore a pre-move snapshot.
                    const current = store.rootFolders();
                    if (!findFolderInTree(current, sourceFolderPath)) {
                      const parentPath = parentFolderPath(sourceFolderPath);
                      const parent = parentPath ? findFolderInTree(current, parentPath) : null;
                      if (!parentPath || (parent?.loaded && parent.tree)) {
                        patchState(store, {
                          rootFolders: insertFolderIntoTree(current, sourceNode, parentPath),
                        });
                      }
                    }
                  }
                  return of(inSession() ? refused(error) : ({ kind: 'stale-session' } as const));
                }),
              ),
              inSession,
            );
          });
        },
        moveResource({
          sourceKey,
          destinationFolderPath,
        }: {
          sourceKey: string;
          destinationFolderPath: string;
        }): Observable<MoveResourceOutcome> {
          return defer(() => {
            if (store.isReadOnly()) return of({ kind: 'read-only' } as const);
            const collection = store.selectedCollection();
            if (!collection) return of({ kind: 'no-collection' } as const);
            const { folderPath, entryKey } = splitResolvedKey(sourceKey);
            if (folderPath.join('.') === destinationFolderPath)
              return of({ kind: 'noop', reason: 'already-in-folder' } as const);
            const inSession = captureSession(store);
            const movedRow = store.translations().find((row) => row.fullKey === sourceKey);
            const rowsFolder = store.loadedFolderPath();
            patchState(store, {
              translations: store.translations().filter((row) => row.fullKey !== sourceKey),
            });
            const destinationKey = destinationFolderPath ? `${destinationFolderPath}.${entryKey}` : entryKey;
            return moving(
              api.moveResource(collection, sourceKey, destinationKey).pipe(
                map((): MoveResourceOutcome => {
                  if (!inSession()) return { kind: 'stale-session' };
                  store.loadRootFolders();
                  store.reloadList();
                  return { kind: 'moved', entryKey, destinationFolderPath };
                }),
                catchError((error: unknown) => {
                  if (inSession()) {
                    const rows = store.translations();
                    if (
                      movedRow &&
                      store.loadedFolderPath() === rowsFolder &&
                      !rows.some((row) => row.fullKey === sourceKey)
                    ) {
                      patchState(store, { translations: [...rows, movedRow] });
                    }
                  }
                  return of(inSession() ? refused(error) : ({ kind: 'stale-session' } as const));
                }),
              ),
              inSession,
            );
          });
        },
      };
    }),
  );
}
