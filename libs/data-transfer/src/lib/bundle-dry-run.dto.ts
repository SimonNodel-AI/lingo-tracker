import type { BundleDefinitionDto } from './bundle-definition.dto';

/** Plans a bundle without writing files. The definition need not be saved in the config. */
export interface BundleDryRunRequestDto {
  /** Bundle key used to derive default names (e.g. the token constant). */
  readonly name: string;

  /** Definition to plan against. */
  readonly bundle: BundleDefinitionDto;

  /** Locales to plan. Defaults to every configured locale. */
  readonly locales?: readonly string[];
}

/** One file the bundle would write. */
export interface BundleDryRunFileDto {
  /** Output path relative to the project root. */
  readonly path: string;

  /** Whether this is a translation bundle or the TypeScript types file. */
  readonly kind: 'bundle' | 'types';

  /** Locale of a `bundle` file. Absent for `types`. */
  readonly locale?: string;

  /** Whether the file already exists on disk. */
  readonly exists: boolean;

  /** Number of keys the file would contain. */
  readonly keysCount: number;
}

/** Illustrates how one source key is transformed by the bundle. */
export interface BundleDryRunExampleKeyDto {
  readonly collectionName: string;

  /** Key as stored in the collection. */
  readonly sourceKey: string;

  /** Key as written to the bundle (after prefixing). */
  readonly bundledKey: string;

  /** Property path in the generated token constant, when types are enabled. */
  readonly tokenPath?: string;
}

export interface BundleDryRunResultDto {
  readonly name: string;

  /** Locales that were planned. */
  readonly locales: readonly string[];

  readonly files: readonly BundleDryRunFileDto[];

  /** Key count per locale. */
  readonly keysPerLocale: Record<string, number>;

  /** Total number of keys defined by more than one collection. */
  readonly conflictsCount: number;

  /** Conflicting keys. May be capped by the server. */
  readonly conflictKeys: readonly string[];

  /**
   * Keys that are both a leaf and a parent in the bundled key set, e.g.
   * `buttons.ok` alongside `buttons.ok.label`. Generation fails on these,
   * so a non-empty list means the bundle cannot be built as configured.
   * May be capped by the server.
   */
  readonly hierarchicalConflicts: readonly string[];

  readonly exampleKey?: BundleDryRunExampleKeyDto;

  readonly warnings: readonly string[];
}
