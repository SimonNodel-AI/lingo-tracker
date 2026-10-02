import { BadRequestException, Body, Controller, Delete, Param, Post, Put } from '@nestjs/common';
import { addCollection, deleteCollection, openCollection, updateCollection } from '@simoncodes-ca/core';
import type { CreateCollectionDto, UpdateCollectionDto } from '@simoncodes-ca/data-transfer';
import { CollectionIndex } from '../cache/collection-index.service';
import { ConfigService } from '../config/config.service';
import { mapDtoToCollection } from '../mappers/collection.mapper';

/** True for a plain object (not `null`, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The HTTP envelope checks: the body and `collection` must be objects, and `name` must be
 * non-empty (required on create, optional on update). Core validates collection fields.
 */
function assertCollectionBody(
  body: unknown,
  nameIs: 'required' | 'optional',
): asserts body is { name?: string; collection: Record<string, unknown> } {
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
}

@Controller('collections')
export class CollectionsController {
  readonly #index: CollectionIndex;
  readonly #configService: ConfigService;

  constructor(index: CollectionIndex, configService: ConfigService) {
    this.#index = index;
    this.#configService = configService;
  }

  /** Core's typed errors (for example `CollectionNotFoundError`, 404) reach the global exception filter. */
  @Delete(':collectionName')
  async deleteCollection(@Param('collectionName') collectionName: string): Promise<{ message: string }> {
    const current = openCollection(this.#configService.getConfig(), collectionName, { forDeletion: true });
    const result = deleteCollection(current, { onMutation: this.#index.sink });
    return { message: result.message };
  }

  /**
   * Core defaults a collection under `node_modules` to read-only unless `readOnly` is sent.
   * A body without a non-empty `name`, an object `collection` or a string `translationsFolder` is 400.
   * `mapDtoToCollection` calls core field validation before addCollection reads config.
   */
  @Post()
  async createCollection(@Body() body: CreateCollectionDto): Promise<{ message: string }> {
    assertCollectionBody(body, 'required');
    const { name, collection } = body;
    const mapped = mapDtoToCollection(collection);
    const result = addCollection(this.#configService.openProject(), name, mapped, {
      protectedTerms: collection.protectedTerms,
    });
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
    const patch = mapDtoToCollection(collection);
    const current = openCollection(this.#configService.getConfig(), collectionName);
    const result = await updateCollection(current, name, patch, {
      protectedTerms: collection.protectedTerms,
      onMutation: this.#index.sink,
    });
    return { message: result.message };
  }
}
