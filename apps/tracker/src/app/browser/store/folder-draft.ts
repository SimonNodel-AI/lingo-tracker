import { computed, signal } from '@angular/core';
import type { FolderNodeDto } from '@simoncodes-ca/data-transfer';
import { defer, finalize, type Observable, tap } from 'rxjs';
import type { Feedback } from '../feedback';
import type { CreateFolderOutcome } from './folder-write-feedback';

/** Sidebar and picker have independent presentation drafts, owned by Folder Draft Session. */
export interface FolderDraft {
  isAddingFolder: boolean;
  addFolderParentPath: string | null;
  /** A start or cancel replaces the draft, invalidating pending confirmations. */
  folderDraftId: number;
  /** Only inline refusal feedback belongs under the draft's input. */
  folderCreateError: Feedback | null;
}

export const initialFolderDraft: FolderDraft = {
  isAddingFolder: false,
  addFolderParentPath: null,
  folderDraftId: 0,
  folderCreateError: null,
};

/** The surface supplies storage and tree effects; the session owns the create lifecycle. */
export interface FolderDraftAdapter {
  state?: {
    read(): FolderDraft;
    write(draft: FolderDraft): void;
  };
  create(name: string, parentPath: string | null): Observable<CreateFolderOutcome>;
  canStart?(): boolean;
  /** The sidebar is reset by Browser Session; a local picker must retire a stale draft itself. */
  staleDraft: 'collection-reset' | 'cancel';
  revealParent?(path: string): void;
  created?(folder: FolderNodeDto): void;
}

export class FolderDraftSession {
  readonly #pending = signal(0);
  readonly isCreating = computed(() => this.#pending() > 0);
  readonly #local = signal(initialFolderDraft);
  readonly state = computed(() => this.adapter.state?.read() ?? this.#local());
  #revision = 0;

  constructor(private readonly adapter: FolderDraftAdapter) {}

  start(parentPath: string | null): void {
    if (this.adapter.canStart && !this.adapter.canStart()) return;
    this.#write({
      isAddingFolder: true,
      addFolderParentPath: parentPath,
      folderDraftId: ++this.#revision,
      folderCreateError: null,
    });
    if (parentPath !== null) this.adapter.revealParent?.(parentPath);
  }

  cancel(): void {
    this.#write({ ...initialFolderDraft, folderDraftId: ++this.#revision });
  }

  /** Retires pending confirmations while restoring the store's initial collection state. */
  reset(): void {
    ++this.#revision;
    this.#write(initialFolderDraft);
  }

  edit(): void {
    this.#write({ ...this.state(), folderCreateError: null });
  }

  /** Cold, like Folder Writes. A missing parent means the collection root. */
  confirm(name: string, parentPath?: string | null): Observable<CreateFolderOutcome> {
    return defer(() => {
      const draft = this.state();
      const revision = this.#revision;
      const parent = parentPath === undefined ? draft.addFolderParentPath : parentPath;
      this.#pending.update((count) => count + 1);
      let pending = true;
      const release = (): void => {
        if (!pending) return;
        pending = false;
        this.#pending.update((count) => count - 1);
      };
      return defer(() => this.adapter.create(name, parent || null)).pipe(
        tap((outcome) => {
          release();
          this.#settle(revision, outcome);
          if (outcome.kind === 'created') {
            this.adapter.created?.(outcome.folder);
            if (parent) this.adapter.revealParent?.(parent);
          }
        }),
        finalize(release),
      );
    });
  }

  #write(draft: FolderDraft): void {
    if (this.adapter.state) this.adapter.state.write(draft);
    else this.#local.set(draft);
  }

  #settle(revision: number, outcome: CreateFolderOutcome): void {
    const draft = this.state();
    if (this.#revision !== revision) return;
    if (outcome.kind === 'stale-session') {
      if (this.adapter.staleDraft === 'cancel') this.cancel();
      return;
    }
    if (outcome.kind === 'refused') {
      this.#write({
        ...draft,
        folderCreateError: outcome.feedback?.placement === 'inline' ? outcome.feedback : null,
      });
      return;
    }
    this.#write({ ...initialFolderDraft, folderDraftId: draft.folderDraftId });
  }
}
