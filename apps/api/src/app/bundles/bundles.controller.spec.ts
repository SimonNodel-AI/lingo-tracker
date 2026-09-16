import { ConflictException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { BundleDefinition, BundlePlan, LingoTrackerConfig } from '@simoncodes-ca/core';
import * as core from '@simoncodes-ca/core';
import type { BundleDefinitionDto } from '@simoncodes-ca/data-transfer';
import type { Response } from 'express';
import { ConfigService } from '../config/config.service';
import { BundleJobService } from './bundle-job.service';
import { BundlesController } from './bundles.controller';

jest.mock('@simoncodes-ca/core', () => ({
  addBundleDefinition: jest.fn(),
  updateBundleDefinition: jest.fn(),
  deleteBundleDefinition: jest.fn(),
  planBundle: jest.fn(),
  validateBundleKey: jest.fn(() => []),
  validateBundleDefinition: jest.fn(() => []),
  getBundleOutputPath: jest.fn((definition: BundleDefinition, locale: string) => `${definition.dist}/${locale}.json`),
}));

const existingDefinition: BundleDefinition = {
  bundleName: '{locale}',
  dist: './apps/tracker/src/assets/i18n',
  collections: [{ name: 'trackerResources', entriesSelectionRules: 'All' }],
  typeDistFile: './apps/tracker/src/i18n-types/tracker-resources.ts',
};

const config: LingoTrackerConfig = {
  exportFolder: 'dist/export',
  importFolder: 'dist/import',
  baseLocale: 'en',
  locales: ['en', 'fr-ca'],
  collections: { trackerResources: { translationsFolder: 'apps/tracker/src/i18n' } },
  bundles: { tracker: existingDefinition, other: { ...existingDefinition, dist: './dist/other' } },
};

const requestDefinition: BundleDefinitionDto = {
  bundleName: 'main.{locale}',
  dist: './dist/i18n',
  collections: 'All',
};

const plan: BundlePlan = {
  bundleKey: 'preview',
  locales: ['en', 'fr-ca'],
  files: [
    {
      path: 'dist/i18n/main.en.json',
      absolutePath: '/w/dist/i18n/main.en.json',
      kind: 'bundle',
      locale: 'en',
      exists: false,
      keysCount: 2,
    },
  ],
  keysPerLocale: { en: 2, 'fr-ca': 2 },
  conflictsCount: 0,
  conflictKeys: [],
  hierarchicalConflicts: [],
  warnings: [],
};

const statusOf = (fn: () => unknown): number => {
  try {
    fn();
  } catch (error: unknown) {
    if (error instanceof HttpException) return error.getStatus();
    throw error;
  }
  throw new Error('expected an HttpException');
};

const makeResponse = (): { response: Response; status: jest.Mock; json: jest.Mock } => {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  return { response: { status } as unknown as Response, status, json };
};

describe('BundlesController', () => {
  let moduleRef: TestingModule;
  let controller: BundlesController;

  const configService = { getConfig: jest.fn() };
  const jobService = { startJob: jest.fn(), getJob: jest.fn() };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      controllers: [BundlesController],
      providers: [
        { provide: ConfigService, useValue: configService },
        { provide: BundleJobService, useValue: jobService },
      ],
    }).compile();

    controller = moduleRef.get<BundlesController>(BundlesController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    configService.getConfig.mockReturnValue(config);
    (core.validateBundleKey as jest.Mock).mockReturnValue([]);
    (core.validateBundleDefinition as jest.Mock).mockReturnValue([]);
  });

  describe('POST /bundles', () => {
    it('validates then adds the mapped definition', () => {
      (core.addBundleDefinition as jest.Mock).mockReturnValue({ message: 'Bundle "main" added successfully' });

      const result = controller.createBundle({
        name: ' main ',
        bundle: { ...requestDefinition, dist: ' ./dist/i18n ' },
      });

      expect(result).toEqual({ message: 'Bundle "main" added successfully' });
      expect(core.validateBundleKey).toHaveBeenCalledWith('main');
      expect(core.validateBundleDefinition).toHaveBeenCalledWith(
        { bundleName: 'main.{locale}', dist: './dist/i18n', collections: 'All' },
        config,
      );
      expect(core.addBundleDefinition).toHaveBeenCalledWith(
        'main',
        { bundleName: 'main.{locale}', dist: './dist/i18n', collections: 'All' },
        { cwd: process.cwd() },
      );
    });

    it('returns 400 with every validation message and does not write', () => {
      (core.validateBundleKey as jest.Mock).mockReturnValue(['Bundle name is required.']);
      (core.validateBundleDefinition as jest.Mock).mockReturnValue(['dist (output folder) is required.']);

      try {
        controller.createBundle({ name: 'x', bundle: requestDefinition });
        throw new Error('expected an HttpException');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect((error as HttpException).getResponse()).toEqual({
          message: 'Invalid bundle definition',
          errors: ['Bundle name is required.', 'dist (output folder) is required.'],
        });
      }
      expect(core.addBundleDefinition).not.toHaveBeenCalled();
    });

    it('returns 400 when the body carries no definition', () => {
      expect(statusOf(() => controller.createBundle({ name: 'main' } as never))).toBe(HttpStatus.BAD_REQUEST);
      expect(statusOf(() => controller.createBundle({ bundle: requestDefinition } as never))).toBe(
        HttpStatus.BAD_REQUEST,
      );
    });

    it('returns 409 when core reports the bundle already exists', () => {
      (core.addBundleDefinition as jest.Mock).mockImplementation(() => {
        throw new Error('Bundle "main" already exists');
      });

      expect(() => controller.createBundle({ name: 'main', bundle: requestDefinition })).toThrow(ConflictException);
    });
  });

  describe('PUT /bundles/:name', () => {
    it('returns 404 when the bundle does not exist', () => {
      expect(() => controller.updateBundle('missing', { bundle: requestDefinition })).toThrow(NotFoundException);
      expect(core.updateBundleDefinition).not.toHaveBeenCalled();
    });

    it('updates in place when no rename is requested', () => {
      (core.updateBundleDefinition as jest.Mock).mockReturnValue({ message: 'updated' });

      const result = controller.updateBundle('tracker', { bundle: requestDefinition });

      expect(result).toEqual({ message: 'updated' });
      expect(core.updateBundleDefinition).toHaveBeenCalledWith(
        'tracker',
        { bundleName: 'main.{locale}', dist: './dist/i18n', collections: 'All' },
        { cwd: process.cwd() },
      );
    });

    it('URI-decodes the name and renames via body.name', () => {
      (core.updateBundleDefinition as jest.Mock).mockReturnValue({ message: 'renamed' });

      controller.updateBundle('tracker', { name: 'tracker-v2', bundle: requestDefinition });

      expect(core.validateBundleKey).toHaveBeenCalledWith('tracker-v2');
      expect(core.updateBundleDefinition).toHaveBeenCalledWith('tracker', expect.any(Object), {
        cwd: process.cwd(),
        newKey: 'tracker-v2',
      });
    });

    it('returns 409 when renaming onto an existing bundle', () => {
      expect(() => controller.updateBundle('tracker', { name: 'other', bundle: requestDefinition })).toThrow(
        ConflictException,
      );
      expect(core.updateBundleDefinition).not.toHaveBeenCalled();
    });

    it('returns 400 when the definition is invalid', () => {
      (core.validateBundleDefinition as jest.Mock).mockReturnValue(['bundleName is required.']);

      expect(statusOf(() => controller.updateBundle('tracker', { bundle: requestDefinition }))).toBe(
        HttpStatus.BAD_REQUEST,
      );
      expect(core.updateBundleDefinition).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /bundles/:name', () => {
    it('deletes an existing bundle', () => {
      (core.deleteBundleDefinition as jest.Mock).mockReturnValue({ message: 'deleted' });

      expect(controller.deleteBundle('tracker')).toEqual({ message: 'deleted' });
      expect(core.deleteBundleDefinition).toHaveBeenCalledWith('tracker', { cwd: process.cwd() });
    });

    it('returns 404 for an unknown bundle', () => {
      expect(() => controller.deleteBundle('missing')).toThrow(NotFoundException);
      expect(core.deleteBundleDefinition).not.toHaveBeenCalled();
    });

    it('maps a core not-found error to 404', () => {
      (core.deleteBundleDefinition as jest.Mock).mockImplementation(() => {
        throw new Error('Bundle "tracker" not found');
      });

      expect(() => controller.deleteBundle('tracker')).toThrow(NotFoundException);
    });
  });

  describe('POST /bundles/dry-run', () => {
    it('plans the definition from the request body, not the saved one', () => {
      (core.planBundle as jest.Mock).mockReturnValue(plan);

      const result = controller.dryRun({ name: 'preview', bundle: requestDefinition, locales: ['en'] });

      expect(core.planBundle).toHaveBeenCalledWith({
        bundleKey: 'preview',
        bundleDefinition: { bundleName: 'main.{locale}', dist: './dist/i18n', collections: 'All' },
        config,
        locales: ['en'],
        cwd: process.cwd(),
      });
      expect(result.name).toBe('preview');
      expect(result.files).toEqual([
        { path: 'dist/i18n/main.en.json', kind: 'bundle', locale: 'en', exists: false, keysCount: 2 },
      ]);
    });

    it('omits locales from the plan when the request has none', () => {
      (core.planBundle as jest.Mock).mockReturnValue(plan);

      controller.dryRun({ name: 'preview', bundle: requestDefinition });

      expect('locales' in (core.planBundle as jest.Mock).mock.calls[0][0]).toBe(false);
    });

    it('returns 400 for an invalid definition without planning', () => {
      (core.validateBundleDefinition as jest.Mock).mockReturnValue(['dist (output folder) is required.']);

      expect(statusOf(() => controller.dryRun({ name: 'preview', bundle: requestDefinition }))).toBe(
        HttpStatus.BAD_REQUEST,
      );
      expect(core.planBundle).not.toHaveBeenCalled();
    });

    it('returns 400 for a locale outside the project locales', () => {
      expect(statusOf(() => controller.dryRun({ name: 'preview', bundle: requestDefinition, locales: ['xx'] }))).toBe(
        HttpStatus.BAD_REQUEST,
      );
      expect(core.planBundle).not.toHaveBeenCalled();
    });
  });

  describe('POST /bundles/:name/generate', () => {
    it('starts a job and answers 202 with its snapshot', () => {
      const snapshot = { jobId: 'job-1', bundleName: 'tracker', status: 'pending', progress: { current: 0, total: 0 } };
      jobService.startJob.mockReturnValue('job-1');
      jobService.getJob.mockReturnValue(snapshot);
      const { response, status, json } = makeResponse();

      controller.generateBundle('tracker', { locales: ['fr-ca'] }, response);

      expect(jobService.startJob).toHaveBeenCalledWith({
        bundleName: 'tracker',
        bundleDefinition: existingDefinition,
        config,
        locales: ['fr-ca'],
      });
      expect(status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
      expect(json).toHaveBeenCalledWith(snapshot);
    });

    it('tolerates an empty body', () => {
      jobService.startJob.mockReturnValue('job-2');
      jobService.getJob.mockReturnValue({});
      const { response, status } = makeResponse();

      controller.generateBundle('tracker', undefined as never, response);

      expect(jobService.startJob).toHaveBeenCalledWith({
        bundleName: 'tracker',
        bundleDefinition: existingDefinition,
        config,
      });
      expect(status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
    });

    it('returns 404 for an unknown bundle', () => {
      const { response } = makeResponse();

      expect(() => controller.generateBundle('missing', {}, response)).toThrow(NotFoundException);
      expect(jobService.startJob).not.toHaveBeenCalled();
    });

    it('returns 400 for a locale outside the project locales', () => {
      const { response } = makeResponse();

      expect(statusOf(() => controller.generateBundle('tracker', { locales: ['en', 'xx'] }, response))).toBe(
        HttpStatus.BAD_REQUEST,
      );
      expect(jobService.startJob).not.toHaveBeenCalled();
    });
  });

  describe('GET /bundles/jobs/:jobId', () => {
    it('returns the job snapshot', () => {
      const snapshot = {
        jobId: 'job-1',
        bundleName: 'tracker',
        status: 'completed',
        progress: { current: 2, total: 2 },
      };
      jobService.getJob.mockReturnValue(snapshot);

      expect(controller.getJob('job-1')).toBe(snapshot);
    });

    it('returns 404 for an unknown job', () => {
      jobService.getJob.mockReturnValue(undefined);

      expect(() => controller.getJob('nope')).toThrow(NotFoundException);
    });
  });
});
