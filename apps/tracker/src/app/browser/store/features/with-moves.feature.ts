import { computed, inject } from '@angular/core';
import { signalStoreFeature, withState, withComputed, withMethods, patchState, type } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { type MonoTypeOperatorFunction, catchError, defer, finalize, from, of, pipe, switchMap, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoService } from '@jsverse/transloco';
import type { FolderNodeDto, ResourceSummaryDto } from '@simoncodes-ca/data-transfer';
import { splitResolvedKey } from '@simoncodes-ca/domain';
import { NotificationService } from '../../../shared/notification';
import { BrowserApiService } from '../../services/browser-api.service';
import { apiErrorMessage } from '../../../shared/api-error/api-error';
import { TRACKER_TOKENS } from '../../../../i18n-types/tracker-resources';
import { extractFolderNameFromPath, extractParentFolderPath } from '../../utils/folder-path.utils';
import {
  collectAncestorPaths,
  findFolderInTree,
  insertFolderIntoTree,
  rebaseExpandedPaths,
  rebaseFolderPaths,
  removeFolderFromTree,
} from '../folder-tree.utils';
import { captureSession, type SessionCheck, withinSession } from '../session-guard';

export interface MovesState {
  /** Moves sent and not yet answered. Written only by `whileMoving`. */
  movesInFlight: number;
}

export const initialMovesState: MovesState = {
  movesInFlight: 0,
};

/**
 * Drag-and-drop moves: a resource into another folder, a folder under another one.
 *
 * Both update the screen before the server answers and roll back when it refuses. While one
 * is in flight `isMoving` is true, which locks the folder tree and the editing affordances
 * (`isDisabled` in `browser.store.ts`). After a move the list is reloaded through the List
 * Scope, so a move never loads rows of its own.
 */
export function withMovesFeature<_>() {
  return signalStoreFeature(
    {
      state: type<{
        sessionId: number;
        selectedCollection: string | null;
        currentFolderPath: string;
        translations: ResourceSummaryDto[];
        error: string | null;
        rootFolders: FolderNodeDto[];
        expandedFolders: ReadonlySet<string>;
        isDeletingFolder: boolean;
      }>(),
      // Provided by withListScopeFeature and withFolderTreeFeature, which compose before this feature.
      methods: type<{
        showFolder(path: string): void;
        reloadList(): void;
        loadRootFolders(): void;
        loadFolderChildren(path: string): void;
      }>(),
    },
    withState(initialMovesState),
    withComputed(({ movesInFlight }) => ({
      isMoving: computed(() => movesInFlight() > 0),
    })),
    withMethods((store) => {
      const api = inject(BrowserApiService);
      const notifications = inject(NotificationService);
      const dialog = inject(MatDialog);
      const transloco = inject(TranslocoService);

      /**
       * Counts the move as in flight from subscribe until it settles. A move from a closed session
       * does not count down: the session that replaced it started from zero.
       */
      function whileMoving<T>(inSession: SessionCheck): MonoTypeOperatorFunction<T> {
        return (source) =>
          defer(() => {
            patchState(store, { movesInFlight: store.movesInFlight() + 1 });
            return source.pipe(
              finalize(() => {
                if (inSession()) patchState(store, { movesInFlight: store.movesInFlight() - 1 });
              }),
            );
          });
      }

      return {
        moveResource: rxMethod<{ sourceKey: string; destinationFolderPath: string }>(
          pipe(
            tap(() => patchState(store, { error: null })),
            switchMap(({ sourceKey, destinationFolderPath }) => {
              const inSession = captureSession(store);
              const collection = store.selectedCollection();
              if (!collection) return of(null);

              const { folderPath, entryKey } = splitResolvedKey(sourceKey);
              if (folderPath.join('.') === destinationFolderPath) {
                notifications.info(transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.RESOURCEALREADYINFOLDER));
                return of(null);
              }

              const destinationKey = destinationFolderPath ? `${destinationFolderPath}.${entryKey}` : entryKey;

              const currentTranslations = store.translations();
              patchState(store, { translations: currentTranslations.filter((r) => r.fullKey !== sourceKey) });

              return api.moveResource(collection, sourceKey, destinationKey).pipe(
                withinSession(inSession),
                tap(() => {
                  notifications.success(
                    transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.RESOURCEMOVEDX, {
                      name: entryKey,
                      folder: destinationFolderPath || 'root',
                    }),
                  );
                  store.loadRootFolders();
                  store.reloadList();
                }),
                catchError((error: unknown) => {
                  const errorMessage = apiErrorMessage(
                    error,
                    transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.MOVERESOURCEFAILED),
                  );
                  patchState(store, { translations: currentTranslations, error: errorMessage });
                  notifications.error(errorMessage);
                  return of(null);
                }),
                whileMoving(inSession),
              );
            }),
          ),
        ),

        moveFolder: rxMethod<{ sourceFolderPath: string; destinationFolderPath: string }>(
          pipe(
            tap(() => patchState(store, { error: null })),
            switchMap(({ sourceFolderPath, destinationFolderPath }) => {
              const inSession = captureSession(store);
              const collection = store.selectedCollection();
              if (!collection) return of(null);

              if (sourceFolderPath === destinationFolderPath) return of(null);

              const sourceParentPath = extractParentFolderPath(sourceFolderPath);
              if (sourceParentPath === destinationFolderPath) {
                notifications.info(transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.FOLDERALREADYATLOCATION));
                return of(null);
              }

              const folderName = extractFolderNameFromPath(sourceFolderPath);

              return from(import('../../../shared/components/confirmation-dialog/confirmation-dialog')).pipe(
                switchMap((module) => {
                  const dialogRef = dialog.open(module.ConfirmationDialog, {
                    data: {
                      title: transloco.translate(TRACKER_TOKENS.BROWSER.DIALOG.MOVEFOLDER.TITLE),
                      message: transloco.translate(TRACKER_TOKENS.BROWSER.DIALOG.MOVEFOLDER.MESSAGEX, {
                        name: folderName,
                        dest: destinationFolderPath || 'root',
                      }),
                      confirmButtonText: transloco.translate(TRACKER_TOKENS.COMMON.ACTIONS.MOVE),
                      actionType: 'standard',
                    },
                    width: '400px',
                  });

                  return dialogRef.afterClosed();
                }),
                withinSession(inSession),
                switchMap((confirmed) => {
                  if (!confirmed) return of(null);

                  const currentFolders = store.rootFolders();
                  patchState(store, {
                    isDeletingFolder: true,
                    rootFolders: removeFolderFromTree(currentFolders, sourceFolderPath),
                  });

                  return api.moveFolder(collection, sourceFolderPath, destinationFolderPath).pipe(
                    withinSession(inSession),
                    tap(() => {
                      notifications.success(
                        transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.FOLDERMOVEDX, {
                          name: folderName,
                          dest: destinationFolderPath || 'root',
                        }),
                      );
                      patchState(store, { isDeletingFolder: false });

                      const destWasLoaded = destinationFolderPath
                        ? (findFolderInTree(store.rootFolders(), destinationFolderPath)?.loaded ?? false)
                        : true;

                      const sourceNode = findFolderInTree(currentFolders, sourceFolderPath);
                      if (sourceNode) {
                        const rebasedFolder = rebaseFolderPaths(sourceNode, destinationFolderPath);
                        const updatedFolders = insertFolderIntoTree(
                          store.rootFolders(),
                          rebasedFolder,
                          destinationFolderPath || null,
                        );
                        patchState(store, { rootFolders: updatedFolders });

                        if (!destWasLoaded && destinationFolderPath) {
                          store.loadFolderChildren(destinationFolderPath);
                        }
                      } else {
                        store.loadRootFolders();
                      }

                      // Carry the moved subtree's own expansion across, then open the
                      // destination so the folder is visible where it landed.
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
                    }),
                    catchError((error: unknown) => {
                      const errorMessage = apiErrorMessage(
                        error,
                        transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.MOVEFOLDERFAILED),
                      );
                      patchState(store, {
                        rootFolders: currentFolders,
                        isDeletingFolder: false,
                        error: errorMessage,
                      });
                      notifications.error(errorMessage);
                      return of(null);
                    }),
                    whileMoving(inSession),
                  );
                }),
              );
            }),
          ),
        ),
      };
    }),
  );
}
