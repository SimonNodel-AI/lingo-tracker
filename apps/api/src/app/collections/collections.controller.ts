import { Controller, Delete, Param, HttpException, HttpStatus, Post, Body, Put } from '@nestjs/common';
import {
  addCollection,
  deleteCollectionByName,
  openCollection,
  reindexMutation,
  type ResourceMutation,
  setCollectionProtectedTerms,
  updateCollection,
} from '@simoncodes-ca/core';
import { isUnderNodeModules } from '@simoncodes-ca/domain';
import type { CreateCollectionDto, UpdateCollectionDto } from '@simoncodes-ca/data-transfer';
import { CollectionIndex } from '../cache/collection-index.service';
import { ConfigService } from '../config/config.service';
import { mapDtoToCollection } from '../mappers/collection.mapper';

/**
 * Persists a collection's protected terms to its configured file. Terms live in a file
 * rather than the config, so a collection with no `protectedTermsFile` has nowhere to put
 * them — `setCollectionProtectedTerms` throws, and the caller turns that into a 400.
 */
function writeCollectionProtectedTerms(collectionName: string, terms: string[] | undefined): void {
  if (terms === undefined) {
    return;
  }
  if (!Array.isArray(terms) || terms.some((term) => typeof term !== 'string')) {
    throw new HttpException('protectedTerms must be an array of strings', HttpStatus.BAD_REQUEST);
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

  @Delete(':collectionName')
  async deleteCollection(@Param('collectionName') collectionName: string): Promise<{ message: string }> {
    try {
      const decodedCollectionName = decodeURIComponent(collectionName);
      const translationsFolder = this.#translationsFolderOf(decodedCollectionName);
      deleteCollectionByName(decodedCollectionName);
      this.#reindex([translationsFolder]);
      return {
        message: `Collection "${decodedCollectionName}" deleted successfully`,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Error deleting collection';
      throw new HttpException(errorMessage, HttpStatus.BAD_REQUEST);
    }
  }

  @Post()
  async createCollection(@Body() body: CreateCollectionDto): Promise<{ message: string }> {
    try {
      const { name, collection } = body;
      const mapped = mapDtoToCollection(collection);
      // Default to read-only for collections vendored under node_modules unless the caller was explicit.
      if (mapped.readOnly === undefined && isUnderNodeModules(mapped.translationsFolder)) {
        mapped.readOnly = true;
      }
      const result = addCollection(name, mapped);
      writeCollectionProtectedTerms(name, collection.protectedTerms);
      return { message: result.message };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Error creating collection';
      throw new HttpException(errorMessage, HttpStatus.BAD_REQUEST);
    }
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
    try {
      const decodedCollectionName = decodeURIComponent(collectionName);
      const { name, collection } = body;
      const oldTranslationsFolder = this.#translationsFolderOf(decodedCollectionName);
      const result = await updateCollection(decodedCollectionName, name, mapDtoToCollection(collection));
      this.#reindex(
        [oldTranslationsFolder, this.#translationsFolderOf(name || decodedCollectionName)],
        result.mutations,
      );
      writeCollectionProtectedTerms(name ?? decodedCollectionName, collection.protectedTerms);
      return { message: result.message };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Error updating collection';
      throw new HttpException(errorMessage, HttpStatus.BAD_REQUEST);
    }
  }
}
