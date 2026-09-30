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
  NotFoundException,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  addResources,
  assertCanTranslateLocale,
  deleteResource,
  moveResources,
  clampSearchLimit,
  editResource,
  translateExistingResource,
  extractResourcesRecursively,
  type MoveResourcesOperation,
  type TerminologyFindings,
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
  TerminologyFindingsDto,
} from '@simoncodes-ca/data-transfer';
import { ConfigService } from '../../config/config.service';
import { mapResourceTreeToDto, mapResourceEntryToSummary } from '../../mappers/resource-tree.mapper';
import { mapSearchResultsToDto } from '../../mappers/search-result.mapper';
import { CollectionIndex } from '../../cache/collection-index.service';
import { TranslationJobService } from '../../translation-job/translation-job.service';
import { WritableCollectionGuard } from '../guards/writable-collection.guard';
import { openRouteCollection } from '../open-route-collection';

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
      ...(result.warnings.length > 0 && { warnings: result.warnings }),
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

    const result = await addResources(
      collection,
      resources.map((resource) => ({
        key: resource.key,
        baseValue: resource.baseValue,
        comment: resource.comment,
        tags: resource.tags,
        targetFolder: resource.targetFolder,
        translations: resource.translations,
      })),
    );
    this.#index.apply(result.mutations);
    const terminology = toTerminologyDto(result.terminology);

    return {
      entriesCreated: result.entriesCreated,
      created: result.created,
      ...(result.skippedLocales.length > 0 && { skippedLocales: result.skippedLocales }),
      ...(terminology && { terminology }),
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

    if (!dto.moves || !Array.isArray(dto.moves) || dto.moves.length === 0) {
      throw new HttpException('Invalid request: moves array is required and must not be empty', HttpStatus.BAD_REQUEST);
    }

    const moves: MoveResourcesOperation[] = dto.moves.map((op) => ({
      source: op.source,
      destination: op.destination,
      override: op.override,
      ...(op.toCollection && { toCollection: decodeURIComponent(op.toCollection) }),
    }));
    const result = await moveResources(collection, moves, { config });
    this.#index.apply(result.mutations);
    return { movedCount: result.movedCount, warnings: result.warnings, errors: result.errors };
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
    const terminology = result.terminology && toTerminologyDto(result.terminology);

    return {
      resolvedKey: result.resolvedKey,
      updated: result.updated,
      message: result.message,
      resource: resourceDto,
      skippedLocales: result.skippedLocales,
      ...(terminology && { terminology }),
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
    const maxResults = clampSearchLimit(requested);

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
    assertCanTranslateLocale(collection, dto.locale);

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

/** The advisory findings as the response carries them; `undefined` when there is nothing to report. */
function toTerminologyDto(terminology: TerminologyFindings): TerminologyFindingsDto | undefined {
  if (terminology.findings.length === 0 && terminology.problems.length === 0) return undefined;
  return { findings: terminology.findings.map((finding) => ({ ...finding })), problems: [...terminology.problems] };
}
