import { createServiceFactory, type SpectatorService } from '@ngneat/spectator/vitest';
import type { LingoTrackerConfigDto } from '@simoncodes-ca/data-transfer';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTranslocoTestingModule } from '../../../testing/transloco-testing.module';
import { CollectionsApiService } from '../services/collections-api.service';
import { CollectionsStore } from './collections.store';

describe('CollectionsStore', () => {
  let store: InstanceType<typeof CollectionsStore>;
  let spectator: SpectatorService<CollectionsStore>;

  const api = {
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    createCollection: vi.fn(),
    updateCollection: vi.fn(),
    deleteCollection: vi.fn(),
  };

  const configAfterSave: LingoTrackerConfigDto = {
    exportFolder: 'dist/export',
    importFolder: 'dist/import',
    baseLocale: 'en',
    locales: ['en'],
    collections: {},
    protectedTerms: ['iPhone', 'C++'],
  };

  const createStore = createServiceFactory({
    service: CollectionsStore,
    imports: [getTranslocoTestingModule()],
    providers: [{ provide: CollectionsApiService, useValue: api }],
  });

  beforeEach(() => {
    vi.resetAllMocks();
    spectator = createStore();
    store = spectator.service;
  });

  it('updateGlobalConfig calls the API with the DTO and refetches config', () => {
    api.updateConfig.mockReturnValue(of({ message: 'ok' }));
    api.getConfig.mockReturnValue(of(configAfterSave));

    store.updateGlobalConfig({ protectedTerms: ['iPhone', 'C++'] });

    expect(api.updateConfig).toHaveBeenCalledWith({ protectedTerms: ['iPhone', 'C++'] });
    expect(api.getConfig).toHaveBeenCalled();
    expect(store.config()).toEqual(configAfterSave);
    expect(store.error()).toBeNull();
  });

  it('updateGlobalConfig sets error state on failure without losing the previous config', () => {
    api.updateConfig.mockReturnValue(throwError(() => new Error('save failed')));

    store.updateGlobalConfig({ protectedTerms: ['iPhone'] });

    expect(store.error()).toBe('save failed');
    expect(store.config()).toBeNull();
  });
});
