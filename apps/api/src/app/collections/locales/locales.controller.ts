import { Controller, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { addLocaleToCollection, removeLocaleFromCollection } from '@simoncodes-ca/core';
import type { AddLocaleDto, AddLocaleResponseDto, RemoveLocaleResponseDto } from '@simoncodes-ca/data-transfer';
import { ConfigService } from '../../config/config.service';
import { CollectionIndex } from '../../cache/collection-index.service';
import { WritableCollectionGuard } from '../guards/writable-collection.guard';
import { openRouteCollection } from '../open-route-collection';

/**
 * Core locale errors (invalid, missing, duplicate, base locale; read-only collection)
 * propagate to `LingoTrackerExceptionFilter`, which answers 400 / 403 / 404.
 */
@UseGuards(WritableCollectionGuard)
@Controller('collections/:collectionName/locales')
export class LocalesController {
  readonly #configService: ConfigService;
  readonly #index: CollectionIndex;

  constructor(configService: ConfigService, index: CollectionIndex) {
    this.#configService = configService;
    this.#index = index;
  }

  @Post()
  async addLocale(
    @Param('collectionName') collectionName: string,
    @Body() body: AddLocaleDto,
  ): Promise<AddLocaleResponseDto> {
    const { name } = openRouteCollection(this.#configService.getConfig(), collectionName);

    const { mutations, ...response } = await addLocaleToCollection(name, body.locale);
    this.#index.apply(mutations);

    return response;
  }

  @Delete(':locale')
  async removeLocale(
    @Param('collectionName') collectionName: string,
    @Param('locale') locale: string,
  ): Promise<RemoveLocaleResponseDto> {
    const { name } = openRouteCollection(this.#configService.getConfig(), collectionName);

    const { mutations, ...response } = await removeLocaleFromCollection(name, locale);
    this.#index.apply(mutations);

    return response;
  }
}
