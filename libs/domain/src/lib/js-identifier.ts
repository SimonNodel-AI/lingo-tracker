/**
 * Browser-safe JavaScript identifier rules.
 *
 * Both the CLI/API (via core's `validateJavaScriptIdentifier`) and the Tracker
 * UI's bundle form validate the token constant name. Keeping the rules here
 * means the client-side check can never drift from the server-side one.
 */

/** Matches an ASCII-only JavaScript identifier. Unicode letters are not permitted. */
export const JS_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** ES2022 + TypeScript contextual keywords that cannot be used as bare identifiers in a const declaration. */
const JS_RESERVED_WORDS: ReadonlySet<string> = new Set([
  // ES2022 reserved words
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'enum',
  'await',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
  // TypeScript contextual keywords
  'abstract',
  'as',
  'asserts',
  'async',
  'declare',
  'from',
  'global',
  'infer',
  'is',
  'keyof',
  'module',
  'namespace',
  'never',
  'of',
  'out',
  'override',
  'readonly',
  'require',
  'satisfies',
  'symbol',
  'type',
  'unique',
  'unknown',
  'using',
  // Globals that should not be shadowed
  'undefined',
  'Infinity',
  'NaN',
]);

/** True when `name` is a reserved word that cannot be declared as a bare identifier. */
export function isJavaScriptReservedWord(name: string): boolean {
  return JS_RESERVED_WORDS.has(name);
}

/**
 * True when `name` is a legal, non-reserved ASCII JavaScript identifier.
 *
 * Accepts any casing: camelCase, PascalCase, SCREAMING_SNAKE_CASE, snake_case.
 * Valid: `MY_KEYS`, `myKeys`, `_internal`. Invalid: `1bad`, `my-key`, `class`.
 */
export function isValidJavaScriptIdentifier(name: string): boolean {
  return name.length > 0 && JS_IDENTIFIER_PATTERN.test(name) && !isJavaScriptReservedWord(name);
}
