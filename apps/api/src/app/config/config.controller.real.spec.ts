import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { LingoTrackerConfig } from '@simoncodes-ca/core';
import { toHttpException } from '../errors/lingo-tracker-exception.filter';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';

describe('ConfigController preferred terminology (real core)', () => {
  let projectDir: string;
  let controller: ConfigController;
  let config: LingoTrackerConfig;
  const filePath = () => join(projectDir, '.lingo-tracker-preferred-terminology.json');

  beforeEach(async () => {
    projectDir = mkdtempSync(join(tmpdir(), 'lingo-api-config-terms-'));
    jest.spyOn(process, 'cwd').mockReturnValue(projectDir);
    config = {
      exportFolder: 'dist/export',
      importFolder: 'dist/import',
      baseLocale: 'en',
      locales: ['en'],
      collections: {},
    };
    const module = await Test.createTestingModule({
      controllers: [ConfigController],
      providers: [
        {
          provide: ConfigService,
          useValue: { getConfig: () => config, openProject: () => ({ projectRoot: projectDir, sourceConfig: config }) },
        },
      ],
    }).compile();
    controller = module.get(ConfigController);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('refuses the first broken collection file before a broken global file with the same HTTP status', () => {
    config.protectedTermsFile = 'protected.json';
    config.collections['first'] = { translationsFolder: 'i18n', protectedTermsFile: 'first.json' };
    config.collections['second'] = { translationsFolder: 'other', protectedTermsFile: 'second.json' };
    for (const path of ['protected.json', 'first.json', 'second.json']) writeFileSync(join(projectDir, path), '{bad');
    let thrown: unknown;
    try {
      controller.getConfig();
    } catch (error) {
      thrown = error;
    }
    const http = toHttpException(thrown);
    expect(http.getStatus()).toBe(500);
    expect(http.getResponse()).toEqual(
      expect.objectContaining({ message: expect.stringContaining(join(projectDir, 'first.json')) }),
    );
  });

  it('keeps GET config JSON byte-identical for the existing terms and rule fixtures', () => {
    config.protectedTermsFile = 'protected.json';
    config.collections['app'] = { translationsFolder: './i18n', protectedTermsFile: 'own.json' };
    writeFileSync(join(projectDir, 'protected.json'), '["SimonCodes"]');
    writeFileSync(join(projectDir, 'own.json'), '["iPhone"]');
    writeFileSync(
      filePath(),
      '[{"discouraged":"Expenditure","preferred":"Investment","reason":"Planning term."},{"discouraged":"E-mail","preferred":"email"}]',
    );
    const fixture = {
      exportFolder: 'dist/export',
      importFolder: 'dist/import',
      baseLocale: 'en',
      locales: ['en'],
      collections: {
        app: {
          translationsFolder: './i18n',
          protectedTermsFile: 'own.json',
          protectedTerms: ['iPhone'],
          protectedTermsFilePath: join(projectDir, 'own.json'),
        },
      },
      protectedTerms: ['SimonCodes'],
      protectedTermsFilePath: join(projectDir, 'protected.json'),
      preferredTerminology: [
        { discouraged: 'Expenditure', preferred: 'Investment', reason: 'Planning term.' },
        { discouraged: 'E-mail', preferred: 'email' },
      ],
      preferredTerminologyFilePath: filePath(),
      projectName: basename(projectDir),
    };
    expect(JSON.stringify(controller.getConfig())).toBe(JSON.stringify(fixture));
  });

  it('keeps GET config JSON byte-identical when default term files are absent', () => {
    const fixture = {
      exportFolder: 'dist/export',
      importFolder: 'dist/import',
      baseLocale: 'en',
      locales: ['en'],
      collections: {},
      protectedTermsFilePath: join(projectDir, '.lingo-tracker-protected-terms.json'),
      preferredTerminologyFilePath: filePath(),
      projectName: basename(projectDir),
    };
    expect(JSON.stringify(controller.getConfig())).toBe(JSON.stringify(fixture));
  });

  it('answers invalid rows with 400 and submitted-row details without changing the file', () => {
    const original = '[{"discouraged":"Login","preferred":"Sign in"}]\n';
    writeFileSync(filePath(), original);
    let thrown: unknown;
    try {
      controller.updateConfig({
        preferredTerminology: [
          { discouraged: 'Cost', preferred: 'Price' },
          { discouraged: 'cost', preferred: 'Expense' },
          { discouraged: 'Email', preferred: '' },
        ],
      });
    } catch (error) {
      thrown = error;
    }
    const http = toHttpException(thrown);
    expect(http.getStatus()).toBe(400);
    expect(http.getResponse()).toEqual(
      expect.objectContaining({
        message: 'Invalid preferred terminology rules',
        errors: [
          expect.objectContaining({ index: 1, code: 'duplicate' }),
          expect.objectContaining({ index: 2, code: 'empty' }),
        ],
      }),
    );
    expect(readFileSync(filePath(), 'utf8')).toBe(original);
  });

  it('reports invalid rows before a malformed file pointer', () => {
    config.preferredTerminologyFile = 42 as never;
    let thrown: unknown;
    try {
      controller.updateConfig({ preferredTerminology: [{ discouraged: 'Email', preferred: 'email' }] });
    } catch (error) {
      thrown = error;
    }
    const http = toHttpException(thrown);
    expect(http.getStatus()).toBe(400);
    expect(http.getResponse()).toEqual(
      expect.objectContaining({
        errors: [expect.objectContaining({ index: 0, code: 'self-mapping' })],
      }),
    );
  });

  it('writes a valid replacement through core', () => {
    controller.updateConfig({ preferredTerminology: [{ discouraged: 'Expenditure', preferred: 'Investment' }] });
    expect(JSON.parse(readFileSync(filePath(), 'utf8'))).toEqual([
      { discouraged: 'Expenditure', preferred: 'Investment' },
    ]);
  });

  it('leaves the first file untouched when the second file write fails', () => {
    config.protectedTermsFile = 'protected.json';
    writeFileSync(join(projectDir, '.lingo-tracker.json'), `${JSON.stringify(config)}\n`);
    const original = '[{"discouraged":"Login","preferred":"Sign in"}]\n';
    writeFileSync(filePath(), original);
    mkdirSync(join(projectDir, 'protected.json'));
    expect(() =>
      controller.updateConfig({
        protectedTerms: ['Changed'],
        preferredTerminology: [{ discouraged: 'Spend', preferred: 'Invest' }],
      }),
    ).toThrow();
    expect(readFileSync(filePath(), 'utf8')).toBe(original);
  });

  it('answers a missing config for a protected-terms-only update with 404', () => {
    let thrown: unknown;
    try {
      new ConfigController(new ConfigService()).updateConfig({ protectedTerms: ['Changed'] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NotFoundException);
    expect(toHttpException(thrown).getStatus()).toBe(404);
  });

  it('answers malformed config with the standard config-read message', () => {
    writeFileSync(join(projectDir, '.lingo-tracker.json'), '{bad');
    let thrown: unknown;
    try {
      new ConfigController(new ConfigService()).updateConfig({ protectedTerms: ['Changed'] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InternalServerErrorException);
    const http = toHttpException(thrown);
    expect(http.getStatus()).toBe(500);
    expect(http.getResponse()).toEqual(
      expect.objectContaining({
        message: 'Invalid configuration file format',
      }),
    );
  });
});
