import { BadRequestException, Body, Controller, Delete, Param, Post, Put } from '@nestjs/common';
import { addCollection, deleteCollectionByName, updateCollection } from '@simoncodes-ca/core';
import type { CreateCollectionDto, UpdateCollectionDto } from '@simoncodes-ca/data-transfer';
import { CollectionIndex } from '../cache/collection-index.service';
import { mapDtoToCollection } from '../mappers/collection.mapper';

/** True for a plain object (not `null`, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The request-shape checks for a collection body, before anything reaches core: `collection`
 * must be an object with a string `translationsFolder` and no `null` field, and `name` a
 * non-empty string (required on create, optional on update; a blank one is refused rather than
 * read as "no rename").
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
  const { collection } = body;
  if (!isRecord(collection)) {
    throw new BadRequestException('collection must be an object');
  }
  // `null` is no value for any field: leave a field out to keep it, send its empty value to clear it.
  const nullField = Object.keys(collection).find((key) => collection[key] === null);
  if (nullField !== undefined) {
    throw new BadRequestException(`collection.${nullField} must not be null`);
  }
  if (typeof collection.translationsFolder !== 'string') {
    throw new BadRequestException('collection.translationsFolder must be a string');
  }
}

@Controller('collections')
export class CollectionsController {
  readonly #index: CollectionIndex;

  constructor(index: CollectionIndex) {
    this.#index = index;
  }

  /** Core's typed errors (for example `CollectionNotFoundError`, 404) reach the global exception filter. */
  @Delete(':collectionName')
  async deleteCollection(@Param('collectionName') collectionName: string): Promise<{ message: string }> {
    const result = deleteCollectionByName(collectionName);
    this.#index.apply(result.mutations);
    return { message: result.message };
  }

  /**
   * Core defaults a collection under `node_modules` to read-only unless `readOnly` is sent.
   * A body without a non-empty `name`, an object `collection` or a string `translationsFolder` is 400.
   */
  @Post()
  async createCollection(@Body() body: CreateCollectionDto): Promise<{ message: string }> {
    assertCollectionBody(body, 'required');
    const { name, collection } = body;
    const result = addCollection(name, mapDtoToCollection(collection), { protectedTerms: collection.protectedTerms });
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
    const { name, collection } = body;
    const result = await updateCollection(collectionName, name, mapDtoToCollection(collection), {
      protectedTerms: collection.protectedTerms,
    });
    this.#index.apply(result.mutations);
    return { message: result.message };
  }
}
