import { Controller, Post, Delete, Param, Body } from '@nestjs/common';
import { type Collection, addLocaleToCollection, removeLocaleFromCollection } from '@simoncodes-ca/core';
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
    @RouteCollection() collection: Collection,
    @Body() body: AddLocaleDto,
  ): Promise<AddLocaleResponseDto> {
    const { mutations, ...response } = await addLocaleToCollection(collection.name, body.locale);
    this.#index.apply(mutations);

    return response;
  }

  @Delete(':locale')
  async removeLocale(
    @RouteCollection() collection: Collection,
    @Param('locale') locale: string,
  ): Promise<RemoveLocaleResponseDto> {
    const { mutations, ...response } = await removeLocaleFromCollection(collection.name, locale);
    this.#index.apply(mutations);

    return response;
  }
}
