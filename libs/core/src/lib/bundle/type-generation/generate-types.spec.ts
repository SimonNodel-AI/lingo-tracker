import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BundleDefinition } from '@simoncodes-ca/domain';
import { useTempDir } from '../../../testing/temp-dir.spec-helpers';
import { generateBundleTypes } from './generate-types';

describe('generateBundleTypes (real fs)', () => {
  const root = useTempDir('bundle-types-');

  afterEach(() => vi.restoreAllMocks());

  function definition(overrides: Partial<BundleDefinition> = {}): BundleDefinition {
    return {
      bundleName: 'main',
      dist: 'dist/i18n',
      collections: 'All',
      typeDistFile: 'src/generated/main-tokens.ts',
      ...overrides,
    };
  }

  function generate(
    overrides: Partial<Parameters<typeof generateBundleTypes>[0]> = {},
  ): ReturnType<typeof generateBundleTypes> {
    return generateBundleTypes({
      bundleKey: 'main',
      definition: definition(),
      keys: ['buttons.ok'],
      tokenCasing: 'upperCase',
      cwd: root(),
      ...overrides,
    });
  }

  it('skips generation when typeDistFile is not configured', () => {
    const result = generate({ definition: definition({ typeDistFile: undefined }) });

    expect(result).toMatchObject({
      fileGenerated: false,
      keysCount: 0,
      skippedReason: 'not-configured',
      typeDistFile: undefined,
    });
    expect(existsSync(join(root(), 'src/generated/main-tokens.ts'))).toBe(false);
  });

  it('generates a type file with its header, constant, sorted keys, and type alias', () => {
    const result = generate({ keys: ['buttons.ok', 'buttons.cancel'] });
    const output = readFileSync(join(root(), 'src/generated/main-tokens.ts'), 'utf8');

    expect(result).toMatchObject({ fileGenerated: true, keysCount: 2 });
    expect(output).toContain('Auto-generated translation keys for bundle: main');
    expect(output).toContain('export const MAIN_TOKENS');
    expect(output).toContain("CANCEL: 'buttons.cancel'");
    expect(output).toContain("OK: 'buttons.ok'");
    expect(output).toContain('export type MainTokens = typeof MAIN_TOKENS');
  });

  it('sorts keys supplied in an arbitrary order', () => {
    generate({ keys: ['z.last', 'a.first', 'm.middle'] });
    const output = readFileSync(join(root(), 'src/generated/main-tokens.ts'), 'utf8');

    expect(output.indexOf('A: {')).toBeLessThan(output.indexOf('M: {'));
    expect(output.indexOf('M: {')).toBeLessThan(output.indexOf('Z: {'));
  });

  it('skips an empty bundle without writing a file or logging', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = generate({ keys: [] });

    expect(result.skippedReason).toBe('empty-bundle');
    expect(result.fileGenerated).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(existsSync(join(root(), 'src/generated/main-tokens.ts'))).toBe(false);
  });

  it('creates the output directory when it does not exist', () => {
    const result = generate({ definition: definition({ typeDistFile: 'new/deep/tokens.ts' }) });

    expect(result.fileGenerated).toBe(true);
    expect(existsSync(join(root(), 'new/deep/tokens.ts'))).toBe(true);
  });

  it('generates camelCase property names', () => {
    generate({ keys: ['file-upload'], tokenCasing: 'camelCase' });
    const output = readFileSync(join(root(), 'src/generated/main-tokens.ts'), 'utf8');

    expect(output).toContain("fileUpload: 'file-upload'");
    expect(output).not.toContain('FILE_UPLOAD');
  });

  it('preserves non-hyphenated mixed-case keys in camelCase mode', () => {
    generate({ keys: ['agGrid'], tokenCasing: 'camelCase' });
    const output = readFileSync(join(root(), 'src/generated/main-tokens.ts'), 'utf8');

    expect(output).toContain("agGrid: 'agGrid'");
    expect(output).not.toContain('aggrid');
    expect(output).not.toContain('AGGRID');
  });

  it('returns an error when typeDistFile points to an existing directory', () => {
    mkdirSync(join(root(), 'types.ts'));
    const result = generate({ definition: definition({ typeDistFile: 'types.ts' }) });

    expect(result.fileGenerated).toBe(false);
    expect(result.errorReason).toMatch(/typeDistFile must be a file path/);
    expect(result.errorReason).toContain(join(root(), 'types.ts'));
  });

  it('returns an error containing the configured value when typeDistFile is not a .ts file', () => {
    const result = generate({ definition: definition({ typeDistFile: 'src/generated/tokens.js' }) });

    expect(result.fileGenerated).toBe(false);
    expect(result.errorReason).toMatch(/typeDistFile must end with a \.ts extension/);
    expect(result.errorReason).toContain('src/generated/tokens.js');
    expect(existsSync(join(root(), 'src/generated/tokens.js'))).toBe(false);
  });

  it('resolves relative typeDistFile against cwd and returns its absolute path', () => {
    const result = generate({ definition: definition({ typeDistFile: 'types/tokens.ts' }) });

    expect(result.typeDistFile).toBe(join(root(), 'types/tokens.ts'));
    expect(existsSync(join(root(), 'types/tokens.ts'))).toBe(true);
  });

  it('uses the tokenConstantName parameter', () => {
    generate({ tokenConstantName: 'MY_CUSTOM_TOKENS' });
    expect(readFileSync(join(root(), 'src/generated/main-tokens.ts'), 'utf8')).toContain(
      'export const MY_CUSTOM_TOKENS',
    );
  });

  it('derives a PascalCase type name from a SCREAMING_SNAKE constant name', () => {
    generate({ tokenConstantName: 'MY_CUSTOM_TOKENS' });
    expect(readFileSync(join(root(), 'src/generated/main-tokens.ts'), 'utf8')).toContain(
      'export type MyCustomTokens = typeof MY_CUSTOM_TOKENS',
    );
  });

  it('derives a PascalCase type name from a camelCase constant name', () => {
    generate({ tokenConstantName: 'myCustomTokens' });
    const output = readFileSync(join(root(), 'src/generated/main-tokens.ts'), 'utf8');

    expect(output).toContain('export const myCustomTokens');
    expect(output).toContain('export type MyCustomTokens = typeof myCustomTokens');
  });

  it('uses tokenConstantName from the definition when no parameter is provided', () => {
    generate({ definition: definition({ tokenConstantName: 'APP_TOKENS' }) });
    const output = readFileSync(join(root(), 'src/generated/main-tokens.ts'), 'utf8');

    expect(output).toContain('export const APP_TOKENS');
    expect(output).toContain('export type AppTokens = typeof APP_TOKENS');
  });

  it('prefers the tokenConstantName parameter over the definition', () => {
    generate({
      definition: definition({ tokenConstantName: 'CONFIG_TOKENS' }),
      tokenConstantName: 'CLI_OVERRIDE_TOKENS',
    });
    expect(readFileSync(join(root(), 'src/generated/main-tokens.ts'), 'utf8')).toContain(
      'export const CLI_OVERRIDE_TOKENS',
    );
  });

  it('returns an error for an invalid tokenConstantName parameter', () => {
    const result = generate({ tokenConstantName: 'my-bad-name' });

    expect(result.fileGenerated).toBe(false);
    expect(result.errorReason).toMatch(/Invalid tokenConstantName/);
    expect(existsSync(join(root(), 'src/generated/main-tokens.ts'))).toBe(false);
  });

  it('returns an error for an invalid tokenConstantName in the definition', () => {
    const result = generate({ definition: definition({ tokenConstantName: '1bad' }) });

    expect(result.fileGenerated).toBe(false);
    expect(result.errorReason).toMatch(/Invalid tokenConstantName/);
    expect(existsSync(join(root(), 'src/generated/main-tokens.ts'))).toBe(false);
  });

  it('treats a non-string legacy typeDist value as not configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const legacy = { ...definition({ typeDistFile: undefined }), typeDist: null } as unknown as BundleDefinition;
    const result = generate({ definition: legacy });

    expect(result.skippedReason).toBe('not-configured');
    expect(result.fileGenerated).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses typeDistFile without warning when both current and legacy keys are present', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const withBoth = {
      ...definition({ typeDistFile: 'types/current.ts' }),
      typeDist: 'types/legacy.ts',
    } as unknown as BundleDefinition;
    const result = generate({ definition: withBoth });

    expect(result.typeDistFile).toBe(join(root(), 'types/current.ts'));
    expect(existsSync(join(root(), 'types/current.ts'))).toBe(true);
    expect(existsSync(join(root(), 'types/legacy.ts'))).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('supports deprecated typeDist and emits a deprecation warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const legacy = {
      ...definition({ typeDistFile: undefined }),
      typeDist: 'types/legacy.ts',
    } as unknown as BundleDefinition;
    const result = generate({ definition: legacy });

    expect(result.fileGenerated).toBe(true);
    expect(existsSync(join(root(), 'types/legacy.ts'))).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Bundle 'main'"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("'typeDist' is deprecated"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("'typeDistFile'"));
  });
});
