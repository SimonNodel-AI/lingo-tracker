import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import type { BundleDefinition, LingoTrackerConfig } from '@simoncodes-ca/core';
import {
  addBundleDefinition,
  deleteBundleDefinition,
  LingoTrackerError,
  planBundle,
  updateBundleDefinition,
  validateBundleDefinition,
  validateBundleKey,
} from '@simoncodes-ca/core';
import type {
  BundleDefinitionDto,
  BundleDryRunRequestDto,
  BundleDryRunResultDto,
  BundleGenerateJobDto,
  CreateBundleDto,
  GenerateBundleRequestDto,
  UpdateBundleDto,
} from '@simoncodes-ca/data-transfer';
import type { Response } from 'express';
import { ConfigService } from '../config/config.service';
import { mapBundlePlanToDto, mapDtoToBundleDefinition } from '../mappers/bundle.mapper';
import { BundleJobService } from './bundle-job.service';

const INVALID_DEFINITION_MESSAGE = 'Invalid bundle definition';

@Controller('bundles')
export class BundlesController {
  readonly #configService: ConfigService;
  readonly #jobService: BundleJobService;

  constructor(configService: ConfigService, jobService: BundleJobService) {
    this.#configService = configService;
    this.#jobService = jobService;
  }

  /** Plans a bundle from the request body. The definition need not be saved. */
  @Post('dry-run')
  dryRun(@Body() body: BundleDryRunRequestDto): BundleDryRunResultDto {
    try {
      const config = this.#configService.getConfig();
      const name = requireName(body?.name);
      const definition = this.#validatedDefinition(name, body?.bundle, config);
      const locales = this.#validatedLocales(body?.locales, config);

      const plan = planBundle({
        bundleKey: name,
        bundleDefinition: definition,
        config,
        ...(locales && { locales }),
        cwd: process.cwd(),
      });

      return mapBundlePlanToDto(plan);
    } catch (error: unknown) {
      this.#rethrow(error, 'Error planning bundle');
    }
  }

  @Get('jobs/:jobId')
  getJob(@Param('jobId') jobId: string): BundleGenerateJobDto {
    const job = this.#jobService.getJob(jobId);

    if (job === undefined) {
      throw new NotFoundException(`Bundle job "${jobId}" not found`);
    }

    return job;
  }

  @Post()
  createBundle(@Body() body: CreateBundleDto): { message: string } {
    try {
      const config = this.#configService.getConfig();
      const name = requireName(body?.name);
      const definition = this.#validatedDefinition(name, body?.bundle, config);

      return addBundleDefinition(name, definition, { cwd: process.cwd() });
    } catch (error: unknown) {
      this.#rethrow(error, 'Error creating bundle');
    }
  }

  @Put(':name')
  updateBundle(@Param('name') name: string, @Body() body: UpdateBundleDto): { message: string } {
    try {
      const decodedName = decodeURIComponent(name);
      const config = this.#configService.getConfig();
      this.#requireExistingBundle(decodedName, config);

      const newName = typeof body?.name === 'string' && body.name.trim().length > 0 ? body.name.trim() : undefined;
      const targetName = newName ?? decodedName;
      const definition = this.#validatedDefinition(targetName, body?.bundle, config);

      if (newName !== undefined && newName !== decodedName && config.bundles?.[newName]) {
        throw new ConflictException(`Bundle "${newName}" already exists`);
      }

      return updateBundleDefinition(decodedName, definition, {
        cwd: process.cwd(),
        ...(newName !== undefined && newName !== decodedName && { newKey: newName }),
      });
    } catch (error: unknown) {
      this.#rethrow(error, 'Error updating bundle');
    }
  }

  @Delete(':name')
  deleteBundle(@Param('name') name: string): { message: string } {
    try {
      const decodedName = decodeURIComponent(name);
      const config = this.#configService.getConfig();
      this.#requireExistingBundle(decodedName, config);

      return deleteBundleDefinition(decodedName, { cwd: process.cwd() });
    } catch (error: unknown) {
      this.#rethrow(error, 'Error deleting bundle');
    }
  }

  /** Starts a generation job for a saved bundle and answers 202 with the job snapshot. */
  @Post(':name/generate')
  generateBundle(@Param('name') name: string, @Body() body: GenerateBundleRequestDto, @Res() response: Response): void {
    const decodedName = decodeURIComponent(name);
    const config = this.#configService.getConfig();
    const bundleDefinition = this.#requireExistingBundle(decodedName, config);
    const locales = this.#validatedLocales(body?.locales, config);

    const jobId = this.#jobService.startJob({
      bundleName: decodedName,
      bundleDefinition,
      config,
      ...(locales && { locales }),
    });

    const job = this.#jobService.getJob(jobId);
    response.status(HttpStatus.ACCEPTED).json(job);
  }

  #requireExistingBundle(name: string, config: LingoTrackerConfig): BundleDefinition {
    const definition = config.bundles?.[name];

    if (!definition) {
      throw new NotFoundException(`Bundle "${name}" not found`);
    }

    return definition;
  }

  /** Maps and validates a definition body; throws 400 with every message when invalid. */
  #validatedDefinition(
    name: string,
    dto: BundleDefinitionDto | undefined,
    config: LingoTrackerConfig,
  ): BundleDefinition {
    if (!dto || typeof dto !== 'object') {
      throw new HttpException(
        { message: INVALID_DEFINITION_MESSAGE, errors: ['bundle definition is required.'] },
        HttpStatus.BAD_REQUEST,
      );
    }

    const definition = mapDtoToBundleDefinition(dto);
    const errors = [...validateBundleKey(name), ...validateBundleDefinition(definition, config)];

    if (errors.length > 0) {
      throw new HttpException({ message: INVALID_DEFINITION_MESSAGE, errors }, HttpStatus.BAD_REQUEST);
    }

    return definition;
  }

  /** Accepts an optional locale subset; every entry must be a configured locale. */
  #validatedLocales(locales: readonly string[] | undefined, config: LingoTrackerConfig): string[] | undefined {
    if (locales === undefined) {
      return undefined;
    }

    if (!Array.isArray(locales) || locales.some((locale) => typeof locale !== 'string')) {
      throw new HttpException('locales must be an array of strings', HttpStatus.BAD_REQUEST);
    }

    const unknown = locales.filter((locale) => !config.locales.includes(locale));
    if (unknown.length > 0) {
      throw new HttpException(
        `Unknown locale${unknown.length > 1 ? 's' : ''} ${unknown.map((l) => `"${l}"`).join(', ')}: must be defined in the project locales`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return [...locales];
  }

  /**
   * Rethrows HTTP and typed core errors (`LingoTrackerExceptionFilter` maps the latter:
   * missing bundle 404, duplicate 409, invalid definition 400). Any other failure of a
   * bundle route answers 400.
   */
  #rethrow(error: unknown, fallback: string): never {
    if (error instanceof HttpException || error instanceof LingoTrackerError) {
      throw error;
    }
    throw new HttpException(error instanceof Error ? error.message : fallback, HttpStatus.BAD_REQUEST);
  }
}

function requireName(name: unknown): string {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new HttpException(
      { message: INVALID_DEFINITION_MESSAGE, errors: ['Bundle name is required.'] },
      HttpStatus.BAD_REQUEST,
    );
  }
  return name.trim();
}
