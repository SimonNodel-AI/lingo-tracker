/**
 * Utilities for building hierarchical JSON from flat key-value pairs
 */

/**
 * Builds a hierarchical object from flat key-value pairs
 *
 * Example:
 * Input: { "apps.common.buttons.ok": "OK", "apps.common.buttons.cancel": "Cancel" }
 * Output: { apps: { common: { buttons: { ok: "OK", cancel: "Cancel" } } } }
 *
 * @param flatEntries - Map of dotted keys to values
 * @returns Hierarchical object
 */
export function buildHierarchy(flatEntries: Record<string, string>): Record<string, unknown> {
  const result = createNode();

  for (const [key, value] of Object.entries(flatEntries)) {
    setNestedValue(result, key, value);
  }

  return result;
}

/**
 * A tree node without a prototype, so a key segment such as `__proto__` or `constructor` is an
 * ordinary property. `JSON.stringify` writes it the same as a plain object.
 */
function createNode(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

/**
 * Sets a value at a nested path in an object
 *
 * @param obj - The object to modify
 * @param key - Dot-delimited path (e.g., "apps.common.buttons.ok")
 * @param value - The value to set
 */
function setNestedValue(obj: Record<string, unknown>, key: string, value: string): void {
  const segments = key.split('.');
  let current = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];

    // Create intermediate object if it doesn't exist (own properties only; lib es2020 has no Object.hasOwn)
    if (Object.getOwnPropertyDescriptor(current, segment) === undefined) {
      current[segment] = createNode();
    }

    // Navigate deeper (cast as Record for type safety)
    current = current[segment] as Record<string, unknown>;
  }

  // Set the final value
  const lastSegment = segments[segments.length - 1];
  current[lastSegment] = value;
}
