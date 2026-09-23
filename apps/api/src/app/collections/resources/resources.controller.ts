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
  createDefaultTranslations,
  deleteResource,
  moveResource,
  editResource,
  translateExistingResource,
  TranslationError,
  extractResourcesRecursively,
  type Collection,
} from '@simoncodes-ca/core';
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
import { mapDtoToAddResourceParams } from '../../mappers/resource.mapper';
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
    try {
      const collection = openRouteCollection(this.#configService.getConfig(), collectionName);
      const { translationConfig } = collection;

      if (!translationConfig?.enabled) {
        throw new HttpException('Auto-translation is not enabled for this collection', HttpStatus.UNPROCESSABLE_ENTITY);
      }

      const result = await translateExistingResource({
        key: dto.key,
        translationsFolder: collection.translationsFolder,
        translationConfig,
        allLocales: collection.locales,
        baseLocale: collection.baseLocale,
        cwd: process.cwd(),
      });

      this.#index.apply(result.mutations);

      const resource = mapResourceEntryToSummary(result.entry, collection.tags);

      return {
        resource,
        skippedLocales: result.skippedLocales,
        translatedCount: result.translatedCount,
      };
    } catch (error: unknown) {
      if (error instanceof NotFoundException || error instanceof HttpException) {
        throw error;
      }

      if (error instanceof TranslationError) {
        throw new HttpException(`Translation provider error: ${error.message}`, HttpStatus.BAD_GATEWAY);
      }

      const errorMessage = error instanceof Error ? error.message : 'Error translating resource';

      if (errorMessage.includes('Resource not found')) {
        throw new NotFoundException(errorMessage);
      }

      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post()
  async createResources(
    @Param('collectionName') collectionName: string,
    @Body() body: CreateResourceDto | CreateResourceDto[],
  ): Promise<CreateResourceResponseDto> {
    try {
      const collection = openRouteCollection(this.#configService.getConfig(), collectionName);
      const { translationsFolder, baseLocale, locales, translationConfig } = collection;

      // Normalize to array
      const resources = Array.isArray(body) ? body : [body];

      if (resources.length === 0) {
        throw new HttpException('At least one resource is required', HttpStatus.BAD_REQUEST);
      }

      let entriesCreated = 0;
      let hasCreated = false;
      const allSkippedLocales: string[] = [];

      for (const resource of resources) {
        try {
          const resourceBaseLocale = resource.baseLocale || baseLocale;
          const hasExplicitTranslations = resource.translations && resource.translations.length > 0;
          const canAutoTranslate = translationConfig?.enabled && !hasExplicitTranslations;

          // When auto-translation is enabled and no explicit translations provided,
          // let addResource handle translation via the configured provider.
          // Otherwise, fall back to default translations (copies base value with 'new' status).
          const translations = hasExplicitTranslations
            ? resource.translations
            : canAutoTranslate
              ? undefined
              : createDefaultTranslations(locales, resourceBaseLocale, resource.baseValue);

          const params = mapDtoToAddResourceParams({
            ...resource,
            baseLocale: resourceBaseLocale,
            translations,
            ...(canAutoTranslate && { allLocales: locales }),
          });

          const result = canAutoTranslate
            ? await addResource(translationsFolder, params, { translationConfig })
            : await addResource(translationsFolder, params);

          if (result.created) {
            entriesCreated++;
            hasCreated = true;
          }

          if (result.skippedLocales?.length) {
            allSkippedLocales.push(...result.skippedLocales);
          }

          this.#index.apply(result.mutations);
        } catch (error: unknown) {
          // Validation errors (invalid key, etc.) should return 400
          const errorMessage = error instanceof Error ? error.message : '';
          if (errorMessage.includes('Invalid') || errorMessage.includes('cannot be empty')) {
            throw new HttpException(`Validation error for resource: ${errorMessage}`, HttpStatus.BAD_REQUEST);
          }
          // Re-throw other errors to be caught by outer catch
          throw error;
        }
      }

      const uniqueSkippedLocales = [...new Set(allSkippedLocales)];

      return {
        entriesCreated,
        created: hasCreated,
        ...(uniqueSkippedLocales.length > 0 && { skippedLocales: uniqueSkippedLocales }),
      };
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }

      if (error instanceof NotFoundException) {
        throw error;
      }

      // File system errors or other unexpected errors
      const errorMessage = error instanceof Error ? error.message : 'Error creating resources';
      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete()
  async delete(
    @Param('collectionName') collectionName: string,
    @Body() dto: DeleteResourceDto,
  ): Promise<DeleteResourceResponseDto> {
    try {
      const { translationsFolder } = openRouteCollection(this.#configService.getConfig(), collectionName);

      if (!dto.keys || !Array.isArray(dto.keys) || dto.keys.length === 0) {
        throw new HttpException(
          'Invalid request: keys array is required and must not be empty',
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = deleteResource(translationsFolder, { keys: dto.keys });
      this.#index.apply(result.mutations);

      return {
        entriesDeleted: result.entriesDeleted,
        errors: result.errors,
      };
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      if (error instanceof HttpException) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : 'Error deleting resources';
      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('move')
  async move(
    @Param('collectionName') collectionName: string,
    @Body() dto: MoveResourceDto,
  ): Promise<MoveResourceResponseDto> {
    try {
      const config = this.#configService.getConfig();
      const { translationsFolder } = openRouteCollection(config, collectionName);

      const result: MoveResourceResponseDto = {
        movedCount: 0,
        warnings: [],
        errors: [],
      };

      if (!dto.moves || !Array.isArray(dto.moves) || dto.moves.length === 0) {
        throw new HttpException(
          'Invalid request: moves array is required and must not be empty',
          HttpStatus.BAD_REQUEST,
        );
      }

      for (const moveOp of dto.moves) {
        let destinationTranslationsFolder: string | undefined;

        if (moveOp.toCollection) {
          let destination: Collection;
          try {
            destination = openDestinationCollection(config, moveOp.toCollection);
          } catch (error: unknown) {
            if (!(error instanceof NotFoundException || error instanceof ForbiddenException)) throw error;
            // Missing or read-only destination: for consistency with other bulk ops, report it
            // for this move op and continue.
            result.errors = result.errors || [];
            result.errors.push(error.message);
            continue;
          }
          destinationTranslationsFolder = destination.translationsFolder;
        }

        const moveResult = await moveResource(translationsFolder, {
          source: moveOp.source,
          destination: moveOp.destination,
          override: moveOp.override,
          destinationTranslationsFolder: destinationTranslationsFolder,
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
    } catch (error: unknown) {
      if (error instanceof NotFoundException || error instanceof HttpException) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : 'Error moving resources';
      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Patch()
  async update(
    @Param('collectionName') collectionName: string,
    @Body() dto: UpdateResourceDto,
  ): Promise<UpdateResourceResponseDto> {
    try {
      const collection = openRouteCollection(this.#configService.getConfig(), collectionName);

      const result = await editResource(collection.translationsFolder, {
        ...dto,
        baseLocale: collection.baseLocale,
        translationConfig: collection.translationConfig,
        allLocales: collection.locales,
      });

      this.#index.apply(result.mutations);
      const resourceDto: ResourceSummaryDto | undefined =
        result.updated && result.entry ? mapResourceEntryToSummary(result.entry, collection.tags) : undefined;

      return {
        resolvedKey: result.resolvedKey,
        updated: result.updated,
        message: result.message,
        resource: resourceDto,
        skippedLocales: result.skippedLocales,
      };
    } catch (error: unknown) {
      if (error instanceof NotFoundException || error instanceof HttpException) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : 'Error updating resource';

      if (errorMessage.includes('Resource not found')) {
        throw new NotFoundException(errorMessage);
      }

      if (errorMessage.includes('Invalid')) {
        throw new HttpException(errorMessage, HttpStatus.BAD_REQUEST);
      }

      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('tree')
  async getTree(
    @Param('collectionName') collectionName: string,
    @Query('path') path: string | undefined,
    @Query('includeNested') includeNested: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ResourceTreeDto | TreeStatusResponseDto> {
    try {
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
      const treeDto = mapResourceTreeToDto(read.tree, collection.tags);

      if (includeNested === 'true') {
        treeDto.resources = extractResourcesRecursively(read.tree).map((res) =>
          mapResourceEntryToSummary(res, collection.tags),
        );
      }

      return treeDto;
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : 'Error loading resource tree';
      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('cache/status')
  async getCacheStatus(@Param('collectionName') collectionName: string): Promise<CacheStatusDto> {
    try {
      return this.#index.status(openRouteCollection(this.#configService.getConfig(), collectionName));
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : 'Error retrieving cache status';
      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('search')
  async search(
    @Param('collectionName') collectionName: string,
    @Query() dto: SearchTranslationsDto,
  ): Promise<SearchResultsDto> {
    try {
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

      // Default maxResults to 100, cap at 500
      const maxResults = Math.min(dto.maxResults || 100, 500);

      // Request one extra result to detect whether the results were limited.
      const searchResults = this.#index.search(collection, dto.query, maxResults + 1);

      // Check if results were limited
      const limited = searchResults.length > maxResults;
      const coreResults = limited ? searchResults.slice(0, maxResults) : searchResults;
      const results = mapSearchResultsToDto(coreResults, collection.tags);

      return {
        query: dto.query,
        results,
        totalFound: limited ? maxResults : results.length,
        limited,
      };
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      if (error instanceof HttpException) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : 'Error searching translations';
      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
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

    const jobId = this.#translationJobService.startJob({
      collectionName: collection.name,
      translationsFolder: collection.translationsFolder,
      translationConfig,
      targetLocale: dto.locale,
      baseLocale,
      allLocales,
      cwd: process.cwd(),
    });

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
