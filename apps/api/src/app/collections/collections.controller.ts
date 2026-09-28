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

  /** Core defaults a collection under `node_modules` to read-only unless `readOnly` is sent. */
  @Post()
  async createCollection(@Body() body: CreateCollectionDto): Promise<{ message: string }> {
    const { name, collection } = body;
    const result = addCollection(name, mapDtoToCollection(collection));
    writeCollectionProtectedTerms(name, collection.protectedTerms);
    return { message: result.message };
  }

  /**
   * Replaces a collection's config entry (full-replace semantics, per HTTP PUT). The body
   * must carry the complete desired collection config: any optional field omitted from
   * `body.collection` — including `readOnly` — is dropped from the stored entry. To keep a
   * collection read-only across an update, send `readOnly: true`; to clear it, send `false`
   * or omit it.
   */
  @Put(':collectionName')
  async updateCollectionByName(
    @Param('collectionName') collectionName: string,
    @Body() body: UpdateCollectionDto,
  ): Promise<{ message: string }> {
    const decodedCollectionName = decodeURIComponent(collectionName);
    const { name, collection } = body;
    const oldTranslationsFolder = this.#translationsFolderOf(decodedCollectionName);
    const result = await updateCollection(decodedCollectionName, name, mapDtoToCollection(collection));
    this.#reindex([oldTranslationsFolder, this.#translationsFolderOf(name || decodedCollectionName)], result.mutations);
    writeCollectionProtectedTerms(name ?? decodedCollectionName, collection.protectedTerms);
    return { message: result.message };
  }
}
