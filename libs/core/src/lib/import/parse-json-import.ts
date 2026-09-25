import { existsSync, readFileSync } from 'node:fs';
import type { TranslationStatus } from '@simoncodes-ca/domain';
import type { ImportedResource, ImportParseOptions } from './types';

/**
 * Detects whether the JSON structure is flat or hierarchical.
 *
 * A flat structure uses dot-delimited keys at the root level (e.g., `{"common.ok": "OK"}`).
 * A hierarchical structure uses nested objects (e.g., `{common: {ok: "OK"}}`).
 *
 * Detection logic: If all root-level keys contain dots, the structure is considered flat.
 * Otherwise, it's hierarchical.
 *
 * @param data - The parsed JSON object to analyze
 * @returns 'flat' if all root keys contain dots, 'hierarchical' otherwise
 *
 * @example
 * ```typescript
 * // Flat structure
 * detectJsonStructure({"common.ok": "OK", "common.cancel": "Cancel"}); // 'flat'
 *
 * // Hierarchical structure
 * detectJsonStructure({common: {ok: "OK", cancel: "Cancel"}}); // 'hierarchical'
 *
 * // Mixed (treated as hierarchical)
 * detectJsonStructure({common: {ok: "OK"}, "other.key": "Value"}); // 'hierarchical'
 * ```
 */
export function detectJsonStructure(data: Record<string, unknown>): 'flat' | 'hierarchical' {
  const keys = Object.keys(data);

  // If all keys at root level contain dots, it's flat
  const allKeysHaveDots = keys.every((key) => key.includes('.'));

  if (allKeysHaveDots && keys.length > 0) {
    return 'flat';
  }

  return 'hierarchical';
}

/**
 * Checks if a value is a rich format object (has a 'value' property)
 */
function isRichObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'value' in value &&
    typeof (value as Record<string, unknown>)['value'] === 'string'
  );
}

/**
 * Extracts resource from a rich format object
 */
function extractRichResource(key: string, obj: Record<string, unknown>): ImportedResource {
  const resource: ImportedResource = {
    key,
    value: obj['value'] as string,
  };

  if (obj['comment'] && typeof obj['comment'] === 'string') {
    resource.comment = obj['comment'];
  }

  if (obj['baseValue'] && typeof obj['baseValue'] === 'string') {
    resource.baseValue = obj['baseValue'];
  }

  if (obj['status'] && typeof obj['status'] === 'string') {
    resource.status = obj['status'] as TranslationStatus;
  }

  if (Array.isArray(obj['tags'])) {
    resource.tags = obj['tags'].filter((tag) => typeof tag === 'string') as string[];
  }

  return resource;
}

/**
 * Extracts translation resources from a flat JSON structure.
 *
 * Flat structures use dot-delimited keys at the root level. Each key maps to either:
 * - A simple string value (e.g., `"common.ok": "OK"`)
 * - A rich object with additional metadata (e.g., `"common.ok": {value: "OK", comment: "Button text"}`)
 *
 * Rich format objects must have a `value` property and can optionally include:
 * - `comment` - Developer notes or context
 * - `baseValue` - Source locale reference value
 * - `status` - Translation status (new, translated, verified, stale)
 * - `tags` - Array of categorization tags
 *
 * Non-string and non-rich-object values are silently skipped.
 *
 * @param data - The flat JSON object to extract resources from
 * @returns Array of imported resources with keys and values
 *
 * @example
 * ```typescript
 * // Simple flat format
 * const simple = {
 *   "common.ok": "OK",
 *   "common.cancel": "Cancel"
 * };
 * extractFromFlat(simple);
 * // Returns: [{key: "common.ok", value: "OK"}, {key: "common.cancel", value: "Cancel"}]
 *
 * // Rich format with metadata
 * const rich = {
 *   "common.submit": {
 *     value: "Submit",
 *     comment: "Form submission button",
 *     baseValue: "Submit",
 *     status: "translated",
 *     tags: ["forms", "buttons"]
 *   }
 * };
 * extractFromFlat(rich);
 * // Returns: [{key: "common.submit", value: "Submit", comment: "Form...", ...}]
 * ```
 */
export function extractFromFlat(data: Record<string, unknown>): ImportedResource[] {
  const resources: ImportedResource[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      // Simple string value
      resources.push({
        key,
        value,
      });
    } else if (isRichObject(value)) {
      // Rich format object
      resources.push(extractRichResource(key, value));
    }
    // Skip other types
  }

  return resources;
}

/**
 * Recursively extracts translation resources from a hierarchical JSON structure.
 *
 * Hierarchical structures use nested objects to organize translations by namespace.
 * The function traverses the object tree and constructs dot-delimited keys from the path.
 *
 * Leaf nodes can be either:
 * - Simple string values (e.g., `{common: {ok: "OK"}}` → key: "common.ok")
 * - Rich objects with metadata (e.g., `{common: {ok: {value: "OK", comment: "..."}}}`)
 *
 * Non-leaf objects are recursed into. Arrays, null values, and other types are skipped.
 *
 * @param data - The hierarchical JSON object to extract resources from
 * @param prefix - Internal parameter for recursion; the current key path (default: '')
 * @returns Array of imported resources with fully-qualified dot-delimited keys
 *
 * @example
 * ```typescript
 * // Simple hierarchical format
 * const simple = {
 *   common: {
 *     buttons: {
 *       ok: "OK",
 *       cancel: "Cancel"
 *     }
 *   }
 * };
 * extractFromHierarchical(simple);
 * // Returns: [
 * //   {key: "common.buttons.ok", value: "OK"},
 * //   {key: "common.buttons.cancel", value: "Cancel"}
 * // ]
 *
 * // Mixed with rich format
 * const mixed = {
 *   common: {
 *     ok: "OK",
 *     submit: {
 *       value: "Submit",
 *       comment: "Form submission",
 *       tags: ["forms"]
 *     }
 *   }
 * };
 * extractFromHierarchical(mixed);
 * // Returns: [
 * //   {key: "common.ok", value: "OK"},
 * //   {key: "common.submit", value: "Submit", comment: "Form submission", tags: ["forms"]}
 * // ]
 * ```
 */
export function extractFromHierarchical(data: Record<string, unknown>, prefix = ''): ImportedResource[] {
  const resources: ImportedResource[] = [];

  for (const [key, value] of Object.entries(data)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'string') {
      // Simple string value - leaf node
      resources.push({
        key: fullKey,
        value,
      });
    } else if (isRichObject(value)) {
      // Rich format object - leaf node
      resources.push(extractRichResource(fullKey, value));
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Nested object - recurse
      resources.push(...extractFromHierarchical(value as Record<string, unknown>, fullKey));
    }
    // Skip other types (arrays, null, etc.)
  }

  return resources;
}

/**
 * Reads a JSON import file and returns its resources: the JSON format adapter for {@link importResources}.
 *
 * Accepts a flat (`{"common.ok": "OK"}`) or hierarchical (`{common: {ok: "OK"}}`) structure,
 * detected with {@link detectJsonStructure}. A leaf is a string or a rich object with `value`
 * and optional `baseValue`, `comment`, `status`, and `tags`.
 *
 * @param filePath - Path of the JSON file (relative paths resolve against the working directory)
 * @throws {Error} The file does not exist, or it is not valid JSON.
 */
export function parseJsonImport(filePath: string, options: ImportParseOptions = {}): ImportedResource[] {
  const { onProgress } = options;
  if (!existsSync(filePath)) {
    throw new Error(`Source file not found: ${filePath}`);
  }

  onProgress?.(`Reading JSON file: ${filePath}`);

  let jsonData: Record<string, unknown>;
  try {
    jsonData = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse JSON file: ${error}`);
  }

  const structure = detectJsonStructure(jsonData);
  onProgress?.(`Detected ${structure} JSON structure`);

  const resources = structure === 'flat' ? extractFromFlat(jsonData) : extractFromHierarchical(jsonData);
  onProgress?.(`Extracted ${resources.length} resources from JSON`);
  return resources;
}
