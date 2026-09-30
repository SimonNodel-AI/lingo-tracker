import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
  inject,
  type OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import type { FolderNodeDto } from '@simoncodes-ca/data-transfer';
import { PickerFolderNode } from './picker-folder-node/picker-folder-node';
import { BrowserStore } from '../../../store/browser.store';
import { NotificationService } from '../../../../shared/notification';
import { TranslocoService } from '@jsverse/transloco';
import { TRACKER_TOKENS } from '../../../../../i18n-types/tracker-resources';
import { apiErrorMessage } from '../../../../shared/api-error/api-error';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  collectAncestorPaths,
  collectVisibleFolderPaths,
  parentFolderPath,
  toggleExpandedPath,
} from '../../../store/folder-tree.utils';
import { startFolderDraft, cancelFolderDraft, type FolderDraft } from '../../../store/folder-draft';

/**
 * Folder picker component for the Translation Editor Dialog.
 *
 * Features:
 * - Display current folder path
 * - Expand/collapse tree-based folder selector
 * - Allow folder selection from tree with keyboard navigation
 * - Support inline folder creation
 * - Auto-select newly created folders
 * - Auto-confirm selection when clicking or pressing Enter/Space on a folder
 */
@Component({
  selector: 'app-folder-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatButtonModule, PickerFolderNode, TranslocoPipe],
  templateUrl: './folder-picker.html',
  styleUrl: './folder-picker.scss',
})
export class FolderPicker implements OnInit {
  readonly #store = inject(BrowserStore);
  readonly #notifications = inject(NotificationService);
  readonly #transloco = inject(TranslocoService);
  readonly TOKENS = TRACKER_TOKENS;

  /** Current folder path (persisted selection) */
  readonly currentPath = input.required<string>();

  /** Root folders from the folder tree */
  readonly rootFolders = input.required<FolderNodeDto[]>();

  /** Emitted when a folder selection is confirmed */
  readonly folderConfirmed = output<string>();

  /** Emitted when a new folder is created */
  readonly folderCreated = output<FolderNodeDto>();

  /** When true, the folder tree is shown immediately and the currentPath ancestors are expanded */
  readonly initiallyExpanded = input(false);

  /**
   * Hides the picker's own "Folder: path" row. Inside the editor's location
   * popover the pill that opened the popover already states the path, so a
   * second copy of it above the tree is noise.
   */
  readonly hideHeader = input(false);

  readonly isExpanded = signal(false);
  readonly expandedPaths = signal<Set<string>>(new Set());
  readonly selectedPath = signal<string | null>(null);
  readonly focusedPath = signal<string | null>(null);
  readonly isAddingFolder = signal(false);
  readonly addFolderParentPath = signal<string | null>(null);
  readonly isCreatingFolder = signal(false);

  readonly displayPath = computed(() => {
    const rootLabel = this.#transloco.translate(TRACKER_TOKENS.BROWSER.FOLDERPICKER.ROOTLABEL) || 'root';
    const stagedPath = this.selectedPath();
    if (stagedPath !== null) {
      return stagedPath || rootLabel;
    }
    const current = this.currentPath();
    return current || rootLabel;
  });

  readonly chevronIcon = computed(() => {
    return this.isExpanded() ? 'expand_less' : 'expand_more';
  });

  readonly hasRootFolders = computed(() => {
    return this.rootFolders().length > 0;
  });

  ngOnInit(): void {
    if (this.initiallyExpanded()) {
      this.isExpanded.set(true);
      const currentPath = this.currentPath();
      if (currentPath) {
        this.selectedPath.set(currentPath);
        // Note: we intentionally don't emit folderConfirmed here because the
        // parent dialog already has the correct path from its data.
        // Expand all ancestor segments so the current path is visible
        this.expandedPaths.set(new Set([...collectAncestorPaths(currentPath), currentPath]));
      }
    }
  }

  toggleExpanded(): void {
    if (this.initiallyExpanded()) {
      return;
    }
    this.isExpanded.update((expanded) => !expanded);
    if (!this.isExpanded()) {
      this.selectedPath.set(null);
      this.focusedPath.set(null);
    }
  }

  onFolderSelect(folderPath: string): void {
    this.selectedPath.set(folderPath);
    this.folderConfirmed.emit(folderPath);
    if (!this.initiallyExpanded()) {
      this.isExpanded.set(false);
    }
    this.focusedPath.set(null);
  }

  private setDraft(draft: FolderDraft): void {
    this.isAddingFolder.set(draft.isAddingFolder);
    this.addFolderParentPath.set(draft.addFolderParentPath);
  }

  onCreateFirstFolder(): void {
    this.setDraft(startFolderDraft(''));
  }

  onAddFolder(parentPath: string): void {
    this.setDraft(startFolderDraft(parentPath));
    // Auto-expand the parent folder to show the inline input
    this.expandedPaths.update((expanded) => new Set(expanded).add(parentPath));
  }

  onFolderNameConfirmed(folderName: string): void {
    const parentPath = this.addFolderParentPath();
    if (parentPath === null) {
      return;
    }

    this.isCreatingFolder.set(true);

    this.#store.createFolder(folderName, parentPath || null).subscribe((outcome) => {
      this.isCreatingFolder.set(false);
      this.setDraft(cancelFolderDraft());
      if (outcome.kind === 'created') {
        this.folderCreated.emit(outcome.folder);
        this.selectedPath.set(outcome.folder.fullPath);
        if (parentPath) this.expandedPaths.update((expanded) => new Set(expanded).add(parentPath));
        if (outcome.created) {
          this.#notifications.success(this.#transloco.translate(TRACKER_TOKENS.BROWSER.FOLDERPICKER.FOLDERCREATED));
        } else {
          this.#notifications.info(this.#transloco.translate(TRACKER_TOKENS.BROWSER.FOLDERPICKER.FOLDERALREADYEXISTS));
        }
      } else if (outcome.kind === 'refused') {
        this.#notifications.error(
          apiErrorMessage(
            outcome.error,
            this.#transloco.translate(TRACKER_TOKENS.BROWSER.FOLDERPICKER.CREATEFOLDERFAILED),
          ),
        );
      }
    });
  }

  onFolderNameCancelled(): void {
    this.setDraft(cancelFolderDraft());
  }

  onExpandToggle(folderPath: string): void {
    this.expandedPaths.update((expanded) => toggleExpandedPath(expanded, folderPath));
  }

  onTreeKeydown(event: KeyboardEvent): void {
    const visiblePaths = collectVisibleFolderPaths(this.rootFolders(), this.expandedPaths());
    if (visiblePaths.length === 0) {
      return;
    }

    const currentFocus = this.focusedPath();
    const currentIndex = currentFocus !== null ? visiblePaths.indexOf(currentFocus) : -1;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (currentIndex < visiblePaths.length - 1) {
          this.focusedPath.set(visiblePaths[currentIndex + 1]);
        } else if (currentIndex === -1) {
          this.focusedPath.set(visiblePaths[0]);
        }
        break;

      case 'ArrowUp':
        event.preventDefault();
        if (currentIndex > 0) {
          this.focusedPath.set(visiblePaths[currentIndex - 1]);
        }
        break;

      case 'ArrowRight':
        event.preventDefault();
        if (currentFocus !== null) {
          this.expandedPaths.update((expanded) => {
            const newSet = new Set(expanded);
            newSet.add(currentFocus);
            return newSet;
          });
        }
        break;

      case 'ArrowLeft':
        event.preventDefault();
        if (currentFocus !== null) {
          const expanded = this.expandedPaths();
          if (expanded.has(currentFocus)) {
            this.expandedPaths.update((exp) => {
              const newSet = new Set(exp);
              newSet.delete(currentFocus);
              return newSet;
            });
          } else {
            const parentPath = parentFolderPath(currentFocus);
            if (parentPath !== null) {
              this.focusedPath.set(parentPath);
            }
          }
        }
        break;

      case 'Enter':
      case ' ':
        event.preventDefault();
        if (currentFocus !== null) {
          this.onFolderSelect(currentFocus);
        }
        break;
    }
  }
}
