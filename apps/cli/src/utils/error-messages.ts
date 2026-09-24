/**
 * Standardized error messages for consistent CLI user experience.
 *
 * Centralizes all error message definitions to ensure:
 * - Consistent wording and formatting across commands
 * - Uniform use of backticks vs quotes
 * - Consistent suggestions for resolving issues
 * - Single place to update messages
 * - Easier to maintain documentation
 *
 * @example
 * ```typescript
 * import { ErrorMessages } from './error-messages';
 *
 * console.log(ErrorMessages.CONFIG_NOT_FOUND);
 * ```
 */

export const ErrorMessages = {
  // Configuration Errors
  /**
   * Error when .lingo-tracker.json file is not found
   */
  CONFIG_NOT_FOUND: '❌ No Lingo Tracker configuration found. Run `lingo-tracker init` first.',

  /**
   * Error when configuration file has invalid format
   */
  CONFIG_INVALID: '❌ Invalid configuration file format.',

  /**
   * Error when configuration file cannot be parsed
   * @param error - Detailed error message from parser
   */
  CONFIG_PARSE_FAILED: (error: string) => `❌ Failed to parse configuration file: ${error}`,

  // Collection Errors

  /**
   * Error when no collections are available for an operation
   */
  NO_COLLECTIONS_AVAILABLE: '❌ No collections available.',

  /**
   * Error when attempting to modify resources in a read-only collection
   * @param name - Name of the read-only collection
   */
  COLLECTION_READ_ONLY: (name: string) => `❌ Collection "${name}" is read-only. Its resources cannot be modified.`,

  // Option Errors

  // Operation Errors

  /**
   * Generic error for failed operations
   * @param operation - Name of the operation that failed
   * @param reason - Optional reason for failure
   */
  OPERATION_FAILED: (operation: string, reason?: string) =>
    reason ? `❌ ${operation} failed: ${reason}` : `❌ ${operation} failed.`,

  // Resource Errors
  /**
   * Error when specified resource key is not found
   * @param key - Resource key that was not found
   */
  RESOURCE_NOT_FOUND: (key: string) => `❌ Resource key "${key}" not found.`,

  /**
   * Error when resource key already exists
   * @param key - Resource key that already exists
   */
  RESOURCE_EXISTS: (key: string) => `❌ Resource key "${key}" already exists.`,

  /**
   * Error when resource key format is invalid
   */
  INVALID_RESOURCE_KEY: '❌ Invalid resource key format.',

  // Locale Errors
  /**
   * Error when specified locale is not found in configuration
   * @param locale - Locale code that was not found
   */
  LOCALE_NOT_FOUND: (locale: string) => `❌ Locale "${locale}" not found in configuration.`,

  /**
   * Error when no locales are configured
   */
  NO_LOCALES_CONFIGURED: '❌ No locales configured.',

  // File System Errors
  /**
   * Error when a required file is not found
   * @param filePath - Path to the missing file
   */
  FILE_NOT_FOUND: (filePath: string) => `❌ File not found: ${filePath}`,

  /**
   * Error when a required directory is not found
   * @param dirPath - Path to the missing directory
   */
  DIRECTORY_NOT_FOUND: (dirPath: string) => `❌ Directory not found: ${dirPath}`,

  /**
   * Error when file read operation fails
   * @param filePath - Path to the file that couldn't be read
   * @param reason - Optional reason for failure
   */
  FILE_READ_FAILED: (filePath: string, reason?: string) =>
    reason ? `❌ Failed to read file ${filePath}: ${reason}` : `❌ Failed to read file: ${filePath}`,

  /**
   * Error when file write operation fails
   * @param filePath - Path to the file that couldn't be written
   * @param reason - Optional reason for failure
   */
  FILE_WRITE_FAILED: (filePath: string, reason?: string) =>
    reason ? `❌ Failed to write file ${filePath}: ${reason}` : `❌ Failed to write file: ${filePath}`,
} as const;
