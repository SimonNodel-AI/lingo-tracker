import type {
  AddResourcesResult,
  Collection,
  DeleteResourceResult,
  EditResourceResult,
  MoveResult,
  TerminologyFindings,
  TranslateExistingResourceResult,
} from '@simoncodes-ca/core';
import type {
  CreateResourceResponseDto,
  DeleteResourceResponseDto,
  MoveResourceResponseDto,
  TerminologyFindingsDto,
  TranslateResourceResponseDto,
  UpdateResourceResponseDto,
} from '@simoncodes-ca/data-transfer';
import { buildResourceSummary } from '@simoncodes-ca/domain';

/** Maps a translation result, always carrying skipped locales but omitting empty warnings. */
export function mapTranslateResourceResultToDto(
  result: TranslateExistingResourceResult,
  key: string,
  collection: Collection,
): TranslateResourceResponseDto {
  return {
    resource: buildResourceSummary(key, result.entry, collection),
    skippedLocales: result.skippedLocales,
    translatedCount: result.translatedCount,
    ...(result.warnings.length > 0 && { warnings: result.warnings }),
  };
}

/** Maps a creation result, omitting empty skipped locales and empty terminology. */
export function mapCreateResourcesResultToDto(result: AddResourcesResult): CreateResourceResponseDto {
  const terminology = toTerminologyDto(result.terminology);
  return {
    entriesCreated: result.entriesCreated,
    created: result.created,
    ...(result.skippedLocales.length > 0 && { skippedLocales: result.skippedLocales }),
    ...(terminology && { terminology }),
  };
}

/** Maps an edit result, preserving present-undefined fields and omitting empty terminology. */
export function mapUpdateResourceResultToDto(
  result: EditResourceResult,
  collection: Collection,
): UpdateResourceResponseDto {
  const resource =
    result.updated && result.entry ? buildResourceSummary(result.resolvedKey, result.entry, collection) : undefined;
  const terminology = result.terminology && toTerminologyDto(result.terminology);
  return {
    resolvedKey: result.resolvedKey,
    updated: result.updated,
    message: result.message,
    resource,
    skippedLocales: result.skippedLocales,
    ...(terminology && { terminology }),
  };
}

/** Projects the public payload, excluding internal outcome; preserves present-undefined errors. */
export function mapDeleteResourceResultToDto(result: DeleteResourceResult): DeleteResourceResponseDto {
  return { entriesDeleted: result.entriesDeleted, errors: result.errors };
}

/** Projects the resource payload, excluding internal outcome and folder counts; keeps empty diagnostics. */
export function mapMoveResourcesResultToDto(result: MoveResult): Required<MoveResourceResponseDto> {
  return { movedCount: result.movedCount, warnings: result.warnings, errors: result.errors };
}

/** The advisory findings as the response carries them; undefined when there is nothing to report. */
function toTerminologyDto(terminology: TerminologyFindings): TerminologyFindingsDto | undefined {
  if (terminology.findings.length === 0 && terminology.problems.length === 0) return undefined;
  return { findings: terminology.findings.map((finding) => ({ ...finding })), problems: [...terminology.problems] };
}
