import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import {
  addLocaleToCollection,
  createConfigFileOperations,
  type OpenedCollection,
  removeLocaleFromCollection,
} from '@simoncodes-ca/core';
import type { AddLocaleDto, AddLocaleResponseDto, RemoveLocaleResponseDto } from '@simoncodes-ca/data-transfer';
import { CollectionIndex } from '../../cache/collection-index.service';
import { RouteCollection } from '../route-collection';

/**
 * Core locale errors (invalid, missing, duplicate, base locale; read-only collection)
 * propagate to `LingoTrackerExceptionFilter`, which answers 400 / 403 / 404.
 */
@Controller('collections/:collectionName/locales')
export class LocalesController {
  readonly #index: CollectionIndex;

  constructor(index: CollectionIndex) {
    this.#index = index;
  }

  @Post()
  async addLocale(
    @RouteCollection() collection: OpenedCollection,
    @Body() body: AddLocaleDto,
  ): Promise<AddLocaleResponseDto> {
    const response = await addLocaleToCollection(
      collection,
      createConfigFileOperations({ cwd: collection.projectRoot, snapshot: collection.sourceConfig }),
      body.locale,
      { onMutation: this.#index.sink },
    );

    return response;
  }

  @Delete(':locale')
  async removeLocale(
    @RouteCollection() collection: OpenedCollection,
    @Param('locale') locale: string,
  ): Promise<RemoveLocaleResponseDto> {
    const response = await removeLocaleFromCollection(
      collection,
      createConfigFileOperations({ cwd: collection.projectRoot, snapshot: collection.sourceConfig }),
      locale,
      { onMutation: this.#index.sink },
    );

    return response;
  }
}
