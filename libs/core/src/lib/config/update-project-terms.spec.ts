import * as fileSystem from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import {
  ConfigChangedError,
  InvalidCollectionError,
  InvalidProjectTermsEditError,
  ParentDirectoryMissingError,
} from '../errors/lingo-tracker-error';
import { loadConfig } from './load-config';
import { PreferredTerminologyValidationError } from './preferred-terminology-file';
import { type ProjectTermsUpdate, planProjectTermsUpdate, updateProjectTerms } from './update-project-terms';

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

  it('rejects a malformed existing list before a pointer change or new file', () => {
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

  it('previews a pointer change without writing it', () => {
    const configPath = join(cwd, '.lingo-tracker.json');
    const before = readFileSync(configPath, 'utf8');
    const newFile = join(cwd, 'new-protected.json');
    const plan = planProjectTermsUpdate(
      config,
      { protectedTerms: { file: 'new-protected.json', list: true } },
      { cwd },
    );
    expect(plan.view.protectedTermsFileChange?.filePath).toBe(newFile);
    expect(plan.view.protectedTerms?.globalFilePath).toBe(newFile);
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual(JSON.parse(before));
    expect(existsSync(newFile)).toBe(false);
  });

  it('refuses a planned pointer edit when its loaded config changes before apply', () => {
    const configPath = join(cwd, '.lingo-tracker.json');
    const plan = planProjectTermsUpdate(
      loadConfig({ cwd }),
      { protectedTerms: { file: 'new-protected.json', list: true } },
      { cwd },
    );
    const changed = `${JSON.stringify({ ...config, baseLocale: 'fr' })}\n`;
    writeFileSync(configPath, changed);

    expect(() => plan.apply()).toThrow(ConfigChangedError);
    expect(readFileSync(configPath, 'utf8')).toBe(changed);
    expect(existsSync(join(cwd, 'new-protected.json'))).toBe(false);
  });

  it('keeps an unrelated concurrent config edit when restoring a failed pointer update', () => {
    const configPath = join(cwd, '.lingo-tracker.json');
    const newFile = join(cwd, 'new-protected.json');
    const plan = planProjectTermsUpdate(
      config,
      {
        protectedTerms: { file: 'new-protected.json', list: true },
        preferredTerminology: { set: [{ discouraged: 'Spend', preferred: 'Invest' }] },
      },
      { cwd },
    );
    writeFileSync(configPath, `${JSON.stringify({ ...config, baseLocale: 'fr' })}\n`);
    rmSync(preferredFile);
    mkdirSync(preferredFile);
    expect(() => plan.apply()).toThrow();
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

  it('uses the supplied config for a preferred file edit after changing a protected terms pointer', () => {
    const supplied = { ...config, preferredTerminologyFile: 'from-caller.json' };
    updateProjectTerms(
      supplied,
      {
        protectedTerms: { file: 'new-protected.json' },
        preferredTerminology: { set: [{ discouraged: 'Spend', preferred: 'Invest' }] },
      },
      { cwd },
    );
    expect(existsSync(join(cwd, 'from-caller.json'))).toBe(true);
    expect(readFileSync(preferredFile, 'utf8')).toBe('[{"discouraged":"Old","preferred":"New"}]\n');
  });

  it('uses the supplied protected terms pointer for an edit', () => {
    const supplied = { ...config, protectedTermsFile: 'from-caller.json' };
    const before = readFileSync(protectedFile, 'utf8');
    updateProjectTerms(supplied, { protectedTerms: { edit: { add: ['New'] } } }, { cwd });
    expect(JSON.parse(readFileSync(join(cwd, 'from-caller.json'), 'utf8'))).toEqual(['New']);
    expect(readFileSync(protectedFile, 'utf8')).toBe(before);
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

  it('uses a terminology error for an untyped preferred replacement shape', () => {
    const untypedApiInput: unknown = { preferredTerminology: { set: { discouraged: 'Email' } } };
    const before = readFileSync(preferredFile, 'utf8');
    let thrown: unknown;
    try {
      updateProjectTerms(config, untypedApiInput as ProjectTermsUpdate, { cwd });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidProjectTermsEditError);
    expect((thrown as InvalidProjectTermsEditError).kind).toBe('invalid');
    expect((thrown as InvalidProjectTermsEditError).problem).toBe('preferred-replacement-shape');
    expect(readFileSync(preferredFile, 'utf8')).toBe(before);
  });

  it('identifies malformed project-term edit fields before writing', () => {
    const cases: readonly [unknown, InvalidProjectTermsEditError['problem']][] = [
      [{ protectedTerms: { list: true, file: 42 } }, 'protected-file-path'],
      [{ preferredTerminology: { remove: 42 } }, 'preferred-remove-shape'],
      [{ preferredTerminology: { upsert: { discouraged: 'A' } } }, 'preferred-upsert-shape'],
      [{ preferredTerminology: { upsert: { discouraged: 'A', preferred: 42 } } }, 'preferred-upsert-shape'],
    ];
    const protectedBefore = readFileSync(protectedFile, 'utf8');
    const preferredBefore = readFileSync(preferredFile, 'utf8');
    for (const [input, problem] of cases) {
      let thrown: unknown;
      try {
        updateProjectTerms(config, input as ProjectTermsUpdate, { cwd });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(InvalidProjectTermsEditError);
      expect((thrown as InvalidProjectTermsEditError).problem).toBe(problem);
      if (problem === 'preferred-upsert-shape') {
        expect((thrown as InvalidProjectTermsEditError).message).toBe(
          'A preferred terminology upsert needs a rule with string terms',
        );
      }
      expect(readFileSync(protectedFile, 'utf8')).toBe(protectedBefore);
      expect(readFileSync(preferredFile, 'utf8')).toBe(preferredBefore);
    }
  });

  it.each([
    [{ protectedTerms: { edit: {} } }, 'protected-missing'],
    [{ protectedTerms: { edit: { set: ['A'], add: ['B'] } } }, 'protected-conflict'],
    [{ preferredTerminology: {} }, 'preferred-missing'],
    [{ preferredTerminology: { upsert: { discouraged: 'A', preferred: 'B' }, remove: 'B' } }, 'preferred-conflict'],
    [{ preferredTerminology: { set: [], remove: 'B' } }, 'preferred-conflict'],
    [{ protectedTerms: { replace: ['A'], edit: { add: ['B'] } } }, 'protected-replacement-conflict'],
  ] as const)('rejects an invalid edit combination before writing: %j', (update, problem) => {
    const before = readFileSync(protectedFile, 'utf8');
    let thrown: unknown;
    try {
      updateProjectTerms(config, update, { cwd });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidProjectTermsEditError);
    expect((thrown as InvalidProjectTermsEditError).kind).toBe('invalid');
    expect((thrown as InvalidProjectTermsEditError).problem).toBe(problem);
    expect(readFileSync(protectedFile, 'utf8')).toBe(before);
  });
});
