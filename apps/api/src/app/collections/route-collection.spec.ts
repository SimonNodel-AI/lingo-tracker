import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { LingoTrackerConfig } from '@simoncodes-ca/core';
import { ConfigService } from '../config/config.service';
import { openDestinationCollection } from './open-route-collection';
import { RouteCollectionPipe, routeCollectionRef } from './route-collection';

describe('RouteCollection', () => {
  const config: LingoTrackerConfig = {
    exportFolder: 'dist/export',
    importFolder: 'dist/import',
    baseLocale: 'en',
    locales: ['en'],
    collections: {
      vendor: { translationsFolder: 'node_modules/vendor', readOnly: true },
      'a%b': { translationsFolder: 'translations/percent' },
      'a%25b': { translationsFolder: 'translations/encoded' },
      'my collection': { translationsFolder: 'translations/space' },
      ünïcode: { translationsFolder: 'translations/unicode' },
    },
  };
  const getConfig = jest.fn(() => config);
  const pipe = new RouteCollectionPipe({ getConfig } as unknown as ConfigService);
  const open = (name: string, method: string, writable?: boolean) =>
    pipe.transform(
      routeCollectionRef(writable === undefined ? {} : { writable }, { method, params: { collectionName: name } }),
    );

  beforeEach(() => getConfig.mockClear());

  it('opens a read-only collection on GET and reads config once', () => {
    expect(open('vendor', 'GET').readOnly).toBe(true);
    expect(getConfig).toHaveBeenCalledTimes(1);
  });

  it('refuses a write to a read-only collection with the core message', () => {
    expect(() => open('vendor', 'POST')).toThrow(ForbiddenException);
    expect(() => open('vendor', 'POST')).toThrow('Collection "vendor" is read-only. Its resources cannot be modified.');
  });

  it('answers 404 for a missing collection before read-only enforcement', () => {
    expect(() => open('missing', 'POST')).toThrow(NotFoundException);
    expect(() => open('missing', 'POST')).toThrow('Collection "missing" not found');
  });

  it('allows an explicit read on POST', () => {
    expect(open('vendor', 'POST', false).readOnly).toBe(true);
  });

  it.each(['a%b', 'a%25b', 'my collection', 'ünïcode'])('uses the literal route name %s', (name) => {
    expect(open(name, 'GET').name).toBe(name);
    expect(getConfig).toHaveBeenCalledTimes(1);
  });

  it('defaults a missing parameter to an empty name', () => {
    expect(routeCollectionRef({}, { method: 'GET', params: {} })).toEqual({ name: '', writable: false });
  });

  it('uses a plain destination body name and names a missing destination', () => {
    expect(openDestinationCollection(config, 'a%25b').name).toBe('a%25b');
    expect(() => openDestinationCollection(config, 'gone')).toThrow('Destination collection "gone" not found');
  });
});
