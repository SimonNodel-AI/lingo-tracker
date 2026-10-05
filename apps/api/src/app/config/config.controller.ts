import { Controller, Get, Put } from '@nestjs/common';
import { ProtectedTermsFileError, readProjectTermsView, updateProjectTerms } from '@simoncodes-ca/core';
import type { LingoTrackerConfigDto, UpdateConfigDto } from '@simoncodes-ca/data-transfer';
import { mapConfigToDto, mapDtoToConfigUpdate } from '../mappers/config.mapper';
import { ConfigService } from './config.service';
import { updateConfigBody } from '../validation/dto-schemas';
import { ValidBody } from '../validation/valid-body';

@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getConfig(): LingoTrackerConfigDto {
    const snapshot = readProjectTermsView(this.configService.openProject());
    const broken = snapshot.problems.find(
      (problem) => problem.file === 'protected-terms' && problem.severity === 'error',
    );
    if (broken !== undefined) throw new ProtectedTermsFileError(broken.filePath, broken.message);
    return mapConfigToDto(snapshot);
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
  updateConfig(@ValidBody(updateConfigBody) dto: UpdateConfigDto | undefined): { message: string } {
    const update = mapDtoToConfigUpdate(dto ?? {});
    if (update.protectedTerms === undefined && update.preferredTerminology === undefined) {
      return { message: 'Configuration updated successfully' };
    }
    updateProjectTerms(this.configService.openProject(), {
      ...(update.protectedTerms !== undefined && {
        protectedTerms: { target: {}, change: { kind: 'replace', replace: update.protectedTerms } },
      }),
      ...(update.preferredTerminology !== undefined && {
        preferredTerminology: { set: update.preferredTerminology },
      }),
    });
    return { message: 'Configuration updated successfully' };
  }
}
