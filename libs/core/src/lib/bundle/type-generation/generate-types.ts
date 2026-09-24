import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TokenCasing } from '@simoncodes-ca/domain';
import { type BundleDefinition, hasTypeDistConfigured } from '../../../config/bundle-definition';
import { buildTypeHierarchy, serializeHierarchy } from './hierarchy-builder';
import { generateFileHeader } from './file-header';
import { bundleKeyToConstantName, validateJavaScriptIdentifier } from './key-transformer';

export interface GenerateTypesResult {
  bundleKey: string;
  typeDistFile: string | undefined;
  keysCount: number;
  fileGenerated: boolean;
  skippedReason?: 'not-configured' | 'empty-bundle';
  errorReason?: string;
}

export interface GenerateBundleTypesParams {
  readonly bundleKey: string;
  readonly definition: BundleDefinition;
  /** The bundle's keys, from the Bundle Selection (any order; the file lists them sorted). */
  readonly keys: readonly string[];
  /** Resolved casing: CLI override → bundle config → global config → default. */
  readonly tokenCasing: TokenCasing;
  /** CLI override for the constant name; wins over `definition.tokenConstantName`. */
  readonly tokenConstantName?: string;
  /** The project directory `typeDistFile` resolves against. Default: `process.cwd()`. */
  readonly cwd?: string;
}

/**
 * Writes a bundle's type file: the keys as an `as const` tree plus its type alias, at
 * `typeDistFile` (or the deprecated `typeDist`, with a warning). Selecting the keys is the caller's
 * job (see Bundle Selection). Returns `skippedReason` when no file is configured or there are no
 * keys, and `errorReason` for a path that does not end in `.ts`, a path that is a directory, or an
 * invalid constant name.
 */
export function generateBundleTypes(params: GenerateBundleTypesParams): GenerateTypesResult {
  const { bundleKey, definition: bundleDef, tokenCasing, tokenConstantName } = params;

  // Support deprecated 'typeDist' property — read the legacy value without mutating the config object
  const legacyTypeDist = (bundleDef as unknown as Record<string, unknown>)['typeDist'];
  const resolvedTypeDistFile =
    bundleDef.typeDistFile ?? (typeof legacyTypeDist === 'string' ? legacyTypeDist : undefined);

  if (typeof legacyTypeDist === 'string' && !bundleDef.typeDistFile) {
    console.warn(
      `Warning: Bundle '${bundleKey}': 'typeDist' is deprecated and will be removed in the next major version. Please rename to 'typeDistFile' in your .lingo-tracker.json config.`,
    );
  }

  if (!hasTypeDistConfigured(bundleDef) || !resolvedTypeDistFile) {
    return {
      bundleKey,
      typeDistFile: undefined,
      keysCount: 0,
      fileGenerated: false,
      skippedReason: 'not-configured',
    };
  }

  // Validate: typeDistFile must end with .ts (checked before resolving to an absolute path
  // so the error message reflects the value as configured, not the resolved path)
  if (!resolvedTypeDistFile.endsWith('.ts')) {
    return {
      bundleKey,
      typeDistFile: resolvedTypeDistFile,
      keysCount: 0,
      fileGenerated: false,
      errorReason: `typeDistFile must end with a .ts extension (e.g. './src/types/tokens.ts'), but got: ${resolvedTypeDistFile}`,
    };
  }

  // resolvedTypeDistFile is narrowed to string by the guard above
  const outputPath = path.resolve(params.cwd ?? process.cwd(), resolvedTypeDistFile);

  // Validate: typeDistFile must not point to an existing directory
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory()) {
    return {
      bundleKey,
      typeDistFile: resolvedTypeDistFile,
      keysCount: 0,
      fileGenerated: false,
      errorReason: `typeDistFile must be a file path (e.g. './src/types/tokens.ts'), but '${resolvedTypeDistFile}' resolves to a directory at: ${outputPath}`,
    };
  }

  const sortedKeys = [...params.keys].sort();

  if (sortedKeys.length === 0) {
    return {
      bundleKey,
      typeDistFile: resolvedTypeDistFile,
      keysCount: 0,
      fileGenerated: false,
      skippedReason: 'empty-bundle',
    };
  }

  // Resolve constant name: explicit override (from CLI or bundle config) → derive from bundle key
  const nameOverride = tokenConstantName ?? bundleDef.tokenConstantName;
  if (nameOverride) {
    const validationError = validateJavaScriptIdentifier(nameOverride);
    if (validationError) {
      return {
        bundleKey,
        typeDistFile: resolvedTypeDistFile,
        keysCount: 0,
        fileGenerated: false,
        errorReason: `Invalid tokenConstantName for bundle '${bundleKey}': ${validationError}`,
      };
    }
  }
  const resolvedConstantName = nameOverride ?? bundleKeyToConstantName(bundleKey);

  // Generate content
  const hierarchy = buildTypeHierarchy(sortedKeys, tokenCasing);
  const fileContent = `${generateFileHeader(bundleKey)}\n\n${serializeHierarchy(hierarchy, resolvedConstantName)}`;

  const outputDir = path.dirname(outputPath);

  // Ensure directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write file
  fs.writeFileSync(outputPath, fileContent, 'utf-8');

  return {
    bundleKey,
    typeDistFile: outputPath,
    keysCount: sortedKeys.length,
    fileGenerated: true,
  };
}
