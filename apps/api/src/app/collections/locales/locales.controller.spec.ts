import { Test, type TestingModule } from '@nestjs/testing';
import { HttpException, NotFoundException } from '@nestjs/common';
import { LocalesController } from './locales.controller';
import { ConfigService } from '../../config/config.service';
import { CollectionIndex } from '../../cache/collection-index.service';
import { toHttpException } from '../../errors/lingo-tracker-exception.filter';
import * as core from '@simoncodes-ca/core';

jest.mock('@simoncodes-ca/core', () => {
  const actual = jest.requireActual('@simoncodes-ca/core');
  return {
    ...actual,
    addLocaleToCollection: jest.fn(),
    removeLocaleFromCollection: jest.fn(),
  };
});

describe('LocalesController', () => {
  let localesModule: TestingModule;
  let localesController: LocalesController;

  const mockConfig = {
    baseLocale: 'en',
    locales: ['en', 'fr'],
    collections: {
      'test-collection': {
        translationsFolder: './translations/test',
        baseLocale: 'en',
        locales: ['en', 'fr'],
      },
    },
  };

  const mockIndex = { apply: jest.fn() };

  beforeEach(async () => {
    localesModule = await Test.createTestingModule({
      controllers: [LocalesController],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            getConfig: jest.fn().mockReturnValue(mockConfig),
          },
        },
        {
          provide: CollectionIndex,
          useValue: mockIndex,
        },
      ],
    }).compile();

    localesController = localesModule.get<LocalesController>(LocalesController);

    jest.clearAllMocks();
  });

  describe('POST /locales (addLocale)', () => {
    it('returns 200 with message, entriesBackfilled, and filesUpdated on success', async () => {
      const mockResult = {
        message: 'Locale "de" added to collection "test-collection" successfully',
        entriesBackfilled: 4,
        filesUpdated: 2,
      };
      const mutations = [{ kind: 'reindex', translationsFolder: '/t' }];
      (core.addLocaleToCollection as jest.Mock).mockResolvedValue({ ...mockResult, mutations });

      const result = await localesController.addLocale('test-collection', { locale: 'de' });

      expect(core.addLocaleToCollection).toHaveBeenCalledWith('test-collection', 'de');
      expect(mockIndex.apply).toHaveBeenCalledWith(mutations);
      // The mutations are for the index; the response is unchanged.
      expect(result).toEqual(mockResult);
    });

    it('returns 400 when locale already exists in collection', async () => {
      (core.addLocaleToCollection as jest.Mock).mockRejectedValue(
        new core.LocaleAlreadyExistsError('fr', 'test-collection'),
      );

      await expect(localesController.addLocale('test-collection', { locale: 'fr' })).rejects.toThrow(
        core.LocaleAlreadyExistsError,
      );

      const error = await localesController.addLocale('test-collection', { locale: 'fr' }).catch(toHttpException);

      expect((error as HttpException).getStatus()).toBe(400);
    });

    it('returns 404 when collection is not in config', async () => {
      await expect(localesController.addLocale('nonexistent-collection', { locale: 'de' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns 400 when trying to add the base locale', async () => {
      (core.addLocaleToCollection as jest.Mock).mockRejectedValue(new core.BaseLocaleImmutableError('en'));

      const error = await localesController.addLocale('test-collection', { locale: 'en' }).catch(toHttpException);

      expect((error as HttpException).getStatus()).toBe(400);
    });

    it('returns 400 when locale format is invalid', async () => {
      (core.addLocaleToCollection as jest.Mock).mockRejectedValue(
        new core.InvalidLocaleError('not-valid-123', 'Invalid locale format: "not-valid-123"'),
      );

      const error = await localesController
        .addLocale('test-collection', { locale: 'not-valid-123' })
        .catch(toHttpException);

      expect((error as HttpException).getStatus()).toBe(400);
    });

    it('returns 500 for unexpected errors', async () => {
      (core.addLocaleToCollection as jest.Mock).mockRejectedValue(new Error('Disk write failure'));

      const error = await localesController.addLocale('test-collection', { locale: 'de' }).catch(toHttpException);

      expect((error as HttpException).getStatus()).toBe(500);
    });

    it('returns 403 when core refuses a read-only collection', async () => {
      (core.addLocaleToCollection as jest.Mock).mockRejectedValue(new core.ReadOnlyCollectionError('test-collection'));

      const error = await localesController.addLocale('test-collection', { locale: 'de' }).catch(toHttpException);

      expect((error as HttpException).getStatus()).toBe(403);
    });

    it('does not touch the index when collection lookup fails before core is called', async () => {
      await localesController.addLocale('nonexistent-collection', { locale: 'de' }).catch(() => undefined);

      expect(mockIndex.apply).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /locales/:locale (removeLocale)', () => {
    it('returns 200 with message, entriesPurged, and filesUpdated on success', async () => {
      const mockResult = {
        message: 'Locale "fr" removed from collection "test-collection" successfully',
        entriesPurged: 3,
        filesUpdated: 2,
      };
      const mutations = [{ kind: 'reindex', translationsFolder: '/t' }];
      (core.removeLocaleFromCollection as jest.Mock).mockResolvedValue({ ...mockResult, mutations });

      const result = await localesController.removeLocale('test-collection', 'fr');

      expect(core.removeLocaleFromCollection).toHaveBeenCalledWith('test-collection', 'fr');
      expect(mockIndex.apply).toHaveBeenCalledWith(mutations);
      // The mutations are for the index; the response is unchanged.
      expect(result).toEqual(mockResult);
    });

    it('returns 404 when collection is not in config', async () => {
      await expect(localesController.removeLocale('nonexistent-collection', 'fr')).rejects.toThrow(NotFoundException);
    });

    it('returns 400 when locale is not in the collection', async () => {
      (core.removeLocaleFromCollection as jest.Mock).mockRejectedValue(
        new core.LocaleNotFoundError('ja', 'test-collection'),
      );

      const error = await localesController.removeLocale('test-collection', 'ja').catch(toHttpException);

      expect((error as HttpException).getStatus()).toBe(400);
    });

    it('returns 400 when trying to remove the base locale', async () => {
      (core.removeLocaleFromCollection as jest.Mock).mockRejectedValue(new core.BaseLocaleImmutableError('en'));

      const error = await localesController.removeLocale('test-collection', 'en').catch(toHttpException);

      expect((error as HttpException).getStatus()).toBe(400);
    });

    it('returns 400 when locale format is invalid', async () => {
      (core.removeLocaleFromCollection as jest.Mock).mockRejectedValue(
        new core.InvalidLocaleError('bad!', 'Invalid locale format: "bad!"'),
      );

      const error = await localesController.removeLocale('test-collection', 'bad!').catch(toHttpException);

      expect((error as HttpException).getStatus()).toBe(400);
    });

    it('returns 500 for unexpected errors', async () => {
      (core.removeLocaleFromCollection as jest.Mock).mockRejectedValue(new Error('Disk write failure'));

      const error = await localesController.removeLocale('test-collection', 'fr').catch(toHttpException);

      expect((error as HttpException).getStatus()).toBe(500);
    });

    it('returns 403 when core refuses a read-only collection', async () => {
      (core.removeLocaleFromCollection as jest.Mock).mockRejectedValue(
        new core.ReadOnlyCollectionError('test-collection'),
      );

      const error = await localesController.removeLocale('test-collection', 'fr').catch(toHttpException);

      expect((error as HttpException).getStatus()).toBe(403);
    });

    it('does not touch the index when collection lookup fails before core is called', async () => {
      await localesController.removeLocale('nonexistent-collection', 'fr').catch(() => undefined);

      expect(mockIndex.apply).not.toHaveBeenCalled();
    });

    it('passes collection name and locale directly to core function', async () => {
      const mockResult = {
        message: 'Locale "fr" removed from collection "test-collection" successfully',
        entriesPurged: 1,
        filesUpdated: 1,
      };
      (core.removeLocaleFromCollection as jest.Mock).mockResolvedValue(mockResult);

      await localesController.removeLocale('test-collection', 'fr');

      expect(core.removeLocaleFromCollection).toHaveBeenCalledWith('test-collection', 'fr');
    });
  });
});
