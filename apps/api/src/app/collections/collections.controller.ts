import { Controller, Delete, Post, Put } from '@nestjs/common';
import { addCollection, deleteCollection, type OpenedCollection, updateCollection } from '@simoncodes-ca/core';
import type { CreateCollectionDto, UpdateCollectionDto } from '@simoncodes-ca/data-transfer';
import { CollectionIndex } from '../cache/collection-index.service';
import { ConfigService } from '../config/config.service';
import { mapDtoToCollection } from '../mappers/collection.mapper';
import { createCollectionBody, updateCollectionBody } from '../validation/dto-schemas';
import { ValidBody } from '../validation/valid-body';
import { RouteCollection } from './route-collection';

@Controller('collections')
export class CollectionsController {
  readonly #index: CollectionIndex;
  readonly #configService: ConfigService;

  constructor(index: CollectionIndex, configService: ConfigService) {
    this.#index = index;
    this.#configService = configService;
  }

  @Delete(':collectionName')
  async deleteCollection(
    @RouteCollection({ lifecycle: 'delete' }) current: OpenedCollection,
  ): Promise<{ message: string }> {
    const result = deleteCollection(current);
    return { message: result.message };
  }

  /**
   * Core defaults a collection under `node_modules` to read-only unless `readOnly` is sent.
   * A body without a non-empty `name`, an object `collection` or a string `translationsFolder` is 400.
   * `mapDtoToCollection` calls core field validation before addCollection reads config.
   */
  @Post()
  async createCollection(@ValidBody(createCollectionBody) body: CreateCollectionDto): Promise<{ message: string }> {
    const { name, collection } = body;
    const mapped = mapDtoToCollection(collection);
    const project = this.#configService.openProject();
    const result = addCollection(project, name, mapped, {
      protectedTerms: collection.protectedTerms,
      onMutation: this.#index.sink,
    });
    return { message: result.message };
  }

  /**
   * Changes a collection's config entry with patch semantics (core `updateCollection`, through
   * the Collection Entry): a field present in `body.collection` replaces the stored value, so
   * `tags: []`, `readOnly: false` or `locales: []` clear a setting, and a field left out keeps
   * its stored value (`translation`, `exportFolder`, `importFolder` survive a client that does
   * not edit them). `name` renames; blank → 400 (`InvalidNameError`, core).
   */
  @Put(':collectionName')
  async updateCollectionByName(
    @ValidBody(updateCollectionBody) body: UpdateCollectionDto,
    @RouteCollection({ lifecycle: 'update' }) current: OpenedCollection,
  ): Promise<{ message: string }> {
    const { name, collection } = body;
    const patch = mapDtoToCollection(collection);
    const result = await updateCollection(current, name, patch, {
      protectedTerms: collection.protectedTerms,
    });
    return { message: result.message };
  }
}
