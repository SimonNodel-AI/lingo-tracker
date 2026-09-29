import { basename } from 'node:path';
import { HttpException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  InvalidConfigError,
  InvalidCollectionError,
  loadPreferredTerminology,
  ParentDirectoryMissingError,
  PreferredTerminologyValidationError,
  editPreferredTerminology,
  resolveProtectedTermsForConfig,
  setGlobalProtectedTerms,
} from '@simoncodes-ca/core';
import { toHttpException } from '../errors/lingo-tracker-exception.filter';
import * as mapper from '../mappers/config.mapper';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';

// Mock the file readers and writers; keep the real error classes so the filter mapping applies.
jest.mock('@simoncodes-ca/core', () => ({
  ...jest.requireActual('@simoncodes-ca/core'),
  setGlobalProtectedTerms: jest.fn(),
  resolveProtectedTermsForConfig: jest.fn(),
  loadPreferredTerminology: jest.fn(),
  editPreferredTerminology: jest.fn(),
}));

const TERMINOLOGY_PATH = '/project/.lingo-tracker-preferred-terminology.json';

/**
 * Runs `fn`, expecting it to throw, and returns what the global exception filter would
 * answer (controllers let core errors propagate).
 */
function catchHttpException(fn: () => unknown): HttpException {
  try {
    fn();
  } catch (error: unknown) {
    return toHttpException(error);
  }
  throw new Error('Expected an error');
}

/** The `message` of a Nest exception body. */
function messageOf(http: HttpException): unknown {
  const response = http.getResponse();
  return typeof response === 'string' ? response : (response as { message: unknown }).message;
}

describe('ConfigController', () => {
  let moduleRef: TestingModule;
  let controller: ConfigController;

  const baseConfig = {
    exportFolder: 'dist/export',
    importFolder: 'dist/import',
    baseLocale: 'en',
    locales: ['en', 'es'],
    collections: {
      app: { translationsFolder: './i18n' },
    },
  };

  const configService = {
    getConfig: jest.fn(),
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      controllers: [ConfigController],
      providers: [{ provide: ConfigService, useValue: configService }],
    }).compile();

    controller = moduleRef.get<ConfigController>(ConfigController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (editPreferredTerminology as jest.Mock).mockReset();
    configService.getConfig.mockReturnValue(baseConfig);
    (resolveProtectedTermsForConfig as jest.Mock).mockReturnValue({
      globalTerms: [],
      globalFilePath: '/project/.lingo-tracker-protected-terms.json',
      collections: {},
    });
    (loadPreferredTerminology as jest.Mock).mockReturnValue({ rules: [], filePath: TERMINOLOGY_PATH });
  });

  describe('getConfig', () => {
    it('passes the terms resolved from disk to the mapper', () => {
      const resolved = {
        globalTerms: ['iPhone'],
        globalFilePath: '/project/.lingo-tracker-protected-terms.json',
        collections: {},
      };
      (resolveProtectedTermsForConfig as jest.Mock).mockReturnValue(resolved);

      const mapSpy = jest.spyOn(mapper, 'mapConfigToDto');
      controller.getConfig();

      expect(mapSpy).toHaveBeenCalledWith(baseConfig, resolved, basename(process.cwd()), {
        rules: [],
        filePath: TERMINOLOGY_PATH,
      });
    });

    it('loads preferred terminology for the served config and exposes rules and path', () => {
      (loadPreferredTerminology as jest.Mock).mockReturnValue({
        rules: [{ discouraged: 'Expenditure', preferred: 'Investment', reason: 'Planning term.' }],
        filePath: TERMINOLOGY_PATH,
      });

      const dto = controller.getConfig();

      expect(loadPreferredTerminology).toHaveBeenCalledWith(baseConfig, process.cwd());
      expect(dto.preferredTerminology).toEqual([
        { discouraged: 'Expenditure', preferred: 'Investment', reason: 'Planning term.' },
      ]);
      expect(dto.preferredTerminologyFilePath).toBe(TERMINOLOGY_PATH);
      expect(dto.preferredTerminologyError).toBeUndefined();
    });

    it('exposes a broken terminology file as preferredTerminologyError', () => {
      (loadPreferredTerminology as jest.Mock).mockReturnValue({
        rules: [],
        filePath: TERMINOLOGY_PATH,
        error: 'Preferred terminology file is not valid JSON',
      });

      const dto = controller.getConfig();

      expect(dto.preferredTerminology).toBeUndefined();
      expect(dto.preferredTerminologyError).toBe('Preferred terminology file is not valid JSON');
    });

    it('exposes the resolved terms and their file path on the DTO', () => {
      (resolveProtectedTermsForConfig as jest.Mock).mockReturnValue({
        globalTerms: ['iPhone'],
        globalFilePath: '/project/.lingo-tracker-protected-terms.json',
        collections: {},
      });

      const dto = controller.getConfig();

      expect(dto.protectedTerms).toEqual(['iPhone']);
      expect(dto.protectedTermsFilePath).toBe('/project/.lingo-tracker-protected-terms.json');
    });

    it('exposes the served workspace folder name as projectName', () => {
      const dto = controller.getConfig();

      expect(dto.projectName).toBe(basename(process.cwd()));
    });
  });

  describe('updateConfig', () => {
    it('updates the global protected-terms list and returns a message', () => {
      const result = controller.updateConfig({ protectedTerms: ['iPhone'] });

      expect(setGlobalProtectedTerms).toHaveBeenCalledWith(['iPhone']);
      expect(result).toEqual({ message: 'Configuration updated successfully' });
    });

    it('is a no-op when the body carries no writable fields', () => {
      const result = controller.updateConfig({});

      expect(setGlobalProtectedTerms).not.toHaveBeenCalled();
      expect(result).toEqual({ message: 'Configuration updated successfully' });
    });

    it('throws 400 when protectedTerms is not a string array', () => {
      const error = catchHttpException(() => controller.updateConfig({ protectedTerms: 'iPhone' } as never));
      expect(setGlobalProtectedTerms).not.toHaveBeenCalled();
      expect(error.getStatus()).toBe(400);
      expect(messageOf(error)).toBe('protectedTerms must be an array of strings');
    });

    describe('preferredTerminology', () => {
      const rules = [
        { discouraged: 'Expenditure', preferred: 'Investment' },
        { discouraged: 'E-mail', preferred: 'email', reason: 'House style.' },
      ];

      it('writes the rule list to the resolved file and returns the standard message', () => {
        const result = controller.updateConfig({ preferredTerminology: rules });

        expect(editPreferredTerminology).toHaveBeenCalledWith(baseConfig, { set: rules }, process.cwd());
        expect(setGlobalProtectedTerms).not.toHaveBeenCalled();
        expect(result).toEqual({ message: 'Configuration updated successfully' });
      });

      it('writes an empty list, clearing the file', () => {
        controller.updateConfig({ preferredTerminology: [] });

        expect(editPreferredTerminology).toHaveBeenCalledWith(baseConfig, { set: [] }, process.cwd());
      });

      it('leaves the terminology file alone when the field is absent', () => {
        controller.updateConfig({ protectedTerms: ['iPhone'] });

        expect(editPreferredTerminology).not.toHaveBeenCalled();
      });

      it('writes both lists when both are sent', () => {
        controller.updateConfig({ protectedTerms: ['iPhone'], preferredTerminology: rules });

        expect(editPreferredTerminology).toHaveBeenCalledWith(baseConfig, { set: rules }, process.cwd());
        expect(setGlobalProtectedTerms).toHaveBeenCalledWith(['iPhone']);
      });

      it('rejects a non-array payload with 400', () => {
        (editPreferredTerminology as jest.Mock).mockImplementationOnce(() => {
          throw new InvalidCollectionError('preferredTerminology must be an array of rules');
        });
        const invalid = { discouraged: 'a', preferred: 'b' };
        const error = catchHttpException(() => controller.updateConfig({ preferredTerminology: invalid } as never));

        expect(error.getStatus()).toBe(400);
        expect(messageOf(error)).toBe('preferredTerminology must be an array of rules');
        expect(editPreferredTerminology).toHaveBeenCalledWith(baseConfig, { set: invalid }, process.cwd());
      });

      it('answers invalid rules with 400 and per-row errors indexed by submitted row', () => {
        (editPreferredTerminology as jest.Mock).mockImplementationOnce(() => {
          throw new PreferredTerminologyValidationError([
            { index: 1, field: 'discouraged', code: 'duplicate', message: 'Duplicate.' },
            { index: 2, field: 'preferred', code: 'empty', message: 'Required.' },
          ]);
        });
        const invalid = [
          { discouraged: 'Expenditure', preferred: 'Investment' },
          { discouraged: 'expenditure', preferred: 'Spend' },
          { discouraged: 'Cost', preferred: '' },
        ];
        const error = catchHttpException(() => controller.updateConfig({ preferredTerminology: invalid }));

        expect(error.getStatus()).toBe(400);
        const body = error.getResponse() as { message: string; errors: Array<{ index: number; code: string }> };
        expect(body.message).toBe('Invalid preferred terminology rules');
        expect(body.errors.map(({ index, code }) => ({ index, code }))).toEqual([
          { index: 1, code: 'duplicate' },
          { index: 2, code: 'empty' },
        ]);
        expect(editPreferredTerminology).toHaveBeenCalledWith(baseConfig, { set: invalid }, process.cwd());
      });

      it('writes neither list when the rules are invalid, even with valid protected terms', () => {
        (editPreferredTerminology as jest.Mock).mockImplementationOnce(() => {
          throw new PreferredTerminologyValidationError([
            { index: 0, field: 'preferred', code: 'self-mapping', message: 'Self mapping.' },
          ]);
        });
        const invalid = [{ discouraged: 'Email', preferred: 'email' }];
        catchHttpException(() =>
          controller.updateConfig({
            protectedTerms: ['iPhone'],
            preferredTerminology: invalid,
          }),
        );

        expect(setGlobalProtectedTerms).not.toHaveBeenCalled();
        expect(editPreferredTerminology).toHaveBeenCalledWith(baseConfig, { set: invalid }, process.cwd());
      });

      it('writes neither list when protected terms are malformed', () => {
        catchHttpException(() =>
          controller.updateConfig({ protectedTerms: 'iPhone', preferredTerminology: rules } as never),
        );

        expect(editPreferredTerminology).not.toHaveBeenCalled();
      });

      it('rejects rows of the wrong type as invalid-type', () => {
        (editPreferredTerminology as jest.Mock).mockImplementationOnce(() => {
          throw new PreferredTerminologyValidationError([
            { index: 0, field: 'rule', code: 'invalid-type', message: 'Rule must be an object.' },
          ]);
        });
        const error = catchHttpException(() =>
          controller.updateConfig({ preferredTerminology: ['Expenditure'] } as never),
        );

        const body = error.getResponse() as { errors: Array<{ index: number; field: string; code: string }> };
        expect(body.errors).toEqual([expect.objectContaining({ index: 0, field: 'rule', code: 'invalid-type' })]);
      });

      it('maps a validation error thrown by the writer to the same 400 body', () => {
        const errors = [{ index: 0, field: 'preferred', code: 'chain', message: 'chain' }];
        (editPreferredTerminology as jest.Mock).mockImplementationOnce(() => {
          throw new PreferredTerminologyValidationError(errors as never);
        });

        const error = catchHttpException(() => controller.updateConfig({ preferredTerminology: rules }));

        expect(error.getStatus()).toBe(400);
        expect(error.getResponse()).toEqual({
          message: 'Invalid preferred terminology rules',
          errors,
          error: 'Bad Request',
          statusCode: 400,
        });
      });

      it('answers a missing directory (ParentDirectoryMissingError) with 400 and the message', () => {
        (editPreferredTerminology as jest.Mock).mockImplementationOnce(() => {
          throw new ParentDirectoryMissingError('preferred terminology file', '/nope/terms.json', '/nope');
        });

        const error = catchHttpException(() => controller.updateConfig({ preferredTerminology: rules }));

        expect(error.getStatus()).toBe(400);
        expect(messageOf(error)).toBe('Cannot write preferred terminology file — directory does not exist: /nope');
      });

      it('answers a malformed file pointer in the config (InvalidConfigError) with 500, its message, and writes nothing', () => {
        const message = '"preferredTerminologyFile" in .lingo-tracker.json must be a string path (got number)';
        (editPreferredTerminology as jest.Mock).mockImplementationOnce(() => {
          throw new InvalidConfigError(message);
        });

        let thrown: unknown;
        try {
          controller.updateConfig({ preferredTerminology: rules });
        } catch (error: unknown) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(InvalidConfigError);
        const error = toHttpException(thrown);
        expect(error.getStatus()).toBe(500);
        expect(messageOf(error)).toBe(message);
        expect(editPreferredTerminology).toHaveBeenCalledWith(baseConfig, { set: rules }, process.cwd());
      });
    });

    it('lets an unexpected error propagate (the filter answers 500)', () => {
      const setter = setGlobalProtectedTerms as jest.Mock;
      setter.mockImplementationOnce(() => {
        throw new Error('update failed');
      });

      expect(() => controller.updateConfig({ protectedTerms: ['iPhone'] })).toThrow('update failed');
    });
  });
});
