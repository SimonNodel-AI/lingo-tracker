/** Sidebar and picker have independent presentation drafts, with one transition rule. */
export interface FolderDraft {
  isAddingFolder: boolean;
  addFolderParentPath: string | null;
}

export function startFolderDraft(parentPath: string | null): FolderDraft {
  return { isAddingFolder: true, addFolderParentPath: parentPath };
}

export function cancelFolderDraft(): FolderDraft {
  return { isAddingFolder: false, addFolderParentPath: null };
}
