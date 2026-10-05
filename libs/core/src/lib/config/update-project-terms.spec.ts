import * as fileSystem from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import {
  CollectionNotFoundError,
  CoreOperationError,
  ConfigChangedError,
  InvalidCollectionError,
  InvalidProjectTermsEditError,
  ParentDirectoryMissingError,
  PreferredTerminologyValidationError,
} from '../errors/lingo-tracker-error';
import { loadConfig } from './load-config';
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
  const project = (sourceConfig: LingoTrackerConfig = config) => ({ projectRoot: cwd, sourceConfig });

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
      updateProjectTerms(project(config), {
        protectedTerms: { target: {}, change: { kind: 'replace', replace: ['Changed'] } },
        preferredTerminology: { set: [{ discouraged: 'Email', preferred: 'email' }] },
      }),
    ).toThrow(PreferredTerminologyValidationError);
    expect(readFileSync(protectedFile, 'utf8')).toBe(before);
  });

  it('returns normalized protected terms after a replacement', () => {
    const result = updateProjectTerms(project(config), {
      protectedTerms: { target: {}, change: { kind: 'replace', replace: [' iPhone ', 'iPhone', 'Node.js'] } },
    });
    expect(result.protectedTermsResult?.terms).toEqual(['iPhone', 'Node.js']);
    expect(JSON.parse(readFileSync(protectedFile, 'utf8'))).toEqual(['iPhone', 'Node.js']);
  });

  it('restores the first file when the second file write fails', () => {
    rmSync(protectedFile);
    mkdirSync(protectedFile);
    const before = readFileSync(preferredFile, 'utf8');
    expect(() =>
      updateProjectTerms(project(config), {
        protectedTerms: { target: {}, change: { kind: 'replace', replace: ['Changed'] } },
        preferredTerminology: { set: [{ discouraged: 'Spend', preferred: 'Invest' }] },
      }),
    ).toThrow();
    expect(readFileSync(preferredFile, 'utf8')).toBe(before);
  });

  it('removes a newly created first file when the second file write fails', () => {
    rmSync(preferredFile);
    rmSync(protectedFile);
    mkdirSync(protectedFile);
    expect(() =>
      updateProjectTerms(project(config), {
        protectedTerms: { target: {}, change: { kind: 'replace', replace: ['Changed'] } },
        preferredTerminology: { set: [{ discouraged: 'Spend', preferred: 'Invest' }] },
      }),
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
      updateProjectTerms(project(config), {
        preferredTerminology: { set: [{ discouraged: 'Spend', preferred: 'Invest' }] },
      }),
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
      updateProjectTerms(project(config), {
        protectedTerms: { target: {}, change: { kind: 'replace', replace: ['Changed'] } },
        preferredTerminology: { set: [{ discouraged: 'Spend', preferred: 'Invest' }] },
      });
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
      updateProjectTerms(project(config), {
        protectedTerms: {
          target: { collection: 'app' },
          change: { kind: 'edit', edit: { add: ['New'] } },
          file: 'collection.json',
        },
      }),
    ).toThrow('not valid JSON');
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual(JSON.parse(updatedBefore));
    expect(existsSync(collectionFile)).toBe(false);
    expect(before).not.toBe(updatedBefore);
  });

  it('previews a pointer change without writing it', () => {
    const configPath = join(cwd, '.lingo-tracker.json');
    const before = readFileSync(configPath, 'utf8');
    const newFile = join(cwd, 'new-protected.json');
    const plan = planProjectTermsUpdate(project(config), {
      protectedTerms: { target: {}, change: { kind: 'view' }, file: 'new-protected.json', list: true },
    });
    expect(plan.view.protectedTermsFileChange?.filePath).toBe(newFile);
    expect(plan.view.protectedTerms?.globalFilePath).toBe(newFile);
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual(JSON.parse(before));
    expect(existsSync(newFile)).toBe(false);
  });

  it('refuses a planned pointer edit when its loaded config changes before apply', () => {
    const configPath = join(cwd, '.lingo-tracker.json');
    const plan = planProjectTermsUpdate(project(loadConfig({ cwd })), {
      protectedTerms: { target: {}, change: { kind: 'view' }, file: 'new-protected.json', list: true },
    });
    const changed = `${JSON.stringify({ ...config, baseLocale: 'fr' })}\n`;
    writeFileSync(configPath, changed);

    expect(plan.report().error).toBeInstanceOf(ConfigChangedError);
    expect(readFileSync(configPath, 'utf8')).toBe(changed);
    expect(existsSync(join(cwd, 'new-protected.json'))).toBe(false);
  });

  it('reverts the pointer when its setter fails after writing config', () => {
    const configPath = join(cwd, '.lingo-tracker.json');
    const destination = join(cwd, 'directory');
    mkdirSync(destination);
    expect(() =>
      updateProjectTerms(project(loadConfig({ cwd })), {
        protectedTerms: { target: {}, change: { kind: 'view' }, file: 'directory', list: true },
      }),
    ).toThrow();
    const restored = JSON.parse(readFileSync(configPath, 'utf8')) as LingoTrackerConfig;
    expect(restored.protectedTermsFile).toBe('protected.json');
  });

  it('removes a carried file and restores its pointer when a later terminology write fails', () => {
    const configPath = join(cwd, '.lingo-tracker.json');
    const carriedFile = join(cwd, 'new-protected.json');
    rmSync(preferredFile);
    mkdirSync(preferredFile);

    expect(() =>
      updateProjectTerms(project(loadConfig({ cwd })), {
        protectedTerms: { target: {}, change: { kind: 'view' }, file: 'new-protected.json' },
        preferredTerminology: { set: [{ discouraged: 'Spend', preferred: 'Invest' }] },
      }),
    ).toThrow();

    expect(existsSync(carriedFile)).toBe(false);
    expect((JSON.parse(readFileSync(configPath, 'utf8')) as LingoTrackerConfig).protectedTermsFile).toBe(
      'protected.json',
    );
  });

  it('reports the original failure and confirmed pointer restoration', () => {
    const before = readFileSync(join(cwd, '.lingo-tracker.json'), 'utf8');
    mkdirSync(join(cwd, 'directory'));
    const report = planProjectTermsUpdate(project(loadConfig({ cwd })), {
      protectedTerms: { target: {}, change: { kind: 'view' }, file: 'directory', list: true },
    }).report();
    expect(report.status).toBe('failed');
    expect(report.error).toBeInstanceOf(Error);
    expect(report.reverted).toBe(true);
    expect(report.protectedTerms?.globalFilePath).toBe(join(cwd, 'directory'));
    expect(report.protectedTermsFileChange?.filePath).toBe(join(cwd, 'directory'));
    expect(readFileSync(join(cwd, '.lingo-tracker.json'), 'utf8')).toBe(before);
  });

  it('does not claim a pointer was reverted when a stale config prevents writing', () => {
    const plan = planProjectTermsUpdate(project(loadConfig({ cwd })), {
      protectedTerms: { target: {}, change: { kind: 'view' }, file: 'new-protected.json' },
    });
    writeFileSync(join(cwd, '.lingo-tracker.json'), JSON.stringify({ ...config, baseLocale: 'fr' }));
    const report = plan.report();
    expect(report.status).toBe('failed');
    expect(report.error).toBeInstanceOf(ConfigChangedError);
    expect(report.reverted).toBe(false);
    expect(existsSync(join(cwd, 'new-protected.json'))).toBe(false);
  });

  it('reports list paths without claiming a write', () => {
    const report = planProjectTermsUpdate(project(loadConfig({ cwd })), {
      protectedTerms: { target: {}, change: { kind: 'view' }, list: true },
      preferredTerminology: { list: true },
    }).report();
    expect(report.status).toBe('succeeded');
    expect(report.protectedTerms?.globalFilePath).toBe(protectedFile);
    expect(report.preferredTerminology?.filePath).toBe(preferredFile);
    expect(report.reverted).toBe(false);
  });

  it('reports completed edits with stored paths, terms and warnings', () => {
    const report = planProjectTermsUpdate(project(loadConfig({ cwd })), {
      protectedTerms: { target: {}, change: { kind: 'edit', edit: { add: ['New'] } }, file: 'new-protected.json' },
    }).report();
    expect(report.status).toBe('succeeded');
    expect(report.protectedTermsResult?.filePath).toBe(join(cwd, 'new-protected.json'));
    expect(report.protectedTermsResult?.terms).toContain('New');
    expect(report.reverted).toBe(false);
    expect(report.protectedTerms?.warnings).toEqual([]);
  });

  it.each([
    { upsert: { discouraged: 'Old', preferred: 'New' } },
    { remove: 'Old' },
  ])('keeps broken-file rule-edit refusals typed without a synthetic cause: %j', (edit) => {
    writeFileSync(preferredFile, '{bad');
    const report = planProjectTermsUpdate(project(loadConfig({ cwd })), { preferredTerminology: edit }).report();
    expect(report.status).toBe('failed');
    expect(report.error).toBeInstanceOf(CoreOperationError);
    expect((report.error as CoreOperationError).cause).toBeUndefined();
    expect((report.error as CoreOperationError).message).toBe(report.preferredTerminology?.error);
    expect(report.reverted).toBe(false);
    expect(readFileSync(preferredFile, 'utf8')).toBe('{bad');
  });

  it('returns a broken preferred file as advisory data for a list-only core request', () => {
    writeFileSync(preferredFile, '{bad');
    const report = updateProjectTerms(project(loadConfig({ cwd })), { preferredTerminology: { list: true } });
    expect(report.status).toBe('succeeded');
    expect(report.preferredTerminology?.error).toContain('not valid JSON');
    expect(report.error).toBeUndefined();
  });

  it('does not let a preferred list-only failure block a combined protected replacement', () => {
    writeFileSync(preferredFile, '{bad');
    const report = updateProjectTerms(project(loadConfig({ cwd })), {
      protectedTerms: { target: {}, change: { kind: 'replace', replace: ['Brand'] } },
      preferredTerminology: { list: true },
    });
    expect(report.status).toBe('succeeded');
    expect(report.preferredTerminology?.error).toContain('not valid JSON');
    expect(JSON.parse(readFileSync(protectedFile, 'utf8'))).toEqual(['Brand']);
    expect(readFileSync(preferredFile, 'utf8')).toBe('{bad');
  });

  it('carries a replacement scope through the shared reader without guarding unrelated global terms', () => {
    writeFileSync(protectedFile, '{bad');
    const ownFile = join(cwd, 'own.json');
    writeFileSync(ownFile, '["Own"]');
    const sourceConfig = {
      ...config,
      collections: { app: { translationsFolder: 'i18n', protectedTermsFile: 'own.json' } },
    };
    writeFileSync(join(cwd, '.lingo-tracker.json'), JSON.stringify(sourceConfig));
    const report = updateProjectTerms(project(loadConfig({ cwd })), {
      protectedTerms: {
        target: { collection: 'app' },
        change: { kind: 'replace', replace: ['New'] },
        file: 'carried.json',
      },
    });
    expect(report.status).toBe('succeeded');
    expect(JSON.parse(readFileSync(join(cwd, 'carried.json'), 'utf8'))).toEqual(['New']);
    expect(readFileSync(protectedFile, 'utf8')).toBe('{bad');
    expect(readFileSync(ownFile, 'utf8')).toBe('["Own"]');
  });

  it('reports an unknown collection for a replacement with a collection pointer change', () => {
    expect(() =>
      updateProjectTerms(project(loadConfig({ cwd })), {
        protectedTerms: {
          target: { collection: 'missing' },
          change: { kind: 'replace', replace: ['New'] },
          file: 'new-protected.json',
        },
      }),
    ).toThrow(CollectionNotFoundError);
    expect(existsSync(join(cwd, 'new-protected.json'))).toBe(false);
  });

  it('does not rewrite config when a pointer setter fails before its config write', () => {
    const configPath = join(cwd, '.lingo-tracker.json');
    const before = readFileSync(configPath, 'utf8');
    expect(() =>
      updateProjectTerms(project(config), {
        protectedTerms: { target: {}, change: { kind: 'view' }, file: 'missing/terms.json', list: true },
      }),
    ).toThrow();
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('uses the supplied config for a preferred file edit after changing a protected terms pointer', () => {
    const supplied = { ...config, preferredTerminologyFile: 'from-caller.json' };
    updateProjectTerms(project(supplied), {
      protectedTerms: { target: {}, change: { kind: 'view' }, file: 'new-protected.json' },
      preferredTerminology: { set: [{ discouraged: 'Spend', preferred: 'Invest' }] },
    });
    expect(existsSync(join(cwd, 'from-caller.json'))).toBe(true);
    expect(readFileSync(preferredFile, 'utf8')).toBe('[{"discouraged":"Old","preferred":"New"}]\n');
  });

  it('uses the supplied protected terms pointer for an edit', () => {
    const supplied = { ...config, protectedTermsFile: 'from-caller.json' };
    const before = readFileSync(protectedFile, 'utf8');
    updateProjectTerms(project(supplied), {
      protectedTerms: { target: {}, change: { kind: 'edit', edit: { add: ['New'] } } },
    });
    expect(JSON.parse(readFileSync(join(cwd, 'from-caller.json'), 'utf8'))).toEqual(['New']);
    expect(readFileSync(protectedFile, 'utf8')).toBe(before);
  });

  it('rejects an invalid protected terms replacement from untyped API input before writing', () => {
    const untypedApiInput: unknown = { protectedTerms: { target: {}, change: { kind: 'replace', replace: 'x' } } };
    const before = readFileSync(protectedFile, 'utf8');
    // API request bodies are untyped at runtime; core must validate this value.
    expect(() => updateProjectTerms(project(config), untypedApiInput as ProjectTermsUpdate)).toThrow(
      new InvalidCollectionError('protectedTerms must be an array of strings'),
    );
    expect(readFileSync(protectedFile, 'utf8')).toBe(before);
  });

  it('uses a terminology error for an untyped preferred replacement shape', () => {
    const untypedApiInput: unknown = { preferredTerminology: { set: { discouraged: 'Email' } } };
    const before = readFileSync(preferredFile, 'utf8');
    let thrown: unknown;
    try {
      updateProjectTerms(project(config), untypedApiInput as ProjectTermsUpdate);
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
      [{ protectedTerms: { target: {}, change: { kind: 'view' }, list: true, file: 42 } }, 'protected-file-path'],
      [{ preferredTerminology: { remove: 42 } }, 'preferred-remove-shape'],
      [{ preferredTerminology: { upsert: { discouraged: 'A' } } }, 'preferred-upsert-shape'],
      [{ preferredTerminology: { upsert: { discouraged: 'A', preferred: 42 } } }, 'preferred-upsert-shape'],
    ];
    const protectedBefore = readFileSync(protectedFile, 'utf8');
    const preferredBefore = readFileSync(preferredFile, 'utf8');
    for (const [input, problem] of cases) {
      let thrown: unknown;
      try {
        updateProjectTerms(project(config), input as ProjectTermsUpdate);
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
    [{ protectedTerms: { target: {}, change: { kind: 'edit', edit: {} } } }, 'protected-missing'],
    [
      { protectedTerms: { target: {}, change: { kind: 'edit', edit: { set: ['A'], add: ['B'] } } } },
      'protected-conflict',
    ],
    [{ preferredTerminology: {} }, 'preferred-missing'],
    [{ preferredTerminology: { upsert: { discouraged: 'A', preferred: 'B' }, remove: 'B' } }, 'preferred-conflict'],
    [{ preferredTerminology: { set: [], remove: 'B' } }, 'preferred-conflict'],
    [
      { protectedTerms: { target: {}, change: { kind: 'replace', replace: ['A'], edit: { add: ['B'] } } } },
      'protected-replacement-conflict',
    ],
  ] as const)('rejects an invalid edit combination before writing: %j', (update, problem) => {
    const before = readFileSync(protectedFile, 'utf8');
    let thrown: unknown;
    try {
      updateProjectTerms(project(config), update as unknown as ProjectTermsUpdate);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidProjectTermsEditError);
    expect((thrown as InvalidProjectTermsEditError).kind).toBe('invalid');
    expect((thrown as InvalidProjectTermsEditError).problem).toBe(problem);
    expect(readFileSync(protectedFile, 'utf8')).toBe(before);
  });
});
