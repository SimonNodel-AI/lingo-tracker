import { computed, inject } from '@angular/core';
import { signalStoreFeature, withState, withComputed, withMethods, patchState, type } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, tap, switchMap, catchError, of, from } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoService } from '@jsverse/transloco';
import { NotificationService } from '../../../shared/notification';
import { BrowserApiService, CollectionIndexNotReadyError } from '../../services/browser-api.service';
import { extractFolderNameFromPath, extractParentFolderPath } from '../../utils/folder-path.utils';
import {
  insertFolderIntoTree,
  removeFolderFromTree,
  findFolderInTree,
  filterFolderTree,
  rebaseFolderPaths,
  collectExpandablePaths,
  collectAncestorPaths,
  prunePathsUnder,
  rebaseExpandedPaths,
} from '../folder-tree.utils';
import { toErrorMessage } from '../async-error.utils';
import { TRACKER_TOKENS } from '../../../../i18n-types/tracker-resources';
import type { FolderNodeDto, CreateFolderResponseDto, ResourceSummaryDto } from '@simoncodes-ca/data-transfer';
import type { Observable } from 'rxjs';

interface FolderTreeState {
  rootFolders: FolderNodeDto[];
  expandedFolders: Set<string>;
  /** Expansion as it stood before a filter took over; restored when the filter clears. */
  preFilterExpandedFolders: Set<string> | null;
  isRootExpanded: boolean;
  folderTreeFilter: string;
  isFolderTreeLoading: boolean;
  isAddingFolder: boolean;
  addFolderParentPath: string | null;
  newlyCreatedFolderPath: string | null;
  isDeletingFolder: boolean;
  deletingFolderPath: string | null;
}

const initialFolderTreeState: FolderTreeState = {
  rootFolders: [],
  expandedFolders: new Set<string>(),
  preFilterExpandedFolders: null,
  isRootExpanded: true,
  folderTreeFilter: '',
  isFolderTreeLoading: false,
  isAddingFolder: false,
  addFolderParentPath: null,
  newlyCreatedFolderPath: null,
  isDeletingFolder: false,
  deletingFolderPath: null,
};

export function withFolderTreeFeature<_>() {
  return signalStoreFeature(
    {
      // State from root and other features used by this feature's methods
      state: type<{
        selectedCollection: string | null;
        showNestedResources: boolean;
        isDisabled: boolean;
        isTranslationsLoading: boolean;
        translations: ResourceSummaryDto[];
        error: string | null;
        currentFolderPath: string;
      }>(),
      // selectFolder and setTranslationsLoading are provided by withTranslationsFeature, which composes before this feature
      methods: type<{ selectFolder(path: string): void; setTranslationsLoading(value: boolean): void }>(),
    },
    withState(initialFolderTreeState),
    withComputed(
      ({ rootFolders, folderTreeFilter, currentFolderPath, isFolderTreeLoading, isTranslationsLoading }) => ({
        filteredFolders: computed(() => filterFolderTree(rootFolders(), folderTreeFilter())),

        breadcrumbs: computed(() => {
          const path = currentFolderPath();
          if (!path) return [];
          return path.split('.');
        }),

        isLoading: computed(() => isFolderTreeLoading() || isTranslationsLoading()),
      }),
    ),

    // Second computed block: derives from filteredFolders, declared above.
    withComputed(({ filteredFolders, expandedFolders, currentFolderPath }) => ({
      /**
       * Expansion as the tree renders it: what the user opened, plus the ancestors of the
       * selected folder, so the selection can never hide inside a closed parent after a
       * move, a delete, or a reload.
       */
      visibleExpandedFolders: computed(() => {
        const visible = new Set(expandedFolders());
        for (const ancestor of collectAncestorPaths(currentFolderPath())) visible.add(ancestor);
        return visible;
      }),

      /** Drives the expand/collapse-all toggle, scoped to the filtered subtree when filtering. */
      areAllFoldersExpanded: computed(() => {
        const expandable = collectExpandablePaths(filteredFolders());
        if (expandable.length === 0) return false;
        const expanded = expandedFolders();
        return expandable.every((path) => expanded.has(path));
      }),
    })),

    // First methods block: core loading operations (loadRootFolders, loadFolderChildren, etc.)
    // Kept separate so the second block can reference these methods via the store ref.
    withMethods((store) => {
      const api = inject(BrowserApiService);
      const transloco = inject(TranslocoService);
      const notifications = inject(NotificationService);

      /**
       * The index can go not-ready mid-session (reindex, outside change, eviction). When a tree read
       * gives up for that reason and a tree is already on screen, keep it and toast: the `error`
       * state would replace the tree. Returns false (not handled) for other errors and on first load.
       */
      function keepTreeOnNotReady(error: unknown, message: string): boolean {
        if (!(error instanceof CollectionIndexNotReadyError) || store.rootFolders().length === 0) return false;
        patchState(store, { isFolderTreeLoading: false });
        notifications.error(message);
        return true;
      }

      function scheduleNewFolderClear(folderFullPath: string): void {
        setTimeout(() => {
          if (store.newlyCreatedFolderPath() === folderFullPath) {
            patchState(store, { newlyCreatedFolderPath: null });
          }
        }, 3000);
      }

      return {
        /**
         * Applies the folder filter and takes expansion with it: a filter that hid its own
         * matches inside collapsed parents would be useless, so matching branches open
         * automatically. The pre-filter expansion is stashed and restored on clear, which
         * keeps chevrons working normally while a filter is active.
         */
        setFolderTreeFilter(filter: string): void {
          const wasFiltering = store.folderTreeFilter().trim().length > 0;
          const isFiltering = filter.trim().length > 0;

          if (isFiltering) {
            patchState(store, {
              folderTreeFilter: filter,
              preFilterExpandedFolders: wasFiltering ? store.preFilterExpandedFolders() : store.expandedFolders(),
            });
            patchState(store, { expandedFolders: new Set(collectExpandablePaths(store.filteredFolders())) });
            return;
          }

          patchState(store, {
            folderTreeFilter: filter,
            expandedFolders: store.preFilterExpandedFolders() ?? store.expandedFolders(),
            preFilterExpandedFolders: null,
          });
        },

        toggleFolderExpanded(path: string): void {
          const newExpanded = new Set(store.expandedFolders());
          if (newExpanded.has(path)) newExpanded.delete(path);
          else newExpanded.add(path);
          patchState(store, { expandedFolders: newExpanded });
        },

        /** Opens a folder without closing it if it is already open — used when selecting a row. */
        expandFolder(path: string): void {
          if (!path || store.expandedFolders().has(path)) return;
          patchState(store, { expandedFolders: new Set(store.expandedFolders()).add(path) });
        },

        toggleRootExpanded(): void {
          patchState(store, { isRootExpanded: !store.isRootExpanded() });
        },

        /**
         * Opens every folder in view. Scoped to the filtered subtree when a filter is active,
         * so it never expands branches the user has just filtered away.
         */
        expandAllFolders(): void {
          const expanded = new Set(store.expandedFolders());
          for (const path of collectExpandablePaths(store.filteredFolders())) expanded.add(path);
          patchState(store, { expandedFolders: expanded, isRootExpanded: true });
        },

        /** Closes every folder but leaves the root open, so the top level stays reachable. */
        collapseAllFolders(): void {
          patchState(store, { expandedFolders: new Set<string>(), isRootExpanded: true });
        },

        startAddingFolder(parentPath: string | null): void {
          patchState(store, { isAddingFolder: true, addFolderParentPath: parentPath });
        },

        cancelAddingFolder(): void {
          patchState(store, { isAddingFolder: false, addFolderParentPath: null });
        },

        loadRootFolders: rxMethod<void>(
          pipe(
            tap(() => patchState(store, { isFolderTreeLoading: true, error: null })),
            switchMap(() => {
              const collection = store.selectedCollection();
              const includeNested = store.showNestedResources();
              if (!collection) {
                patchState(store, { isFolderTreeLoading: false });
                return of(null);
              }

              return api.getResourceTree(collection, '', includeNested).pipe(
                tap((treeData) =>
                  patchState(store, {
                    rootFolders: treeData.children,
                    translations: treeData.resources,
                    currentFolderPath: '',
                    isFolderTreeLoading: false,
                    error: null,
                  }),
                ),
                catchError((error: unknown) => {
                  const message = toErrorMessage(
                    error,
                    transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.LOADFOLDERSFAILED),
                  );
                  if (!keepTreeOnNotReady(error, message)) {
                    patchState(store, { isFolderTreeLoading: false, error: message });
                  }
                  return of(null);
                }),
              );
            }),
          ),
        ),

        loadFolderChildren: rxMethod<string>(
          pipe(
            tap(() => patchState(store, { isFolderTreeLoading: true, error: null })),
            switchMap((folderPath) => {
              const collection = store.selectedCollection();
              const includeNested = store.showNestedResources();
              if (!collection) {
                patchState(store, { isFolderTreeLoading: false });
                return of(null);
              }

              return api.getResourceTree(collection, folderPath, includeNested).pipe(
                tap((treeData) => {
                  const updateFolder = (folders: FolderNodeDto[]): FolderNodeDto[] =>
                    folders.map((folder) => {
                      if (folder.fullPath === folderPath) {
                        return { ...folder, loaded: true, tree: treeData };
                      }
                      if (folder.tree) {
                        return {
                          ...folder,
                          tree: { ...folder.tree, children: updateFolder(folder.tree.children) },
                        };
                      }
                      return folder;
                    });

                  patchState(store, {
                    rootFolders: updateFolder(store.rootFolders()),
                    isFolderTreeLoading: false,
                    error: null,
                  });
                }),
                catchError((error: unknown) => {
                  const message = toErrorMessage(
                    error,
                    transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.LOADFOLDERCHILDRENFAILED),
                  );
                  if (!keepTreeOnNotReady(error, message)) {
                    patchState(store, { isFolderTreeLoading: false, error: message });
                  }
                  return of(null);
                }),
              );
            }),
          ),
        ),

        createFolder: rxMethod<string>(
          pipe(
            tap(() => patchState(store, { error: null })),
            switchMap((folderName) => {
              const collection = store.selectedCollection();
              const parentPath = store.addFolderParentPath();

              if (!collection) {
                patchState(store, { isAddingFolder: false, addFolderParentPath: null });
                return of(null);
              }

              return api.createFolder(collection, folderName, parentPath || undefined).pipe(
                tap((response) => {
                  const updatedFolders = insertFolderIntoTree(store.rootFolders(), response.folder, parentPath || null);

                  patchState(store, {
                    isAddingFolder: false,
                    addFolderParentPath: null,
                    rootFolders: updatedFolders,
                    newlyCreatedFolderPath: response.folder.fullPath,
                    error: null,
                  });

                  scheduleNewFolderClear(response.folder.fullPath);
                }),
                catchError((error: unknown) => {
                  patchState(store, {
                    isAddingFolder: false,
                    addFolderParentPath: null,
                    error: toErrorMessage(error, transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.CREATEFOLDERFAILED)),
                  });
                  return of(null);
                }),
              );
            }),
          ),
        ),

        createFolderAt(folderName: string, parentPath: string | null): Observable<CreateFolderResponseDto | null> {
          const collection = store.selectedCollection();
          if (!collection) return of(null);

          return api.createFolder(collection, folderName, parentPath || undefined).pipe(
            tap((response) => {
              const updatedFolders = insertFolderIntoTree(store.rootFolders(), response.folder, parentPath);

              patchState(store, {
                rootFolders: updatedFolders,
                newlyCreatedFolderPath: response.folder.fullPath,
                error: null,
              });

              scheduleNewFolderClear(response.folder.fullPath);
            }),
            catchError((error: unknown) => {
              patchState(store, {
                error: toErrorMessage(error, transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.CREATEFOLDERFAILED)),
              });
              throw error;
            }),
          );
        },
      };
    }),

    // Second methods block: operations that call loadRootFolders/loadFolderChildren (available via store ref here)
    withMethods((store) => {
      const api = inject(BrowserApiService);
      const notifications = inject(NotificationService);
      const dialog = inject(MatDialog);
      const transloco = inject(TranslocoService);

      return {
        deleteFolder: rxMethod<string>(
          pipe(
            tap((folderPath) =>
              patchState(store, {
                isDeletingFolder: true,
                deletingFolderPath: folderPath,
                error: null,
              }),
            ),
            switchMap((folderPath) => {
              const collection = store.selectedCollection();
              if (!collection) {
                patchState(store, { isDeletingFolder: false, deletingFolderPath: null });
                return of(null);
              }

              return api.deleteFolder(collection, folderPath).pipe(
                tap((response) => {
                  if (response.deleted) {
                    const updatedFolders = removeFolderFromTree(store.rootFolders(), folderPath);
                    const pathSegments = folderPath.split('.');
                    const parentFolderPath = pathSegments.length > 1 ? pathSegments.slice(0, -1).join('.') : '';

                    patchState(store, {
                      isDeletingFolder: false,
                      deletingFolderPath: null,
                      rootFolders: updatedFolders,
                      expandedFolders: prunePathsUnder(store.expandedFolders(), folderPath),
                      error: null,
                    });

                    store.selectFolder(parentFolderPath);
                  }
                }),
                catchError((error: unknown) => {
                  patchState(store, {
                    isDeletingFolder: false,
                    deletingFolderPath: null,
                    error: toErrorMessage(error, transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.DELETEFOLDERFAILED)),
                  });
                  return of(null);
                }),
              );
            }),
          ),
        ),

        moveFolder: rxMethod<{ sourceFolderPath: string; destinationFolderPath: string }>(
          pipe(
            tap(() => patchState(store, { error: null })),
            switchMap(({ sourceFolderPath, destinationFolderPath }) => {
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
                switchMap((confirmed) => {
                  if (!confirmed) return of(null);

                  patchState(store, { isDisabled: true, isDeletingFolder: true });

                  const currentFolders = store.rootFolders();
                  const optimisticFolders = removeFolderFromTree(currentFolders, sourceFolderPath);
                  patchState(store, { rootFolders: optimisticFolders });

                  return api.moveFolder(collection, sourceFolderPath, destinationFolderPath).pipe(
                    switchMap(() => {
                      notifications.success(
                        transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.FOLDERMOVEDX, {
                          name: folderName,
                          dest: destinationFolderPath || 'root',
                        }),
                      );
                      patchState(store, { isDisabled: false, isDeletingFolder: false });

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

                      const movedFolderPath = destinationFolderPath
                        ? `${destinationFolderPath}.${folderName}`
                        : folderName;

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

                      const includeNested = store.showNestedResources();
                      patchState(store, { currentFolderPath: movedFolderPath });
                      store.setTranslationsLoading(true);

                      return api.getResourceTree(collection, movedFolderPath, includeNested).pipe(
                        tap((tree) => {
                          patchState(store, {
                            translations: tree.resources,
                            error: null,
                          });
                          store.setTranslationsLoading(false);
                        }),
                        catchError(() => {
                          store.setTranslationsLoading(false);
                          return of(null);
                        }),
                      );
                    }),
                    catchError((error: unknown) => {
                      const errorMessage = toErrorMessage(
                        error,
                        transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.MOVEFOLDERFAILED),
                      );
                      patchState(store, {
                        rootFolders: currentFolders,
                        isDisabled: false,
                        isDeletingFolder: false,
                        error: errorMessage,
                      });
                      notifications.error(errorMessage);
                      return of(null);
                    }),
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
