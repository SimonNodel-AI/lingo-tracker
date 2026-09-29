import { basename } from 'node:path';
import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common';
import {
  loadPreferredTerminology,
  PreferredTerminologyValidationError,
  resolvePreferredTerminologyFilePath,
  resolveProtectedTermsForConfig,
  setGlobalProtectedTerms,
  writePreferredTerminology,
} from '@simoncodes-ca/core';
import type { LingoTrackerConfigDto, UpdateConfigDto } from '@simoncodes-ca/data-transfer';
import { validatePreferredTermRules } from '@simoncodes-ca/domain';
import { mapConfigToDto, mapDtoToConfigUpdate } from '../mappers/config.mapper';
import { ConfigService } from './config.service';

@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getConfig(): LingoTrackerConfigDto {
    const config = this.configService.getConfig();
    const cwd = process.cwd();
    return mapConfigToDto(
      config,
      resolveProtectedTermsForConfig(config),
      basename(cwd),
      loadPreferredTerminology(config, cwd),
    );
  }

  /**
   * Updates supported top-level config fields. Only the fields carried by
   * `UpdateConfigDto` are writable — `collections`, `locales`, and `baseLocale`
   * are never touched by this endpoint.
   *
   * Every submitted field is validated before anything is written, so a bad
   * preferred-terminology list never lands alongside a half-applied protected-terms
   * change. Invalid rules throw `PreferredTerminologyValidationError`, which the global
   * exception filter answers with 400 and `{ message, errors }`, `errors` indexed by row
   * of the submitted list. Other core errors (a missing directory, for example) reach the
   * filter too.
   */
  @Put()
  updateConfig(@Body() dto: UpdateConfigDto): { message: string } {
    const protectedTerms = dto?.protectedTerms;
    if (
      protectedTerms !== undefined &&
      (!Array.isArray(protectedTerms) || protectedTerms.some((t) => typeof t !== 'string'))
    ) {
      throw new BadRequestException('protectedTerms must be an array of strings');
    }

    const preferredTerminology: unknown = dto?.preferredTerminology;
    if (preferredTerminology !== undefined) {
      if (!Array.isArray(preferredTerminology)) {
        throw new BadRequestException('preferredTerminology must be an array of rules');
      }
      const ruleErrors = validatePreferredTermRules(preferredTerminology);
      if (ruleErrors.length > 0) {
        throw new PreferredTerminologyValidationError(ruleErrors);
      }
    }

    const update = mapDtoToConfigUpdate(dto ?? {});
    if (update.preferredTerminology !== undefined) {
      const filePath = resolvePreferredTerminologyFilePath(this.configService.getConfig(), process.cwd());
      writePreferredTerminology(filePath, update.preferredTerminology);
    }
    if (update.protectedTerms !== undefined) {
      setGlobalProtectedTerms(update.protectedTerms);
    }
    return { message: 'Configuration updated successfully' };
  }
}
