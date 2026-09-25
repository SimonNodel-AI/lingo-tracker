import { NotFoundException } from '@nestjs/common';
import { resolve } from 'node:path';
import type { LingoTrackerConfig } from '@simoncodes-ca/core';
import { openDestinationCollection, openRouteCollection } from './open-route-collection';

describe('openRouteCollection', () => {
  const config: LingoTrackerConfig = {
    exportFolder: 'dist/export',
    importFolder: 'dist/import',
    baseLocale: 'en',
    locales: ['en', 'fr'],
    collections: {
      'my collection': { translationsFolder: 'src/i18n', baseLocale: 'fr', locales: ['fr', 'de'] },
      vendor: { translationsFolder: 'node_modules/x', readOnly: true },
    },
  };

  it('decodes the route param and returns the effective collection', () => {
    const collection = openRouteCollection(config, 'my%20collection');

    expect(collection.name).toBe('my collection');
    expect(collection.translationsFolder).toBe(resolve(process.cwd(), 'src/i18n'));
    expect(collection.baseLocale).toBe('fr');
    expect(collection.targetLocales).toEqual(['de']);
  });

  it('returns read-only collections (the guard refuses writes)', () => {
    expect(openRouteCollection(config, 'vendor').readOnly).toBe(true);
  });

  it('throws a 404 naming the decoded collection when it is missing', () => {
    expect(() => openRouteCollection(config, 'no%20such')).toThrow(NotFoundException);
    expect(() => openRouteCollection(config, 'no%20such')).toThrow('Collection "no such" not found');
  });

  it('names a missing move destination as the destination', () => {
    expect(() => openDestinationCollection(config, 'gone')).toThrow('Destination collection "gone" not found');
    expect(openDestinationCollection(config, 'my%20collection').name).toBe('my collection');
  });
});
