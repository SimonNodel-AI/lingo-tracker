import { computed, inject, type Signal } from '@angular/core';
import { signalStoreFeature, withState, withComputed, withMethods, patchState, type } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, tap, switchMap, catchError, of, defer } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { NotificationService } from '../../../shared/notification';
import { BrowserApiService, CollectionIndexNotReadyError } from '../../services/browser-api.service';
import {
  insertFolderIntoTree,
  removeFolderFromTree,
  filterFolderTree,
  collectExpandablePaths,
  collectAncestorPaths,
  prunePathsUnder,
  toggleExpandedPath,
  parentFolderPath,
} from '../folder-tree.utils';
import { apiErrorMessage } from '../../../shared/api-error/api-error';
import { captureSession, withinSession } from '../session-guard';
import { TRACKER_TOKENS } from '../../../../i18n-types/tracker-resources';
import type { FolderNodeDto, CreateFolderResponseDto } from '@simoncodes-ca/data-transfer';
import type { Observable } from 'rxjs';

export interface FolderTreeState {
  rootFolders: FolderNodeDto[];
  /**
   * A root tree load has succeeded for the selected collection. Not the same as
   * `rootFolders().length > 0`: a collection with only root resources has no folders.
   */
  folderTreeLoaded: boolean;
  /** Replaced, never mutated: every change writes a fresh Set. */
  expandedFolders: ReadonlySet<string>;
  /** Expansion as it stood before a filter took over; restored when the filter clears. */
  preFilterExpandedFolders: ReadonlySet<string> | null;
  isRootExpanded: boolean;
  folderTreeFilter: string;
  isFolderTreeLoading: boolean;
  isAddingFolder: boolean;
  addFolderParentPath: string | null;
  newlyCreatedFolderPath: string | null;
  isDeletingFolder: boolean;
  deletingFolderPath: string | null;
}

export const initialFolderTreeState: FolderTreeState = {
  rootFolders: [],
  folderTreeLoaded: false,
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
        sessionId: number;
        selectedCollection: string | null;
        showNestedResources: boolean;
        error: string | null;
        currentFolderPath: string;
      }>(),
      // Provided by withListScopeFeature, which composes before this feature.
      props: type<{ isTranslationsLoading: Signal<boolean> }>(),
      methods: type<{ showFolder(path: string): void }>(),
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
       * gives up for that reason and a root tree has already loaded (`folderTreeLoaded`, which also
       * covers a collection with root resources and no folders), keep it and toast: the `error`
       * state would replace the tree. Returns false (not handled) for other errors and on first load.
       */
      function keepTreeOnNotReady(error: unknown, message: string): boolean {
        if (!(error instanceof CollectionIndexNotReadyError) || !store.folderTreeLoaded()) return false;
        patchState(store, { isFolderTreeLoading: false });
        notifications.error(message);
        return true;
      }

      function scheduleNewFolderClear(folderFullPath: string, inSession: () => boolean): void {
        setTimeout(() => {
          if (inSession() && store.newlyCreatedFolderPath() === folderFullPath) {
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
          patchState(store, { expandedFolders: toggleExpandedPath(store.expandedFolders(), path) });
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

        reportCreateFolderError(error: unknown): void {
          patchState(store, {
            error: apiErrorMessage(error, transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.CREATEFOLDERFAILED)),
          });
        },

        clearFolderError(): void {
          patchState(store, { error: null });
        },

        loadRootFolders: rxMethod<void>(
          pipe(
            tap(() => patchState(store, { isFolderTreeLoading: true, error: null })),
            switchMap(() => {
              const inSession = captureSession(store);
              const collection = store.selectedCollection();
              if (!collection) {
                patchState(store, { isFolderTreeLoading: false });
                return of(null);
              }

              // The tree only: the root's resources are the List Scope's to load, with or without nesting.
              return api.getResourceTree(collection, '', false).pipe(
                withinSession(inSession),
                tap((treeData) =>
                  patchState(store, {
                    rootFolders: treeData.children,
                    folderTreeLoaded: true,
                    isFolderTreeLoading: false,
                  }),
                ),
                catchError((error: unknown) => {
                  const message = apiErrorMessage(
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
              const inSession = captureSession(store);
              const collection = store.selectedCollection();
              const includeNested = store.showNestedResources();
              if (!collection) {
                patchState(store, { isFolderTreeLoading: false });
                return of(null);
              }

              return api.getResourceTree(collection, folderPath, includeNested).pipe(
                withinSession(inSession),
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
                  });
                }),
                catchError((error: unknown) => {
                  const message = apiErrorMessage(
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

        createFolder(folderName: string, parentPath: string | null): Observable<CreateFolderResponseDto | null> {
          return defer(() => {
            const inSession = captureSession(store);
            const collection = store.selectedCollection();
            if (!collection) return of(null);

            // The caller owns feedback; only the tree write belongs to the store.
            return api.createFolder(collection, folderName, parentPath || undefined).pipe(
              tap((response) => {
                if (!inSession()) return;
                patchState(store, {
                  rootFolders: insertFolderIntoTree(store.rootFolders(), response.folder, parentPath),
                  newlyCreatedFolderPath: response.folder.fullPath,
                  error: null,
                });
                scheduleNewFolderClear(response.folder.fullPath, inSession);
              }),
            );
          });
        },
      };
    }),

    // Second methods block: folder deletion, which then shows the parent folder through the List Scope.
    withMethods((store) => {
      const api = inject(BrowserApiService);
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
              const inSession = captureSession(store);
              const collection = store.selectedCollection();
              if (!collection) {
                patchState(store, { isDeletingFolder: false, deletingFolderPath: null });
                return of(null);
              }

              return api.deleteFolder(collection, folderPath).pipe(
                withinSession(inSession),
                tap((response) => {
                  if (response.deleted) {
                    const updatedFolders = removeFolderFromTree(store.rootFolders(), folderPath);
                    const parentPath = parentFolderPath(folderPath) ?? '';

                    patchState(store, {
                      isDeletingFolder: false,
                      deletingFolderPath: null,
                      rootFolders: updatedFolders,
                      expandedFolders: prunePathsUnder(store.expandedFolders(), folderPath),
                      error: null,
                    });

                    store.showFolder(parentPath);
                  }
                }),
                catchError((error: unknown) => {
                  patchState(store, {
                    isDeletingFolder: false,
                    deletingFolderPath: null,
                    error: apiErrorMessage(error, transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.DELETEFOLDERFAILED)),
                  });
                  return of(null);
                }),
              );
            }),
          ),
        ),
      };
    }),
  );
}
