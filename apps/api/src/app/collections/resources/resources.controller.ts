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
} from '@nestjs/common';
import type { Response } from 'express';
import {
  addResources,
  assertCanTranslateLocale,
  deleteResource,
  moveResources,
  searchPage,
  editResource,
  translateExistingResource,
  extractResourcesRecursively,
  type MoveResourcesOperation,
  type Collection,
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
import { RouteCollection } from '../route-collection';

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
    @RouteCollection() collection: Collection,
    @Body() dto: TranslateResourceDto,
  ): Promise<TranslateResourceResponseDto> {
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
    @RouteCollection() collection: Collection,
    @Body() body: CreateResourceDto | CreateResourceDto[],
  ): Promise<CreateResourceResponseDto> {
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
      { onExisting: 'fail' },
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
    @RouteCollection() collection: Collection,
    @Body() dto: DeleteResourceDto,
  ): Promise<DeleteResourceResponseDto> {
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
    @RouteCollection() collection: Collection,
    @Body() dto: MoveResourceDto,
  ): Promise<MoveResourceResponseDto> {
    // Cross-collection moves need the config to resolve destination collections.
    const config = this.#configService.getConfig();

    if (!dto.moves || !Array.isArray(dto.moves) || dto.moves.length === 0) {
      throw new HttpException('Invalid request: moves array is required and must not be empty', HttpStatus.BAD_REQUEST);
    }

    const moves: MoveResourcesOperation[] = dto.moves.map((op) => ({
      source: op.source,
      destination: op.destination,
      override: op.override,
      ...(op.toCollection && { toCollection: op.toCollection }),
    }));
    const result = await moveResources(collection, moves, { config });
    this.#index.apply(result.mutations);
    return { movedCount: result.movedCount, warnings: result.warnings, errors: result.errors };
  }

  @Patch()
  async update(
    @RouteCollection() collection: Collection,
    @Body() dto: UpdateResourceDto,
  ): Promise<UpdateResourceResponseDto> {
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
    @RouteCollection() collection: Collection,
    @Query('path') path: string | undefined,
    @Query('includeNested') includeNested: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ResourceTreeDto | TreeStatusResponseDto> {
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
  async getCacheStatus(@RouteCollection() collection: Collection): Promise<CacheStatusDto> {
    return this.#index.status(collection);
  }

  @Get('search')
  async search(
    @RouteCollection() collection: Collection,
    @Query() dto: SearchTranslationsDto,
  ): Promise<SearchResultsDto> {
    // Validate query
    if (!dto.query || dto.query.trim().length === 0) {
      return {
        query: dto.query || '',
        results: [],
        totalFound: 0,
        limited: false,
      };
    }

    const page = searchPage((options) => this.#index.search(collection, dto.query, options), dto);
    return {
      query: dto.query,
      results: mapSearchResultsToDto(page.results, collection),
      totalFound: page.limited ? page.limit : page.results.length,
      limited: page.limited,
    };
  }

  @Post('translate-locale')
  async translateLocale(
    @RouteCollection() collection: Collection,
    @Body() dto: TranslateLocaleRequestDto,
    @Res() response: Response,
  ): Promise<void> {
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
    const job = this.#translationJobService.getJob(jobId);

    if (job === undefined) {
      throw new NotFoundException(`Translation job "${jobId}" not found`);
    }

    if (job.collectionName !== collectionName) {
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
