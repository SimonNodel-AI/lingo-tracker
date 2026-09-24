import { HttpStatus, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { BundlePlan, LingoTrackerConfig } from '@simoncodes-ca/core';
import * as core from '@simoncodes-ca/core';
import type { BundleDefinitionDto } from '@simoncodes-ca/data-transfer';
import type { BundleDefinition } from '@simoncodes-ca/domain';
import type { Response } from 'express';
import { ConfigService } from '../config/config.service';
import { toHttpException } from '../errors/lingo-tracker-exception.filter';
import { BundleJobService } from './bundle-job.service';
import { BundlesController } from './bundles.controller';

jest.mock('@simoncodes-ca/core', () => ({
  ...jest.requireActual('@simoncodes-ca/core'),
  addBundleDefinition: jest.fn(),
  updateBundleDefinition: jest.fn(),
  deleteBundleDefinition: jest.fn(),
  planBundle: jest.fn(),
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

/** The answer the global exception filter gives for what `fn` throws. */
const answerOf = (fn: () => unknown): { status: number; body: unknown } => {
  try {
    fn();
  } catch (error: unknown) {
    const http = toHttpException(error);
    return { status: http.getStatus(), body: http.getResponse() };
  }
  throw new Error('expected the handler to throw');
};

const statusOf = (fn: () => unknown): number => answerOf(fn).status;

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
  });

  describe('POST /bundles', () => {
    it('hands the trimmed name and the body definition to core, which normalises and validates', () => {
      (core.addBundleDefinition as jest.Mock).mockReturnValue({ message: 'Bundle "main" added successfully' });
      const bundle = { ...requestDefinition, dist: ' ./dist/i18n ' };

      const result = controller.createBundle({ name: ' main ', bundle });

      expect(result).toEqual({ message: 'Bundle "main" added successfully' });
      expect(core.addBundleDefinition).toHaveBeenCalledWith('main', bundle, { cwd: process.cwd() });
    });

    it('passes a missing name as empty so the key rule reports it', () => {
      controller.createBundle({ bundle: requestDefinition } as never);

      expect(core.addBundleDefinition).toHaveBeenCalledWith('', requestDefinition, { cwd: process.cwd() });
    });

    it('returns 400 with every message when core rejects the definition', () => {
      (core.addBundleDefinition as jest.Mock).mockImplementation(() => {
        throw new core.InvalidBundleDefinitionError(['Bundle name is required.', 'dist (output folder) is required.']);
      });

      expect(answerOf(() => controller.createBundle({ name: 'x', bundle: requestDefinition }))).toEqual({
        status: HttpStatus.BAD_REQUEST,
        body: {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Invalid bundle definition',
          error: 'Bad Request',
          errors: ['Bundle name is required.', 'dist (output folder) is required.'],
        },
      });
    });

    it('returns 400 when the body carries no definition, without calling core', () => {
      expect(answerOf(() => controller.createBundle({ name: 'main' } as never))).toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        body: { errors: ['bundle definition is required.'] },
      });
      expect(core.addBundleDefinition).not.toHaveBeenCalled();
    });

    it('returns 409 when core reports the bundle already exists', () => {
      (core.addBundleDefinition as jest.Mock).mockImplementation(() => {
        throw new core.BundleAlreadyExistsError('main');
      });

      expect(() => controller.createBundle({ name: 'main', bundle: requestDefinition })).toThrow(
        core.BundleAlreadyExistsError,
      );
      expect(statusOf(() => controller.createBundle({ name: 'main', bundle: requestDefinition }))).toBe(
        HttpStatus.CONFLICT,
      );
    });

    it('returns 400 for a failure core does not type', () => {
      (core.addBundleDefinition as jest.Mock).mockImplementation(() => {
        throw new Error('Failed to write configuration file');
      });

      expect(statusOf(() => controller.createBundle({ name: 'main', bundle: requestDefinition }))).toBe(
        HttpStatus.BAD_REQUEST,
      );
    });
  });

  describe('PUT /bundles/:name', () => {
    it('returns 404 when core reports the bundle missing', () => {
      (core.updateBundleDefinition as jest.Mock).mockImplementation(() => {
        throw new core.BundleNotFoundError('missing');
      });

      expect(statusOf(() => controller.updateBundle('missing', { bundle: requestDefinition }))).toBe(
        HttpStatus.NOT_FOUND,
      );
    });

    it('updates in place when no rename is requested', () => {
      (core.updateBundleDefinition as jest.Mock).mockReturnValue({ message: 'updated' });

      const result = controller.updateBundle('tracker', { bundle: requestDefinition });

      expect(result).toEqual({ message: 'updated' });
      expect(core.updateBundleDefinition).toHaveBeenCalledWith('tracker', requestDefinition, { cwd: process.cwd() });
    });

    it('returns 400 for a missing bundle when the body has no definition', () => {
      expect(answerOf(() => controller.updateBundle('missing', {} as never))).toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        body: { errors: ['bundle definition is required.'] },
      });
      expect(core.updateBundleDefinition).not.toHaveBeenCalled();
    });

    it('passes a body.name equal to the current name as newKey', () => {
      (core.updateBundleDefinition as jest.Mock).mockReturnValue({ message: 'updated' });

      controller.updateBundle('tracker', { name: 'tracker', bundle: requestDefinition });

      expect(core.updateBundleDefinition).toHaveBeenCalledWith('tracker', requestDefinition, {
        cwd: process.cwd(),
        newKey: 'tracker',
      });
    });

    it('URI-decodes the name and renames via body.name', () => {
      (core.updateBundleDefinition as jest.Mock).mockReturnValue({ message: 'renamed' });

      controller.updateBundle('tracker%2Dv1', { name: 'tracker-v2', bundle: requestDefinition });

      expect(core.updateBundleDefinition).toHaveBeenCalledWith('tracker-v1', requestDefinition, {
        cwd: process.cwd(),
        newKey: 'tracker-v2',
      });
    });

    it('returns 409 when core reports a rename collision', () => {
      (core.updateBundleDefinition as jest.Mock).mockImplementation(() => {
        throw new core.BundleAlreadyExistsError('other');
      });

      expect(statusOf(() => controller.updateBundle('tracker', { name: 'other', bundle: requestDefinition }))).toBe(
        HttpStatus.CONFLICT,
      );
    });

    it('returns 400 when core rejects the definition', () => {
      (core.updateBundleDefinition as jest.Mock).mockImplementation(() => {
        throw new core.InvalidBundleDefinitionError(['bundleName is required.']);
      });

      expect(answerOf(() => controller.updateBundle('tracker', { bundle: requestDefinition }))).toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        body: { message: 'Invalid bundle definition', errors: ['bundleName is required.'] },
      });
    });
  });

  describe('DELETE /bundles/:name', () => {
    it('deletes an existing bundle', () => {
      (core.deleteBundleDefinition as jest.Mock).mockReturnValue({ message: 'deleted' });

      expect(controller.deleteBundle('tracker')).toEqual({ message: 'deleted' });
      expect(core.deleteBundleDefinition).toHaveBeenCalledWith('tracker', { cwd: process.cwd() });
    });

    it('maps a core not-found error to 404', () => {
      (core.deleteBundleDefinition as jest.Mock).mockImplementation(() => {
        throw new core.BundleNotFoundError('tracker');
      });

      expect(() => controller.deleteBundle('tracker')).toThrow(core.BundleNotFoundError);
      expect(statusOf(() => controller.deleteBundle('tracker'))).toBe(HttpStatus.NOT_FOUND);
    });
  });

  describe('POST /bundles/dry-run', () => {
    it('plans the normalised definition from the request body, not the saved one', () => {
      (core.planBundle as jest.Mock).mockReturnValue(plan);

      const result = controller.dryRun({
        name: ' preview ',
        bundle: { ...requestDefinition, dist: ' ./dist/i18n ', typeDistFile: '' },
        locales: ['en'],
      });

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

    it('returns 400 with every domain message without planning', () => {
      const bundle: BundleDefinition = {
        ...requestDefinition,
        dist: '',
        collections: [{ name: 'ghost', entriesSelectionRules: 'All' }],
      };

      expect(answerOf(() => controller.dryRun({ name: 'bad name', bundle }))).toEqual({
        status: HttpStatus.BAD_REQUEST,
        body: {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Invalid bundle definition',
          error: 'Bad Request',
          errors: [
            'Bundle name may only contain letters, numbers, hyphens and underscores.',
            'dist (output folder) is required.',
            "Collection 'ghost' does not exist in the configuration.",
          ],
        },
      });
      expect(core.planBundle).not.toHaveBeenCalled();
    });

    it('returns 400 when the name or the definition is missing', () => {
      expect(answerOf(() => controller.dryRun({ bundle: requestDefinition } as never))).toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        body: { errors: ['Bundle name is required.'] },
      });
      expect(statusOf(() => controller.dryRun({ name: 'preview' } as never))).toBe(HttpStatus.BAD_REQUEST);
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

      expect(() => controller.generateBundle('missing', {}, response)).toThrow(core.BundleNotFoundError);
      expect(statusOf(() => controller.generateBundle('missing', {}, response))).toBe(HttpStatus.NOT_FOUND);
      expect(jobService.startJob).not.toHaveBeenCalled();
    });

    it('returns 404 for a name that only exists on Object.prototype', () => {
      const { response } = makeResponse();

      expect(statusOf(() => controller.generateBundle('constructor', {}, response))).toBe(HttpStatus.NOT_FOUND);
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
