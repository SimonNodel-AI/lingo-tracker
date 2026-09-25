import {
  Controller,
  Post,
  Delete,
  Patch,
  Get,
  Query,
  Param,
  Body,
  HttpException,
  HttpStatus,
  ForbiddenException,
  NotFoundException,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  addResource,
  deleteResource,
  moveResource,
  editResource,
  translateExistingResource,
  extractResourcesRecursively,
  type Collection,
} from '@simoncodes-ca/core';
import { buildResourceSummary } from '@simoncodes-ca/domain';
import type {
  CreateResourceDto,
  CreateResourceResponseDto,
  DeleteResourceDto,
  DeleteResourceResponseDto,
  MoveResourceDto,
  MoveResourceResponseDto,
  UpdateResourceDto,
  UpdateResourceResponseDto,
  ResourceTreeDto,
  ResourceSummaryDto,
  SearchTranslationsDto,
  SearchResultsDto,
  CacheStatusDto,
  TreeStatusResponseDto,
  TranslateResourceDto,
  TranslateResourceResponseDto,
  TranslateLocaleRequestDto,
  TranslateLocaleJobDto,
} from '@simoncodes-ca/data-transfer';
import { ConfigService } from '../../config/config.service';
import { mapResourceTreeToDto, mapResourceEntryToSummary } from '../../mappers/resource-tree.mapper';
import { mapSearchResultsToDto } from '../../mappers/search-result.mapper';
import { CollectionIndex } from '../../cache/collection-index.service';
import { TranslationJobService } from '../../translation-job/translation-job.service';
import { WritableCollectionGuard } from '../guards/writable-collection.guard';
import { openDestinationCollection, openRouteCollection } from '../open-route-collection';

@UseGuards(WritableCollectionGuard)
@Controller('collections/:collectionName/resources')
export class ResourcesController {
  readonly #configService: ConfigService;
  readonly #index: CollectionIndex;
  readonly #translationJobService: TranslationJobService;

  constructor(configService: ConfigService, index: CollectionIndex, translationJobService: TranslationJobService) {
    this.#configService = configService;
    this.#index = index;
    this.#translationJobService = translationJobService;
  }

  @Post('translate')
  async translateResource(
    @Param('collectionName') collectionName: string,
    @Body() dto: TranslateResourceDto,
  ): Promise<TranslateResourceResponseDto> {
    const collection = openRouteCollection(this.#configService.getConfig(), collectionName);
    const result = await translateExistingResource(collection, dto.key);

    this.#index.apply(result.mutations);

    return {
      resource: buildResourceSummary(dto.key, result.entry, collection),
      skippedLocales: result.skippedLocales,
      translatedCount: result.translatedCount,
    };
  }

  @Post()
  async createResources(
    @Param('collectionName') collectionName: string,
    @Body() body: CreateResourceDto | CreateResourceDto[],
  ): Promise<CreateResourceResponseDto> {
    const collection = openRouteCollection(this.#configService.getConfig(), collectionName);

    // Normalize to array
    const resources = Array.isArray(body) ? body : [body];

    if (resources.length === 0) {
      throw new HttpException('At least one resource is required', HttpStatus.BAD_REQUEST);
    }

    let entriesCreated = 0;
    const allSkippedLocales: string[] = [];

    for (const resource of resources) {
      const result = await addResource(collection, {
        key: resource.key,
        baseValue: resource.baseValue,
        comment: resource.comment,
        tags: resource.tags,
        targetFolder: resource.targetFolder,
        translations: resource.translations,
      });

      if (result.created) {
        entriesCreated++;
      }

      if (result.skippedLocales?.length) {
        allSkippedLocales.push(...result.skippedLocales);
      }

      this.#index.apply(result.mutations);
    }

    const uniqueSkippedLocales = [...new Set(allSkippedLocales)];

    return {
      entriesCreated,
      created: entriesCreated > 0,
      ...(uniqueSkippedLocales.length > 0 && { skippedLocales: uniqueSkippedLocales }),
    };
  }

  @Delete()
  async delete(
    @Param('collectionName') collectionName: string,
    @Body() dto: DeleteResourceDto,
  ): Promise<DeleteResourceResponseDto> {
    const collection = openRouteCollection(this.#configService.getConfig(), collectionName);

    if (!dto.keys || !Array.isArray(dto.keys) || dto.keys.length === 0) {
      throw new HttpException('Invalid request: keys array is required and must not be empty', HttpStatus.BAD_REQUEST);
    }

    const result = deleteResource(collection, { keys: dto.keys });
    this.#index.apply(result.mutations);

    return {
      entriesDeleted: result.entriesDeleted,
      errors: result.errors,
    };
  }

  @Post('move')
  async move(
    @Param('collectionName') collectionName: string,
    @Body() dto: MoveResourceDto,
  ): Promise<MoveResourceResponseDto> {
    const config = this.#configService.getConfig();
    const collection = openRouteCollection(config, collectionName);

    const result: MoveResourceResponseDto = {
      movedCount: 0,
      warnings: [],
      errors: [],
    };

    if (!dto.moves || !Array.isArray(dto.moves) || dto.moves.length === 0) {
      throw new HttpException('Invalid request: moves array is required and must not be empty', HttpStatus.BAD_REQUEST);
    }

    for (const moveOp of dto.moves) {
      let destinationCollection: Collection | undefined;

      if (moveOp.toCollection) {
        try {
          destinationCollection = openDestinationCollection(config, moveOp.toCollection);
        } catch (error: unknown) {
          if (!(error instanceof NotFoundException || error instanceof ForbiddenException)) throw error;
          // Missing or read-only destination: for consistency with other bulk ops, report it
          // for this move op and continue.
          result.errors = result.errors || [];
          result.errors.push(error.message);
          continue;
        }
      }

      const moveResult = await moveResource(collection, {
        source: moveOp.source,
        destination: moveOp.destination,
        override: moveOp.override,
        destinationCollection,
      });
      this.#index.apply(moveResult.mutations);

      result.movedCount += moveResult.movedCount;
      if (moveResult.warnings && result.warnings) {
        result.warnings.push(...moveResult.warnings);
      }
      if (moveResult.errors && result.errors) {
        result.errors.push(...moveResult.errors);
      }
    }

    return result;
  }

  @Patch()
  async update(
    @Param('collectionName') collectionName: string,
    @Body() dto: UpdateResourceDto,
  ): Promise<UpdateResourceResponseDto> {
    const collection = openRouteCollection(this.#configService.getConfig(), collectionName);

    const result = await editResource(collection, dto.key, {
      baseValue: dto.baseValue,
      comment: dto.comment,
      tags: dto.tags,
      translations: dto.locales,
      moveTo: dto.moveTo,
    });

    this.#index.apply(result.mutations);
    const resourceDto: ResourceSummaryDto | undefined =
      result.updated && result.entry ? buildResourceSummary(result.resolvedKey, result.entry, collection) : undefined;

    return {
      resolvedKey: result.resolvedKey,
      updated: result.updated,
      message: result.message,
      resource: resourceDto,
      skippedLocales: result.skippedLocales,
    };
  }

  @Get('tree')
  async getTree(
    @Param('collectionName') collectionName: string,
    @Query('path') path: string | undefined,
    @Query('includeNested') includeNested: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ResourceTreeDto | TreeStatusResponseDto> {
    const collection = openRouteCollection(this.#configService.getConfig(), collectionName);
    const read = this.#index.tree(collection, path ?? '');

    if (read.status !== 'ready') {
      response.status(HttpStatus.ACCEPTED);
      return read.status === 'indexing'
        ? { status: 'indexing', message: 'Collection is currently being indexed. Please try again shortly.' }
        : {
            status: 'not-ready',
            message:
              read.status === 'error'
                ? 'Cache indexing failed, re-indexing collection. Please try again shortly.'
                : 'Collection indexing started. Please try again shortly.',
          };
    }

    if (!read.tree) {
      throw new NotFoundException(`Path "${path}" not found in collection tree`);
    }

    // An empty path addresses the collection root, which the artificial root node in the
    // Tracker sidebar selects. It is a folder like any other here, so it honours
    // includeNested too and can list every resource in the collection.
    const treeDto = mapResourceTreeToDto(read.tree, collection);

    if (includeNested === 'true') {
      // Nested entries carry keys relative to the requested folder, so they resolve against it.
      treeDto.resources = extractResourcesRecursively(read.tree).map((res) =>
        mapResourceEntryToSummary(res, treeDto.path, collection),
      );
    }

    return treeDto;
  }

  @Get('cache/status')
  async getCacheStatus(@Param('collectionName') collectionName: string): Promise<CacheStatusDto> {
    return this.#index.status(openRouteCollection(this.#configService.getConfig(), collectionName));
  }

  @Get('search')
  async search(
    @Param('collectionName') collectionName: string,
    @Query() dto: SearchTranslationsDto,
  ): Promise<SearchResultsDto> {
    const collection = openRouteCollection(this.#configService.getConfig(), collectionName);

    // Validate query
    if (!dto.query || dto.query.trim().length === 0) {
      return {
        query: dto.query || '',
        results: [],
        totalFound: 0,
        limited: false,
      };
    }

    // Query parameters arrive as strings. A value that is not a positive integer is 100; the cap is 500.
    const requested = Number(dto.maxResults);
    const maxResults = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 500) : 100;

    // Anything but `similar` is a text search, as a bad maxResults falls back to the default.
    const mode = dto.mode === 'similar' ? 'similar-value' : 'text';

    // Request one extra result to detect whether the results were limited.
    const searchResults = this.#index.search(collection, dto.query, { mode, limit: maxResults + 1 });

    // Check if results were limited
    const limited = searchResults.length > maxResults;
    const coreResults = limited ? searchResults.slice(0, maxResults) : searchResults;
    const results = mapSearchResultsToDto(coreResults, collection);

    return {
      query: dto.query,
      results,
      totalFound: limited ? maxResults : results.length,
      limited,
    };
  }

  @Post('translate-locale')
  async translateLocale(
    @Param('collectionName') collectionName: string,
    @Body() dto: TranslateLocaleRequestDto,
    @Res() response: Response,
  ): Promise<void> {
    const collection = openRouteCollection(this.#configService.getConfig(), collectionName);
    const { translationConfig, baseLocale, locales: allLocales } = collection;

    if (!translationConfig?.enabled) {
      throw new HttpException('Auto-translation is not enabled for this collection', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    if (dto.locale === baseLocale || !allLocales.includes(dto.locale)) {
      throw new HttpException(
        `Invalid locale "${dto.locale}": must be a non-base locale defined in the collection's locales`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const jobId = this.#translationJobService.startJob(collection, dto.locale);

    const job = this.#translationJobService.getJob(jobId);
    (response as unknown as import('express').Response).status(HttpStatus.ACCEPTED).json(job);
  }

  @Get('translate-locale/:jobId')
  async getTranslateLocaleJob(
    @Param('collectionName') collectionName: string,
    @Param('jobId') jobId: string,
  ): Promise<TranslateLocaleJobDto> {
    const decodedCollectionName = decodeURIComponent(collectionName);
    const job = this.#translationJobService.getJob(jobId);

    if (job === undefined) {
      throw new NotFoundException(`Translation job "${jobId}" not found`);
    }

    if (job.collectionName !== decodedCollectionName) {
      throw new NotFoundException(`Translation job "${jobId}" not found`);
    }

    return job;
  }
}
