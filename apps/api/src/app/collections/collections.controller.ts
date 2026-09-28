import { BadRequestException, Body, Controller, Delete, Param, Post, Put } from '@nestjs/common';
import {
  addCollection,
  deleteCollectionByName,
  openCollection,
  reindexMutation,
  type ResourceMutation,
  setCollectionProtectedTerms,
  updateCollection,
} from '@simoncodes-ca/core';
import type { CreateCollectionDto, UpdateCollectionDto } from '@simoncodes-ca/data-transfer';
import { CollectionIndex } from '../cache/collection-index.service';
import { ConfigService } from '../config/config.service';
import { mapDtoToCollection } from '../mappers/collection.mapper';

/**
 * Persists a collection's protected terms to its configured file. Terms live in a file
 * rather than the config, so a collection with no `protectedTermsFile` has nowhere to put
 * them — `setCollectionProtectedTerms` throws `ProtectedTermsFileNotSetError` (400).
 */
function writeCollectionProtectedTerms(collectionName: string, terms: string[] | undefined): void {
  if (terms === undefined) {
    return;
  }
  if (!Array.isArray(terms) || terms.some((term) => typeof term !== 'string')) {
    throw new BadRequestException('protectedTerms must be an array of strings');
  }
  setCollectionProtectedTerms(collectionName, terms);
}

/** True for a plain object (not `null`, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The request-shape checks for a collection body, before anything reaches core: `collection`
 * must be an object with a string `translationsFolder`, and `name` a non-empty string (required
 * on create, optional on update; a blank one is refused rather than read as "no rename").
 */
function assertCollectionBody(
  body: unknown,
  nameIs: 'required' | 'optional',
): asserts body is { name?: string; collection: { translationsFolder: string } } {
  if (!isRecord(body)) {
    throw new BadRequestException('request body must be an object');
  }
  if ((nameIs === 'required' || body.name !== undefined) && !isNonEmptyString(body.name)) {
    throw new BadRequestException('name must be a non-empty string');
  }
  if (!isRecord(body.collection)) {
    throw new BadRequestException('collection must be an object');
  }
  if (typeof body.collection.translationsFolder !== 'string') {
    throw new BadRequestException('collection.translationsFolder must be a string');
  }
}

@Controller('collections')
export class CollectionsController {
  readonly #configService: ConfigService;
  readonly #index: CollectionIndex;

  constructor(configService: ConfigService, index: CollectionIndex) {
    this.#configService = configService;
    this.#index = index;
  }

  /**
   * The collection's absolute translations folder per the current config, or `undefined`
   * when it cannot be resolved (the core call that follows reports that error).
   */
  #translationsFolderOf(collectionName: string): string | undefined {
    try {
      return openCollection(this.#configService.getConfig(), collectionName).translationsFolder;
    } catch {
      return undefined;
    }
  }

  /** Drops the index entries for the given folders; a config change is too broad to patch. */
  #reindex(folders: ReadonlyArray<string | undefined>, mutations: readonly ResourceMutation[] = []): void {
    const unique = [...new Set(folders.filter((folder): folder is string => folder !== undefined))];
    this.#index.apply([...mutations, ...unique.map((folder) => reindexMutation(folder))]);
  }

  /** Core's typed errors (for example `CollectionNotFoundError`, 404) reach the global exception filter. */
  @Delete(':collectionName')
  async deleteCollection(@Param('collectionName') collectionName: string): Promise<{ message: string }> {
    const decodedCollectionName = decodeURIComponent(collectionName);
    const translationsFolder = this.#translationsFolderOf(decodedCollectionName);
    deleteCollectionByName(decodedCollectionName);
    this.#reindex([translationsFolder]);
    return {
      message: `Collection "${decodedCollectionName}" deleted successfully`,
    };
  }

  /**
   * Core defaults a collection under `node_modules` to read-only unless `readOnly` is sent.
   * A body without a non-empty `name`, an object `collection` or a string `translationsFolder` is 400.
   */
  @Post()
  async createCollection(@Body() body: CreateCollectionDto): Promise<{ message: string }> {
    assertCollectionBody(body, 'required');
    const { name, collection } = body;
    const result = addCollection(name, mapDtoToCollection(collection));
    writeCollectionProtectedTerms(name, collection.protectedTerms);
    return { message: result.message };
  }

  /**
   * Changes a collection's config entry with patch semantics (core `updateCollection`, through
   * the Collection Entry): a field present in `body.collection` replaces the stored value, so
   * `tags: []`, `readOnly: false` or `locales: []` clear a setting, and a field left out keeps
   * its stored value (`translation`, `exportFolder`, `importFolder` survive a client that does
   * not edit them). `name` renames; a blank one is 400 rather than "no rename".
   */
  @Put(':collectionName')
  async updateCollectionByName(
    @Param('collectionName') collectionName: string,
    @Body() body: UpdateCollectionDto,
  ): Promise<{ message: string }> {
    assertCollectionBody(body, 'optional');
    const decodedCollectionName = decodeURIComponent(collectionName);
    const { name, collection } = body;
    const targetName = name ?? decodedCollectionName;
    const oldTranslationsFolder = this.#translationsFolderOf(decodedCollectionName);
    const result = await updateCollection(decodedCollectionName, name, mapDtoToCollection(collection));
    this.#reindex([oldTranslationsFolder, this.#translationsFolderOf(targetName)], result.mutations);
    writeCollectionProtectedTerms(targetName, collection.protectedTerms);
    return { message: result.message };
  }
}
