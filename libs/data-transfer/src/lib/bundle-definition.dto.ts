/**
 * Bundle definition DTOs. Mirror the core `BundleDefinition` shapes without importing from core,
 * so they are safe to use from the browser-based Tracker UI.
 */

/**
 * Casing of generated TypeScript token property keys.
 * - 'upperCase': SCREAMING_SNAKE_CASE (e.g. FILE_UPLOAD) — default
 * - 'camelCase': camelCase (e.g. fileUpload)
 */
export type TokenCasingDto = 'upperCase' | 'camelCase';

/** Pattern and tag-based rule selecting which entries of a collection are bundled. */
export interface EntrySelectionRuleDto {
  /**
   * Prefix-based key pattern, e.g. "*", "apps.*", "apps.common.*" or an exact key.
   */
  matchingPattern: string;

  /** Optional tags to filter by. "*" matches any tagged entry. */
  matchingTags?: string[];

  /** How multiple tags combine. Ignored when `matchingTags` is omitted. Default: "Any". */
  matchingTagOperator?: 'All' | 'Any';
}

/** How a single collection contributes to a bundle. */
export interface CollectionBundleDefinitionDto {
  /** Name of an existing collection. */
  name: string;

  /** Optional prefix prepended to every key from this collection. */
  bundledKeyPrefix?: string;

  /** "All" to include every entry, or a list of selection rules. */
  entriesSelectionRules: 'All' | EntrySelectionRuleDto[];

  /**
   * Conflict resolution when several collections define the same key.
   * - "merge": first collection wins (default)
   * - "override": this collection overrides earlier values
   */
  mergeStrategy?: 'merge' | 'override';
}

/** Definition of one bundle output, keyed by bundle name in the project config. */
export interface BundleDefinitionDto {
  /**
   * Output file name pattern. Use the `{locale}` placeholder to position the locale,
   * e.g. "main.{locale}" → main.en.json.
   */
  bundleName: string;

  /** Output directory, absolute or relative to the project root. */
  dist: string;

  /** "All" for every entry of every collection, or per-collection definitions. */
  collections: 'All' | CollectionBundleDefinitionDto[];

  /** Optional `.ts` file path for generated token type definitions. */
  typeDistFile?: string;

  /** Casing for generated token property keys. Overrides the global setting. */
  tokenCasing?: TokenCasingDto;

  /**
   * Custom TypeScript constant name in the type file (e.g. `MY_KEYS`).
   * Derived from the bundle key when omitted (e.g. `main` → `MAIN_TOKENS`).
   */
  tokenConstantName?: string;

  /** Convert simple ICU placeholders to Transloco `{{ name }}` syntax. Overrides the global setting. */
  transformICUToTransloco?: boolean;
}
