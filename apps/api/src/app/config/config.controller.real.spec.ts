import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
      providers: [{ provide: ConfigService, useValue: { getConfig: () => config } }],
    }).compile();
    controller = module.get(ConfigController);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(projectDir, { recursive: true, force: true });
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
});
