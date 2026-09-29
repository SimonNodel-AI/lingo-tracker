/**
 * Extracts the folder name from a full folder path.
 * For example: "apps.common.buttons" -> "buttons"
 */
export function extractFolderNameFromPath(folderPath: string): string {
  const parts = folderPath.split('.');
  return parts[parts.length - 1];
}
