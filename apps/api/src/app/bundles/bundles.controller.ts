import { Body, Controller, Delete, Get, HttpStatus, NotFoundException, Param, Post, Put, Res } from '@nestjs/common';
import {
  addBundleDefinition,
  deleteBundleDefinition,
  InvalidBundleDefinitionError,
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
import type { BundleDefinition } from '@simoncodes-ca/domain';
import type { Response } from 'express';
import { ConfigService } from '../config/config.service';
import { mapBundlePlanToDto } from '../mappers/bundle.mapper';
import { BundleJobService } from './bundle-job.service';

/**
 * Bundle definitions are checked by the domain Bundle Definition rules: core's add/update
 * operations normalise and validate them, and the dry run delegates the same rules to core.
 * Invalid, missing and duplicate bundles surface as typed core errors that
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
    const plan = planBundle({
      bundleKey: nameOf(body?.name),
      bundleDefinition: body?.bundle,
      config: this.#configService.getConfig(),
      ...(body?.locales !== undefined && { locales: body.locales }),
      cwd: process.cwd(),
    });
    return mapBundlePlanToDto(plan);
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
    return addBundleDefinition(nameOf(body?.name), requireDefinition(body?.bundle), { cwd: process.cwd() });
  }

  @Put(':name')
  updateBundle(@Param('name') name: string, @Body() body: UpdateBundleDto): { message: string } {
    const newName = typeof body?.name === 'string' && body.name.trim().length > 0 ? body.name : undefined;

    return updateBundleDefinition(name, requireDefinition(body?.bundle), {
      cwd: process.cwd(),
      ...(newName !== undefined && { newKey: newName }),
    });
  }

  @Delete(':name')
  deleteBundle(@Param('name') name: string): { message: string } {
    return deleteBundleDefinition(name, { cwd: process.cwd() });
  }

  /** Starts a generation job for a saved bundle and answers 202 with the job snapshot. */
  @Post(':name/generate')
  generateBundle(@Param('name') name: string, @Body() body: GenerateBundleRequestDto, @Res() response: Response): void {
    const config = this.#configService.getConfig();

    const jobId = this.#jobService.startJob({
      bundleName: name,
      config,
      ...(body?.locales && { locales: body.locales }),
    });

    const job = this.#jobService.getJob(jobId);
    response.status(HttpStatus.ACCEPTED).json(job);
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
