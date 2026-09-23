/**
 * Extracts the folder name from a full folder path.
 * For example: "apps.common.buttons" -> "buttons"
 */
export function extractFolderNameFromPath(folderPath: string): string {
  const parts = folderPath.split('.');
  return parts[parts.length - 1];
}

/**
 * Extracts the parent folder path from a full folder path.
 * For example: "apps.common.buttons" -> "apps.common"
 */
export function extractParentFolderPath(folderPath: string): string {
  const parts = folderPath.split('.');
  return parts.length > 1 ? parts.slice(0, -1).join('.') : '';
}
