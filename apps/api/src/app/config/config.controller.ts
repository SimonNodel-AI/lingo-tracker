import { basename } from 'node:path';
import { Body, Controller, Get, Put } from '@nestjs/common';
import { loadPreferredTerminology, resolveProtectedTermsForConfig, updateProjectTerms } from '@simoncodes-ca/core';
import type { LingoTrackerConfigDto, UpdateConfigDto } from '@simoncodes-ca/data-transfer';
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
    const update = mapDtoToConfigUpdate(dto ?? {});
    if (update.protectedTerms === undefined && update.preferredTerminology === undefined) {
      return { message: 'Configuration updated successfully' };
    }
    updateProjectTerms(this.configService.openProject(), {
      ...(update.protectedTerms !== undefined && { protectedTerms: { replace: update.protectedTerms } }),
      ...(update.preferredTerminology !== undefined && {
        preferredTerminology: { set: update.preferredTerminology },
      }),
    });
    return { message: 'Configuration updated successfully' };
  }
}
