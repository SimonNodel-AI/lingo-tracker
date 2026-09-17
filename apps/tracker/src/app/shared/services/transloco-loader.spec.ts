import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Translation } from '@jsverse/transloco';
import { createServiceFactory, type SpectatorService } from '@ngneat/spectator/vitest';
import { finalize, firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslocoHttpLoader } from './transloco-loader';

describe('TranslocoHttpLoader', () => {
  let loader: TranslocoHttpLoader;
  let spectator: SpectatorService<TranslocoHttpLoader>;
  let httpMock: HttpTestingController;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | undefined;

  const createService = createServiceFactory({
    service: TranslocoHttpLoader,
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });

  beforeEach(() => {
    spectator = createService();
    loader = spectator.service;
    httpMock = spectator.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    consoleErrorSpy?.mockRestore();
  });

  describe('Translation Loading', () => {
    it('should load translation file successfully', async () => {
      const lang = 'en';
      const mockTranslation: Translation = {
        common: {
          actions: {
            ok: 'OK',
            cancel: 'Cancel',
          },
        },
      };

      const translationPromise = firstValueFrom(loader.getTranslation(lang));

      const req = httpMock.expectOne(`/assets/i18n/${lang}.json`);
      expect(req.request.method).toBe('GET');
      req.flush(mockTranslation);

      const translation = await translationPromise;
      expect(translation).toEqual(mockTranslation);
    });

    it('should request correct URL for different languages', async () => {
      const lang = 'es';
      const mockTranslation: Translation = {
        common: {
          actions: {
            ok: 'Aceptar',
            cancel: 'Cancelar',
          },
        },
      };

      const translationPromise = firstValueFrom(loader.getTranslation(lang));

      const req = httpMock.expectOne(`/assets/i18n/${lang}.json`);
      req.flush(mockTranslation);

      const translation = await translationPromise;
      expect(translation).toEqual(mockTranslation);
    });

    it('should handle empty translation file', async () => {
      const lang = 'en';
      const mockTranslation: Translation = {};

      const translationPromise = firstValueFrom(loader.getTranslation(lang));

      const req = httpMock.expectOne(`/assets/i18n/${lang}.json`);
      req.flush(mockTranslation);

      const translation = await translationPromise;
      expect(translation).toEqual(mockTranslation);
    });
  });

  describe('Error Handling', () => {
    it('should return empty object when HTTP request fails', async () => {
      const lang = 'en';
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const translationPromise = firstValueFrom(loader.getTranslation(lang));

      const req = httpMock.expectOne(`/assets/i18n/${lang}.json`);
      req.error(new ProgressEvent('error'), {
        status: 404,
        statusText: 'Not Found',
      });

      const translation = await translationPromise;
      expect(translation).toEqual({});
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Failed to load translation file for '${lang}':`,
        expect.any(Object),
      );
    });

    it('should return empty object when file is not found (404)', async () => {
      const lang = 'unknown';
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const translationPromise = firstValueFrom(loader.getTranslation(lang));

      const req = httpMock.expectOne(`/assets/i18n/${lang}.json`);
      req.error(new ProgressEvent('error'), {
        status: 404,
        statusText: 'Not Found',
      });

      const translation = await translationPromise;
      expect(translation).toEqual({});
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Failed to load translation file for '${lang}':`,
        expect.any(Object),
      );
    });

    it('should return empty object when server returns 500 error', async () => {
      const lang = 'en';
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const translationPromise = firstValueFrom(loader.getTranslation(lang));

      const req = httpMock.expectOne(`/assets/i18n/${lang}.json`);
      req.error(new ProgressEvent('error'), {
        status: 500,
        statusText: 'Internal Server Error',
      });

      const translation = await translationPromise;
      expect(translation).toEqual({});
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Failed to load translation file for '${lang}':`,
        expect.any(Object),
      );
    });

    it('should log error message with language when loading fails', async () => {
      const lang = 'fr';
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const translationPromise = firstValueFrom(loader.getTranslation(lang));

      const req = httpMock.expectOne(`/assets/i18n/${lang}.json`);
      req.error(new ProgressEvent('error'), {
        status: 404,
        statusText: 'Not Found',
      });

      await translationPromise;
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Failed to load translation file for '${lang}':`,
        expect.any(Object),
      );
    });
  });

  describe('Observable Behavior', () => {
    it('should complete the observable after successful load', async () => {
      const lang = 'en';
      const mockTranslation: Translation = { test: 'value' };
      let completedCallbackCalled = false;

      const translationPromise = firstValueFrom(
        loader.getTranslation(lang).pipe(
          finalize(() => {
            completedCallbackCalled = true;
          }),
        ),
      );

      const req = httpMock.expectOne(`/assets/i18n/${lang}.json`);
      req.flush(mockTranslation);

      await translationPromise;

      expect(completedCallbackCalled).toBe(true);
    });

    it('should complete the observable after error', async () => {
      const lang = 'en';
      let completedCallbackCalled = false;
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const translationPromise = firstValueFrom(
        loader.getTranslation(lang).pipe(
          finalize(() => {
            completedCallbackCalled = true;
          }),
        ),
      );

      const req = httpMock.expectOne(`/assets/i18n/${lang}.json`);
      req.error(new ProgressEvent('error'), { status: 404 });

      await translationPromise;

      expect(completedCallbackCalled).toBe(true);
    });
  });
});
