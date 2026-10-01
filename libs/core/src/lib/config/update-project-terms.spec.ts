import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as fileSystem from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import {
  InvalidCollectionError,
  InvalidProjectTermsEditError,
  ParentDirectoryMissingError,
} from '../errors/lingo-tracker-error';
import { PreferredTerminologyValidationError } from './preferred-terminology-file';
import { type ProjectTermsUpdate, updateProjectTerms } from './update-project-terms';

const actualWrite = vi.hoisted(() => ({ file: undefined as typeof import('node:fs').writeFileSync | undefined }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  actualWrite.file = actual.writeFileSync;
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync) };
});

function realWriteFileSync(): typeof fileSystem.writeFileSync {
  const write = actualWrite.file;
  if (write === undefined) throw new Error('Node filesystem mock was not initialized');
  return write;
}

describe('updateProjectTerms', () => {
  let cwd: string;
  let config: LingoTrackerConfig;
  let protectedFile: string;
  let preferredFile: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'project-terms-update-'));
    protectedFile = join(cwd, 'protected.json');
    preferredFile = join(cwd, 'preferred.json');
    config = {
      baseLocale: 'en',
      locales: ['en'],
      collections: {},
      exportFolder: 'dist/export',
      importFolder: 'dist/import',
      protectedTermsFile: 'protected.json',
      preferredTerminologyFile: 'preferred.json',
    };
    writeFileSync(join(cwd, '.lingo-tracker.json'), `${JSON.stringify(config)}\n`);
    writeFileSync(protectedFile, '["Old"]\n');
    writeFileSync(preferredFile, '[{"discouraged":"Old","preferred":"New"}]\n');
  });

  afterEach(() => {
    vi.mocked(fileSystem.writeFileSync).mockImplementation(realWriteFileSync());
    rmSync(cwd, { recursive: true, force: true });
  });

  it('leaves protected terms untouched when a submitted rule is invalid', () => {
    const before = readFileSync(protectedFile, 'utf8');
    expect(() =>
      updateProjectTerms(
        config,
        {
          protectedTerms: { replace: ['Changed'] },
          preferredTerminology: { set: [{ discouraged: 'Email', preferred: 'email' }] },
        },
        { cwd },
      ),
    ).toThrow(PreferredTerminologyValidationError);
    expect(readFileSync(protectedFile, 'utf8')).toBe(before);
  });

  it('returns normalized protected terms after a replacement', () => {
    const result = updateProjectTerms(
      config,
      { protectedTerms: { replace: [' iPhone ', 'iPhone', 'Node.js'] } },
      { cwd },
    );
    expect(result.protectedTermsResult?.terms).toEqual(['iPhone', 'Node.js']);
    expect(JSON.parse(readFileSync(protectedFile, 'utf8'))).toEqual(['iPhone', 'Node.js']);
  });

  it('restores the first file when the second file write fails', () => {
    rmSync(protectedFile);
    mkdirSync(protectedFile);
    const before = readFileSync(preferredFile, 'utf8');
    expect(() =>
      updateProjectTerms(
        config,
        {
          protectedTerms: { replace: ['Changed'] },
          preferredTerminology: { set: [{ discouraged: 'Spend', preferred: 'Invest' }] },
        },
        { cwd },
      ),
    ).toThrow();
    expect(readFileSync(preferredFile, 'utf8')).toBe(before);
  });

  it('removes a newly created first file when the second file write fails', () => {
    rmSync(preferredFile);
    rmSync(protectedFile);
    mkdirSync(protectedFile);
    expect(() =>
      updateProjectTerms(
        config,
        {
          protectedTerms: { replace: ['Changed'] },
          preferredTerminology: { set: [{ discouraged: 'Spend', preferred: 'Invest' }] },
        },
        { cwd },
      ),
    ).toThrow();
    expect(existsSync(preferredFile)).toBe(false);
  });

  it('restores a first file that was partially written before its writer failed', () => {
    const before = readFileSync(preferredFile, 'utf8');
    const write = realWriteFileSync();
    let failed = false;
    vi.mocked(fileSystem.writeFileSync).mockImplementation((path, data, options) => {
      if (path === preferredFile && !failed) {
        failed = true;
        write(path, 'partial', 'utf8');
        throw new Error('first write failed');
      }
      return write(path, data, options);
    });
    expect(() =>
      updateProjectTerms(
        config,
        {
          preferredTerminology: { set: [{ discouraged: 'Spend', preferred: 'Invest' }] },
        },
        { cwd },
      ),
    ).toThrow('first write failed');
    expect(readFileSync(preferredFile, 'utf8')).toBe(before);
  });

  it('keeps the original typed error and attaches a failed restore as its cause', () => {
    const original = new ParentDirectoryMissingError('protected terms file', protectedFile, cwd);
    Object.defineProperty(original, 'cause', { value: new Error('original disk cause'), configurable: true });
    const write = realWriteFileSync();
    let failed = false;
    vi.mocked(fileSystem.writeFileSync).mockImplementation((path, data, options) => {
      if (path === protectedFile && !failed) {
        failed = true;
        rmSync(preferredFile);
        mkdirSync(preferredFile);
        throw original;
      }
      return write(path, data, options);
    });
    let thrown: unknown;
    try {
      updateProjectTerms(
        config,
        {
          protectedTerms: { replace: ['Changed'] },
          preferredTerminology: { set: [{ discouraged: 'Spend', preferred: 'Invest' }] },
        },
        { cwd },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(original);
    expect(original.kind).toBe('invalid');
    expect(original.cause).toBeInstanceOf(Error);
    expect(String(original.cause)).toContain('original disk cause');
    expect(String(original.cause)).toContain('restore failed');
  });

  it('rolls back a pointer change and its new file when a later read fails', () => {
    const configPath = join(cwd, '.lingo-tracker.json');
    const before = readFileSync(configPath, 'utf8');
    config.collections['app'] = { translationsFolder: 'i18n' };
    writeFileSync(configPath, `${JSON.stringify(config)}\n`);
    const updatedBefore = readFileSync(configPath, 'utf8');
    writeFileSync(protectedFile, '{bad json');
    const collectionFile = join(cwd, 'collection.json');
    expect(() =>
      updateProjectTerms(
        config,
        {
          protectedTerms: { target: { collection: 'app' }, file: 'collection.json', edit: { add: ['New'] } },
        },
        { cwd },
      ),
    ).toThrow('not valid JSON');
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual(JSON.parse(updatedBefore));
    expect(existsSync(collectionFile)).toBe(false);
    expect(before).not.toBe(updatedBefore);
  });

  it('restores a pointer change when beforeWrite aborts', () => {
    const configPath = join(cwd, '.lingo-tracker.json');
    const before = readFileSync(configPath, 'utf8');
    const newFile = join(cwd, 'new-protected.json');
    expect(() =>
      updateProjectTerms(
        config,
        {
          protectedTerms: { file: 'new-protected.json', list: true },
        },
        {
          cwd,
          beforeWrite: () => {
            throw new Error('aborted');
          },
        },
      ),
    ).toThrow('aborted');
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual(JSON.parse(before));
    expect(existsSync(newFile)).toBe(false);
  });

  it('keeps an unrelated concurrent config edit when restoring the pointer', () => {
    const configPath = join(cwd, '.lingo-tracker.json');
    const newFile = join(cwd, 'new-protected.json');
    expect(() =>
      updateProjectTerms(
        config,
        {
          protectedTerms: { file: 'new-protected.json', list: true },
        },
        {
          cwd,
          beforeWrite: () => {
            const latest = JSON.parse(readFileSync(configPath, 'utf8')) as LingoTrackerConfig;
            writeFileSync(configPath, `${JSON.stringify({ ...latest, baseLocale: 'fr' })}\n`);
            throw new Error('aborted');
          },
        },
      ),
    ).toThrow('aborted');
    const restored = JSON.parse(readFileSync(configPath, 'utf8')) as LingoTrackerConfig;
    expect(restored.baseLocale).toBe('fr');
    expect(restored.protectedTermsFile).toBe('protected.json');
    expect(existsSync(newFile)).toBe(false);
  });

  it('reverts the pointer when its setter fails after writing config', () => {
    const configPath = join(cwd, '.lingo-tracker.json');
    const destination = join(cwd, 'directory');
    mkdirSync(destination);
    expect(() =>
      updateProjectTerms(
        config,
        {
          protectedTerms: { file: 'directory', list: true },
        },
        { cwd },
      ),
    ).toThrow();
    const restored = JSON.parse(readFileSync(configPath, 'utf8')) as LingoTrackerConfig;
    expect(restored.protectedTermsFile).toBe('protected.json');
  });

  it('does not rewrite config when a pointer setter fails before its config write', () => {
    const configPath = join(cwd, '.lingo-tracker.json');
    const before = readFileSync(configPath, 'utf8');
    expect(() =>
      updateProjectTerms(
        config,
        {
          protectedTerms: { file: 'missing/terms.json', list: true },
        },
        { cwd },
      ),
    ).toThrow();
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('rejects an invalid protected terms replacement from untyped API input before writing', () => {
    const untypedApiInput: unknown = { protectedTerms: { replace: 'x' } };
    const before = readFileSync(protectedFile, 'utf8');
    // API request bodies are untyped at runtime; core must validate this value.
    expect(() => updateProjectTerms(config, untypedApiInput as ProjectTermsUpdate, { cwd })).toThrow(
      new InvalidCollectionError('protectedTerms must be an array of strings'),
    );
    expect(readFileSync(protectedFile, 'utf8')).toBe(before);
  });

  it.each([
    [{ protectedTerms: { edit: {} } }, 'Provide at least one of --add, --remove, --set, --list, or --file'],
    [{ protectedTerms: { edit: { set: 'A', add: ['B'] } } }, '--set cannot be combined with --add or --remove'],
    [
      { preferredTerminology: {} },
      'Provide one of --list, --add <discouraged> --preferred <preferred>, or --remove <discouraged>',
    ],
    [{ preferredTerminology: { add: 'A', remove: 'B' } }, '--add and --remove cannot be combined; run them separately'],
    [{ preferredTerminology: { list: true, preferred: 'B' } }, '--preferred and --reason can only be used with --add'],
    [{ preferredTerminology: { add: 'A' } }, '--add requires --preferred <preferred>'],
  ] as const)('rejects an invalid flag combination before writing: %j', (update, message) => {
    const before = readFileSync(protectedFile, 'utf8');
    expect(() => updateProjectTerms(config, update, { cwd })).toThrow(new InvalidProjectTermsEditError(message));
    expect(readFileSync(protectedFile, 'utf8')).toBe(before);
  });
});
