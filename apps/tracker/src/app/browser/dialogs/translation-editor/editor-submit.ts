import type {
  CreateResourceDto,
  CreateResourceResponseDto,
  ResourceSummaryDto,
  UpdateResourceDto,
  UpdateResourceResponseDto,
} from '@simoncodes-ca/data-transfer';
import { resolveResourceKey } from '@simoncodes-ca/domain';
import { catchError, map, type Observable, of } from 'rxjs';
import { ApiError } from '../../../shared/api-error/api-error';
import { doesUpdateMoveEntry } from '../../store/does-update-move-entry';
import { type ResourceEntryDraft, toCreateDto, toUpdateDto } from './resource-entry-draft';

/** The result consumed by the launcher, including the conflict hand-off owned by the dialog. */
export type EditorOutcome =
  | { kind: 'saved'; fullKey: string; skippedLocales: string[] }
  | { kind: 'moved'; fullKey: string; folderPath: string; skippedLocales: string[] }
  | { kind: 'created'; fullKey: string; skippedLocales: string[] }
  | { kind: 'open-existing'; fullKey: string }
  | { kind: 'cancelled' };

export type EditorRefusal =
  | { kind: 'conflict'; key: string; error: ApiError }
  | { kind: 'not-found'; error: ApiError }
  | { kind: 'invalid'; message: string | undefined; error: ApiError }
  | { kind: 'create-failed'; error: ApiError }
  | { kind: 'update-failed'; error: ApiError }
  | { kind: 'unexpected'; error: unknown }
  | { kind: 'missing-original' };

/** Distinguishes a write refusal from an outcome without listing outcome kinds in the dialog. */
export function isEditorRefusal(result: unknown): result is EditorRefusal {
  if (typeof result !== 'object' || result === null || !('kind' in result)) return false;
  const kind = result.kind;
  return (
    kind === 'conflict' ||
    kind === 'not-found' ||
    kind === 'invalid' ||
    kind === 'create-failed' ||
    kind === 'update-failed' ||
    kind === 'unexpected' ||
    kind === 'missing-original'
  );
}

export interface EditorWrites {
  create: (dto: CreateResourceDto) => Observable<CreateResourceResponseDto>;
  update: (dto: UpdateResourceDto) => Observable<UpdateResourceResponseDto>;
}

export interface EditorSubmitInput {
  mode: 'create' | 'edit';
  draft: ResourceEntryDraft;
  original?: ResourceSummaryDto;
  writes: EditorWrites;
}

/** Submit rules and response mapping, independent of the dialog and store instance. */
export function submitEditor({
  mode,
  draft,
  original,
  writes,
}: EditorSubmitInput): Observable<EditorOutcome | EditorRefusal> {
  if (mode === 'create') {
    const dto = toCreateDto(draft);
    return writes.create(dto).pipe(
      catchError((error: unknown) => of(classifyEditorError('create', error, dto.key))),
      map((response): EditorOutcome | EditorRefusal =>
        isEditorRefusal(response)
          ? response
          : { kind: 'created', fullKey: dto.key, skippedLocales: response.skippedLocales ?? [] },
      ),
    );
  }

  if (!original) return of({ kind: 'missing-original' });

  const dto = toUpdateDto(draft, original);
  return writes.update(dto).pipe(
    catchError((error: unknown) => of(classifyEditorError('edit', error, dto.key))),
    map((response): EditorOutcome | EditorRefusal => {
      if (isEditorRefusal(response)) return response;
      const skippedLocales = response.skippedLocales ?? [];
      if (doesUpdateMoveEntry(dto)) {
        return {
          kind: 'moved',
          fullKey: resolveResourceKey(original.entryKey, dto.moveTo),
          folderPath: dto.moveTo,
          skippedLocales,
        };
      }
      return response.updated ? { kind: 'saved', fullKey: original.fullKey, skippedLocales } : { kind: 'cancelled' };
    }),
  );
}

/** One classifier for both write operations. Presentation remains in the dialog. */
export function classifyEditorError(mode: EditorSubmitInput['mode'], error: unknown, key: string): EditorRefusal {
  if (!(error instanceof ApiError)) return { kind: 'unexpected', error };
  if (error.kind === 'conflict' && mode === 'create') return { kind: 'conflict', key, error };
  if (error.kind === 'not-found' && mode === 'edit') return { kind: 'not-found', error };
  if (error.kind === 'invalid') return { kind: 'invalid', message: error.serverMessage, error };
  return mode === 'create' ? { kind: 'create-failed', error } : { kind: 'update-failed', error };
}

export interface EditorGateState {
  readOnly: boolean;
  submitting: boolean;
  invalid: boolean;
  collision: boolean;
  needsCommentConfirmation: boolean;
}

export type EditorGateReason = 'read-only' | 'submitting' | 'invalid' | 'collision' | 'needs-comment-confirmation';

/** The first reason to stop submission, in the order the editor has always used. */
export function submitGate(state: EditorGateState): EditorGateReason | null {
  if (state.readOnly) return 'read-only';
  if (state.submitting) return 'submitting';
  if (state.invalid) return 'invalid';
  if (state.collision) return 'collision';
  if (state.needsCommentConfirmation) return 'needs-comment-confirmation';
  return null;
}
