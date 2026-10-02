import * as schemas from './dto-schemas';
import type { Schema } from './schema';
import { SchemaPipe } from './valid-body';

const collection = {
  translationsFolder: './translations',
  locales: ['en', 'fr-ca'],
  baseLocale: 'en',
  readOnly: false,
  tags: [],
  protectedTermsFile: '',
};
const bundle = {
  bundleName: 'tracker.{locale}.json',
  dist: './dist',
  collections: 'All',
  typeDistFile: './types.ts',
  tokenCasing: 'camelCase',
  tokenConstantName: 'TOKENS',
  transformICUToTransloco: true,
};
const resource = {
  key: 'ok',
  baseValue: 'OK',
  comment: undefined,
  tags: undefined,
  translations: [{ locale: 'fr', value: 'Oui', status: 'new' }],
};

interface EndpointCase {
  name: string;
  schema: Schema<unknown>;
  accepted: unknown[];
  invalid: unknown;
  message: string;
  optionalBody?: boolean;
  many?: boolean;
  query?: boolean;
}

// Payloads follow browser-api, collections-api, resource-entry-draft, collection-draft,
// bundle-draft, dialog-config-submit and settings-draft (including undefined optional fields).
const endpoints: EndpointCase[] = [
  {
    name: 'config',
    schema: schemas.updateConfigBody,
    optionalBody: true,
    accepted: [
      undefined,
      {},
      { protectedTerms: ['Brand'], preferredTerminology: [{ discouraged: 'old', preferred: 'new' }] },
      { preferredTerminology: [null, 5] },
    ],
    invalid: { protectedTerms: ['Brand', 5] },
    message: 'protectedTerms[1] must be a string',
  },
  {
    name: 'collection config',
    schema: schemas.collectionConfig,
    accepted: [
      collection,
      {
        ...collection,
        protectedTermsFile: './terms.json',
        protectedTerms: ['Brand'],
        protectedTermsFilePath: '/terms.json',
        exportFolder: '',
        importFolder: '',
        translation: { enabled: false, provider: 'google', apiKeyEnv: 'KEY', batchSize: 5, delayMs: 0 },
        legacy: true,
      },
    ],
    invalid: { ...collection, locales: [5] },
    message: 'locales[0] must be a string',
  },
  {
    name: 'create collection',
    schema: schemas.createCollectionBody,
    accepted: [{ name: 'app', collection }],
    invalid: { name: ' ', collection },
    message: 'name must be a non-empty string',
  },
  {
    name: 'update collection',
    schema: schemas.updateCollectionBody,
    accepted: [
      { name: undefined, collection },
      { name: 'renamed', collection },
    ],
    invalid: { collection: [] },
    message: 'collection must be an object',
  },
  {
    name: 'dry run bundle',
    schema: schemas.bundleDryRunBody,
    accepted: [
      { name: 'tracker', bundle },
      { name: '', bundle, locales: ['fr-ca'] },
    ],
    invalid: { name: 'tracker', bundle: 5 },
    message: 'bundle must be an object',
  },
  {
    name: 'create bundle',
    schema: schemas.createBundleBody,
    accepted: [
      { name: 'tracker', bundle },
      { name: '', bundle: {} },
    ],
    invalid: { name: 5, bundle },
    message: 'name must be a string',
  },
  {
    name: 'update bundle',
    schema: schemas.updateBundleBody,
    accepted: [
      { name: undefined, bundle },
      { name: 'renamed', bundle: { ...bundle, typeDist: './legacy' } },
      { name: ' ', bundle },
    ],
    invalid: { bundle: [] },
    message: 'bundle must be an object',
  },
  {
    name: 'generate bundle',
    schema: schemas.generateBundleBody,
    optionalBody: true,
    accepted: [undefined, {}, { locales: ['fr'] }],
    invalid: { locales: 'fr' },
    message: 'locales must be an array',
  },
  {
    name: 'add locale',
    schema: schemas.addLocaleBody,
    accepted: [{ locale: 'fr-ca' }, { locale: '' }],
    invalid: { locale: 5 },
    message: 'locale must be a string',
  },
  {
    name: 'translate resource',
    schema: schemas.translateResourceBody,
    accepted: [{ key: 'apps.ok' }],
    invalid: { key: 5 },
    message: 'key must be a string',
  },
  {
    name: 'create resource item',
    schema: schemas.createResource,
    accepted: [
      resource,
      { key: 'ok', baseValue: 'OK', comment: '', tags: ['button'], targetFolder: '', translations: [] },
    ],
    invalid: { ...resource, translations: [{ locale: 5, value: 'Oui' }] },
    message: 'translations[0].locale must be a string',
  },
  {
    name: 'create resources',
    schema: schemas.createResourcesBody,
    many: true,
    accepted: [resource, [resource]],
    invalid: [{}],
    message: '[0].key must be a string',
  },
  {
    name: 'delete resources',
    schema: schemas.deleteResourcesBody,
    accepted: [{ keys: ['apps.ok'] }],
    invalid: { keys: [] },
    message: 'keys must be a non-empty array',
  },
  {
    name: 'move resources',
    schema: schemas.moveResourcesBody,
    accepted: [
      { moves: [{ source: 'apps.ok', destination: 'ok' }] },
      { moves: [{ source: 'a', destination: 'b', override: false, toCollection: 'app' }] },
    ],
    invalid: { moves: [{ source: 'a', destination: 5 }] },
    message: 'moves[0].destination must be a string',
  },
  {
    name: 'update resource',
    schema: schemas.updateResourceBody,
    accepted: [
      {
        key: 'apps.ok',
        baseValue: 'OK',
        comment: undefined,
        tags: [],
        moveTo: '',
        locales: { fr: { value: 'Oui', status: 'verified' } },
      },
    ],
    invalid: { key: 'a', locales: { fr: { value: 5 } } },
    message: 'locales.fr.value must be a string',
  },
  {
    name: 'translate locale',
    schema: schemas.translateLocaleBody,
    accepted: [{ locale: 'fr' }],
    invalid: { locale: [] },
    message: 'locale must be a string',
  },
  {
    name: 'create folder',
    schema: schemas.createFolderBody,
    accepted: [{ folderName: 'buttons' }, { folderName: 'buttons', parentPath: '' }],
    invalid: { folderName: 5 },
    message: 'folderName must be a string',
  },
  {
    name: 'delete folder',
    schema: schemas.deleteFolderBody,
    accepted: [{ folderPath: 'apps.buttons' }, { folderPath: '' }],
    invalid: { folderPath: 5 },
    message: 'folderPath must be a string',
  },
  {
    name: 'move folder',
    schema: schemas.moveFolderBody,
    accepted: [
      { sourceFolderPath: 'apps', destinationFolderPath: '', nestUnderDestination: true },
      { sourceFolderPath: 'apps', destinationFolderPath: 'shared', override: false, toCollection: 'app' },
    ],
    invalid: { sourceFolderPath: '', destinationFolderPath: '' },
    message: 'sourceFolderPath must be a non-empty string',
  },
  {
    name: 'tree',
    schema: schemas.treeQuery,
    query: true,
    accepted: [{}, { path: '', includeNested: 'false' }, { path: 'apps', includeNested: 'true' }],
    invalid: { path: ['a', 'b'] },
    message: 'path must be a string',
  },
  {
    name: 'search',
    schema: schemas.searchQuery,
    query: true,
    accepted: [
      {},
      { query: 'OK', maxResults: '100' },
      { query: 'OK', maxResults: '7', mode: 'similar' },
      { query: '', mode: 'unknown' },
    ],
    invalid: { query: ['a', 'b'] },
    message: 'query must be a string',
  },
];

const accepted = endpoints.flatMap(({ name, schema, accepted }) =>
  accepted.map((payload) => ({ name, schema, payload })),
);
const rejected = endpoints.flatMap(({ name, schema, invalid, message, optionalBody, many, query }) => {
  const root = query ? 'query' : 'request body';
  const cases = [
    { name, schema, payload: null, message: `${root} must not be null` },
    { name, schema, payload: [], message: `${root} must ${many ? 'be a non-empty array' : 'be an object'}` },
    { name, schema, payload: invalid, message },
  ];
  if (!optionalBody)
    cases.push({
      name,
      schema,
      payload: undefined,
      message: `${root} must ${many ? 'be an object or a non-empty array' : 'be an object'}`,
    });
  return cases;
});

const additionalRejected: Array<{ name: string; schema: Schema<unknown>; payload: unknown; message: string }> = [
  {
    name: 'collection locale',
    schema: schemas.createCollectionBody,
    payload: { name: 'a', collection: { translationsFolder: '', locales: [5] } },
    message: 'collection.locales[0] must be a string',
  },
  {
    name: 'collection tags null',
    schema: schemas.createCollectionBody,
    payload: { name: 'a', collection: { translationsFolder: '', tags: null } },
    message: 'collection.tags must not be null',
  },
  {
    name: 'partial translation',
    schema: schemas.createCollectionBody,
    payload: { name: 'a', collection: { translationsFolder: '', translation: { enabled: true } } },
    message: 'collection.translation.provider must be a string',
  },
  {
    name: 'terminology container',
    schema: schemas.updateConfigBody,
    payload: { preferredTerminology: {} },
    message: 'preferredTerminology must be an array',
  },
  {
    name: 'folder nest flag',
    schema: schemas.moveFolderBody,
    payload: { sourceFolderPath: 'a', destinationFolderPath: '', nestUnderDestination: 'yes' },
    message: 'nestUnderDestination must be a boolean',
  },
  {
    name: 'folder destination',
    schema: schemas.moveFolderBody,
    payload: { sourceFolderPath: 'a', destinationFolderPath: null },
    message: 'destinationFolderPath must not be null',
  },
  {
    name: 'folder destination missing',
    schema: schemas.moveFolderBody,
    payload: { sourceFolderPath: 'a' },
    message: 'destinationFolderPath must be a string',
  },
  {
    name: 'folder parent',
    schema: schemas.createFolderBody,
    payload: { folderName: 'a', parentPath: 5 },
    message: 'parentPath must be a string',
  },
  {
    name: 'resource tags',
    schema: schemas.createResourcesBody,
    payload: { key: 'a', baseValue: '', tags: 'x' },
    message: 'tags must be an array',
  },
  {
    name: 'move override',
    schema: schemas.moveResourcesBody,
    payload: { moves: [{ source: 'a', destination: 'b', override: 'yes' }] },
    message: 'moves[0].override must be a boolean',
  },
  {
    name: 'search limit',
    schema: schemas.searchQuery,
    payload: { maxResults: 'abc' },
    message: 'maxResults must be a positive integer',
  },
  {
    name: 'search repeated limit',
    schema: schemas.searchQuery,
    payload: { maxResults: ['7', '8'] },
    message: 'maxResults must be a positive integer',
  },
  {
    name: 'tree repeated flag',
    schema: schemas.treeQuery,
    payload: { includeNested: ['true', 'false'] },
    message: 'includeNested must be a string',
  },
];

describe('DTO shape schemas', () => {
  it.each(accepted)('accepts $name tracker payload unchanged', ({ schema, payload }) => {
    expect(schema(payload, '')).toBe(payload);
  });

  it.each([...rejected, ...additionalRejected])('rejects $name: $message', ({ name, schema, payload, message }) => {
    const root = name.startsWith('search') || name.startsWith('tree') ? 'query' : 'request body';
    expect(() => new SchemaPipe(schema, root).transform(payload)).toThrow(message);
  });
});
