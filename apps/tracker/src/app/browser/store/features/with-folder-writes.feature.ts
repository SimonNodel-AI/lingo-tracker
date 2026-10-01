import { computed, inject } from '@angular/core';
import { patchState, signalStoreFeature, type, withComputed, withMethods, withState } from '@ngrx/signals';
import type { FolderNodeDto, ResourceSummaryDto } from '@simoncodes-ca/data-transfer';
import { splitResolvedKey } from '@simoncodes-ca/domain';
import { catchError, defer, finalize, from, map, type Observable, of, switchMap } from 'rxjs';
import { ApiError } from '../../../shared/api-error/api-error';
import { BrowserApiService } from '../../services/browser-api.service';
import { extractFolderNameFromPath } from '../../utils/folder-path.utils';
import { cancelFolderDraft, startFolderDraft } from '../folder-draft';
import { folderDrop } from '../folder-drop';
import { planFolderMove, planFolderMoveRollback } from '../folder-move-plan';
import {
  findFolderInTree,
  insertFolderIntoTree,
  parentFolderPath,
  prunePathsUnder,
  removeFolderFromTree,
} from '../folder-tree.utils';
import { captureSession } from '../session-guard';

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
  | { kind: 'invalid-drop' }
  | { kind: 'moved'; folderName: string; destinationFolderPath: string }
  | {
      kind: 'noop';
      reason: 'same-folder' | 'already-at-location';
    };
export type MoveResourceOutcome =
  | Refusal
  | { kind: 'moved'; entryKey: string; destinationFolderPath: string }
  | { kind: 'noop'; reason: 'already-in-folder' };
export type RequestedFolderMoveOutcome = MoveFolderOutcome | { kind: 'cancelled' };

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

      function moveFolder({
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
          const decision = folderDrop({ type: 'folder', path: sourceFolderPath }, destinationFolderPath, false);
          if (decision.noOp === 'same-folder' || decision.noOp === 'already-at-location')
            return of({ kind: 'noop', reason: decision.noOp } as const);
          if (!decision.canLand) return of({ kind: 'invalid-drop' } as const);
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
                const plan = planFolderMove(
                  { tree: store.rootFolders(), expanded: store.expandedFolders(), sourceNode },
                  sourceFolderPath,
                  destinationFolderPath,
                );
                if (plan.kind === 'patch-tree') {
                  patchState(store, { rootFolders: plan.tree });
                  if (plan.loadChildrenFor) store.loadFolderChildren(plan.loadChildrenFor);
                } else store.loadRootFolders();
                patchState(store, { expandedFolders: plan.expanded });
                store.showFolder(plan.showPath);
                return { kind: 'moved', folderName, destinationFolderPath };
              }),
              catchError((error: unknown) => {
                if (inSession()) {
                  const tree = planFolderMoveRollback(store.rootFolders(), sourceFolderPath, sourceNode);
                  if (tree) patchState(store, { rootFolders: tree });
                }
                return of(inSession() ? refused(error) : ({ kind: 'stale-session' } as const));
              }),
            ),
            inSession,
          );
        });
      }

      return {
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
        moveFolder,
        requestFolderMove(
          move: { sourceFolderPath: string; destinationFolderPath: string },
          confirm: (inSession: () => boolean) => Promise<boolean>,
        ): Observable<RequestedFolderMoveOutcome> {
          return defer(() => {
            if (store.isReadOnly()) return of({ kind: 'read-only' } as const);
            if (!store.selectedCollection()) return of({ kind: 'no-collection' } as const);
            const decision = folderDrop(
              { type: 'folder', path: move.sourceFolderPath },
              move.destinationFolderPath,
              false,
            );
            if (decision.noOp || !decision.canLand) return moveFolder(move);
            const inSession = captureSession(store);
            return from(confirm(inSession)).pipe(
              switchMap((confirmed) => {
                if (!inSession()) return of({ kind: 'stale-session' } as const);
                if (!confirmed) return of({ kind: 'cancelled' } as const);
                return moveFolder(move);
              }),
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
            if (
              folderDrop(
                { type: 'resource', key: sourceKey, folderPath: folderPath.join('.') },
                destinationFolderPath,
                false,
              ).noOp === 'already-in-folder'
            )
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
