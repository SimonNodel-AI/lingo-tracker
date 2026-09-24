import {
  Body,
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
import type { LingoTrackerConfig } from '@simoncodes-ca/core';
import {
  addBundleDefinition,
  BundleNotFoundError,
  deleteBundleDefinition,
  InvalidBundleDefinitionError,
  LingoTrackerError,
  planBundle,
  updateBundleDefinition,
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
import { type BundleDefinition, checkBundleDefinition, findBundleDefinition } from '@simoncodes-ca/domain';
import type { Response } from 'express';
import { ConfigService } from '../config/config.service';
import { mapBundlePlanToDto } from '../mappers/bundle.mapper';
import { BundleJobService } from './bundle-job.service';

/**
 * Bundle definitions are checked by the domain Bundle Definition rules: core's add/update
 * operations normalise and validate them, and the dry run (which writes nothing) runs the
 * same rules here. Invalid, missing and duplicate bundles surface as typed core errors that
 * `LingoTrackerExceptionFilter` maps to 400 (with `errors`), 404 and 409.
 */
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
      const name = nameOf(body?.name);
      const definition = validatedDefinition(name, body?.bundle, config);
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
      return addBundleDefinition(nameOf(body?.name), requireDefinition(body?.bundle), { cwd: process.cwd() });
    } catch (error: unknown) {
      this.#rethrow(error, 'Error creating bundle');
    }
  }

  @Put(':name')
  updateBundle(@Param('name') name: string, @Body() body: UpdateBundleDto): { message: string } {
    try {
      const newName = typeof body?.name === 'string' && body.name.trim().length > 0 ? body.name : undefined;

      return updateBundleDefinition(decodeURIComponent(name), requireDefinition(body?.bundle), {
        cwd: process.cwd(),
        ...(newName !== undefined && { newKey: newName }),
      });
    } catch (error: unknown) {
      this.#rethrow(error, 'Error updating bundle');
    }
  }

  @Delete(':name')
  deleteBundle(@Param('name') name: string): { message: string } {
    try {
      return deleteBundleDefinition(decodeURIComponent(name), { cwd: process.cwd() });
    } catch (error: unknown) {
      this.#rethrow(error, 'Error deleting bundle');
    }
  }

  /** Starts a generation job for a saved bundle and answers 202 with the job snapshot. */
  @Post(':name/generate')
  generateBundle(@Param('name') name: string, @Body() body: GenerateBundleRequestDto, @Res() response: Response): void {
    const decodedName = decodeURIComponent(name);
    const config = this.#configService.getConfig();
    const bundleDefinition = findBundleDefinition(config.bundles, decodedName);
    if (!bundleDefinition) {
      throw new BundleNotFoundError(decodedName);
    }
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

/** The trimmed name, or `''` (which the key rule reports as required) when it is not a string. */
function nameOf(name: unknown): string {
  return typeof name === 'string' ? name.trim() : '';
}

function requireDefinition(dto: BundleDefinitionDto | undefined): BundleDefinition {
  if (!dto || typeof dto !== 'object') {
    throw new InvalidBundleDefinitionError(['bundle definition is required.']);
  }
  return dto;
}

/** The domain `checkBundleDefinition`, as core's add/update operations run it; throws every problem at once. */
function validatedDefinition(
  name: string,
  dto: BundleDefinitionDto | undefined,
  config: LingoTrackerConfig,
): BundleDefinition {
  const { definition, errors } = checkBundleDefinition(
    requireDefinition(dto),
    Object.keys(config.collections ?? {}),
    name,
  );

  if (errors.length > 0) {
    throw new InvalidBundleDefinitionError(errors);
  }

  return definition;
}
