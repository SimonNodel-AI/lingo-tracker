import type { ResourceSummaryDto } from '@simoncodes-ca/data-transfer';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiErrorKind } from '../../../shared/api-error/api-error';
import { type EditorWrites, submitEditor, submitGate } from './editor-submit';
import type { ResourceEntryDraft } from './resource-entry-draft';

const draft: ResourceEntryDraft = {
  key: 'ok',
  folderPath: 'common.buttons',
  baseValue: 'OK',
  comment: 'Button',
  tags: [],
  translations: [],
};
const original: ResourceSummaryDto = {
  fullKey: 'common.buttons.ok',
  folderPath: 'common.buttons',
  entryKey: 'ok',
  base: { locale: 'en', value: 'OK' },
  targets: [],
  tags: [],
  inheritedTags: [],
};
const writes = (): EditorWrites => ({
  create: vi.fn(() => of({ entriesCreated: 1, created: true })),
  update: vi.fn(() => of({ resolvedKey: original.fullKey, updated: true })),
});
const error = (kind: ApiErrorKind): ApiError => new ApiError({ kind, status: 400, serverMessage: 'Server message' });

describe('submitEditor outcomes', () => {
  it('creates with the request key and skipped locales', async () => {
    const fake = writes();
    fake.create = vi.fn(() => of({ entriesCreated: 1, created: true, skippedLocales: ['fr'] }));
    expect(await firstValueFrom(submitEditor({ mode: 'create', draft, writes: fake }))).toEqual({
      kind: 'created',
      fullKey: 'common.buttons.ok',
      skippedLocales: ['fr'],
    });
    expect(fake.create).toHaveBeenCalledWith(expect.objectContaining({ key: 'common.buttons.ok' }));
  });

  it('keeps an empty create skipped-locales list', async () => {
    const fake = writes();
    fake.create = vi.fn(() => of({ entriesCreated: 1, created: true, skippedLocales: [] }));
    expect(await firstValueFrom(submitEditor({ mode: 'create', draft, writes: fake }))).toMatchObject({
      skippedLocales: [],
    });
  });

  it('defaults omitted create skipped locales to an empty list', async () => {
    expect(await firstValueFrom(submitEditor({ mode: 'create', draft, writes: writes() }))).toMatchObject({
      skippedLocales: [],
    });
  });

  it('saves an unchanged-folder edit with skipped locales', async () => {
    const fake = writes();
    fake.update = vi.fn(() => of({ resolvedKey: original.fullKey, updated: true, skippedLocales: ['de'] }));
    expect(await firstValueFrom(submitEditor({ mode: 'edit', draft, original, writes: fake }))).toEqual({
      kind: 'saved',
      fullKey: original.fullKey,
      skippedLocales: ['de'],
    });
  });

  it('keeps an empty update skipped-locales list', async () => {
    const fake = writes();
    fake.update = vi.fn(() => of({ resolvedKey: original.fullKey, updated: true, skippedLocales: [] }));
    expect(await firstValueFrom(submitEditor({ mode: 'edit', draft, original, writes: fake }))).toMatchObject({
      skippedLocales: [],
    });
  });

  it('defaults omitted update skipped locales to an empty list', async () => {
    expect(await firstValueFrom(submitEditor({ mode: 'edit', draft, original, writes: writes() }))).toMatchObject({
      skippedLocales: [],
    });
  });

  it('moves to a new folder and passes skipped locales through', async () => {
    const fake = writes();
    fake.update = vi.fn(() => of({ resolvedKey: original.fullKey, updated: true, skippedLocales: ['fr'] }));
    expect(
      await firstValueFrom(
        submitEditor({ mode: 'edit', draft: { ...draft, folderPath: 'other' }, original, writes: fake }),
      ),
    ).toEqual({
      kind: 'moved',
      fullKey: 'other.ok',
      folderPath: 'other',
      skippedLocales: ['fr'],
    });
    expect(fake.update).toHaveBeenCalledWith(expect.objectContaining({ moveTo: 'other' }));
  });

  it('moves to the collection root even when the server reports no update', async () => {
    const fake = writes();
    fake.update = vi.fn(() => of({ resolvedKey: original.fullKey, updated: false }));
    expect(
      await firstValueFrom(submitEditor({ mode: 'edit', draft: { ...draft, folderPath: '' }, original, writes: fake })),
    ).toEqual({
      kind: 'moved',
      fullKey: 'ok',
      folderPath: '',
      skippedLocales: [],
    });
  });

  it('cancels when the server found nothing to change', async () => {
    const fake = writes();
    fake.update = vi.fn(() => of({ resolvedKey: original.fullKey, updated: false, skippedLocales: ['fr'] }));
    expect(await firstValueFrom(submitEditor({ mode: 'edit', draft, original, writes: fake }))).toEqual({
      kind: 'cancelled',
    });
  });

  it('refuses an edit without its original entry', async () => {
    const fake = writes();
    expect(await firstValueFrom(submitEditor({ mode: 'edit', draft, writes: fake }))).toEqual({
      kind: 'missing-original',
    });
    expect(fake.update).not.toHaveBeenCalled();
  });

  it('lets a response-mapping failure propagate instead of classifying it as a write refusal', async () => {
    const fake = writes();
    fake.create = vi.fn(() =>
      of({
        entriesCreated: 1,
        created: true,
        get skippedLocales(): string[] {
          throw new Error('Malformed response');
        },
      }),
    );
    await expect(firstValueFrom(submitEditor({ mode: 'create', draft, writes: fake }))).rejects.toThrow(
      'Malformed response',
    );
  });
});

describe('submitEditor refusals', () => {
  for (const mode of ['create', 'edit'] as const) {
    const submitFailure = (failure: unknown) => {
      const fake = writes();
      if (mode === 'create') fake.create = vi.fn(() => throwError(() => failure));
      else fake.update = vi.fn(() => throwError(() => failure));
      return firstValueFrom(submitEditor({ mode, draft, original, writes: fake }));
    };

    it(`${mode} classifies a conflict for its original presentation`, async () => {
      const failure = error('conflict');
      expect(await submitFailure(failure)).toEqual(
        mode === 'create'
          ? { kind: 'conflict', key: original.fullKey, error: failure }
          : { kind: 'update-failed', error: failure },
      );
    });

    it(`${mode} classifies not found`, async () => {
      const failure = error('not-found');
      expect(await submitFailure(failure)).toEqual(
        mode === 'edit' ? { kind: 'not-found', error: failure } : { kind: 'create-failed', error: failure },
      );
    });

    it(`${mode} passes through an invalid server message`, async () => {
      const failure = error('invalid');
      expect(await submitFailure(failure)).toEqual({ kind: 'invalid', message: 'Server message', error: failure });
    });

    it(`${mode} classifies other API failures`, async () => {
      const failure = error('other');
      expect(await submitFailure(failure)).toEqual({
        kind: mode === 'create' ? 'create-failed' : 'update-failed',
        error: failure,
      });
    });

    it(`${mode} classifies non-API failures`, async () => {
      const failure = new Error('Unexpected');
      expect(await submitFailure(failure)).toEqual({ kind: 'unexpected', error: failure });
    });
  }
});

describe('submitGate', () => {
  const blocked = { readOnly: true, submitting: true, invalid: true, collision: true, needsCommentConfirmation: true };

  it('returns read-only first', () => expect(submitGate(blocked)).toBe('read-only'));
  it('returns submitting before invalidity', () =>
    expect(submitGate({ ...blocked, readOnly: false })).toBe('submitting'));
  it('returns invalid before collision', () =>
    expect(submitGate({ ...blocked, readOnly: false, submitting: false })).toBe('invalid'));
  it('returns collision before confirmation', () =>
    expect(submitGate({ ...blocked, readOnly: false, submitting: false, invalid: false })).toBe('collision'));
  it('requests comment confirmation last', () =>
    expect(submitGate({ ...blocked, readOnly: false, submitting: false, invalid: false, collision: false })).toBe(
      'needs-comment-confirmation',
    ));
  it('allows a valid confirmed submission', () =>
    expect(
      submitGate({
        readOnly: false,
        submitting: false,
        invalid: false,
        collision: false,
        needsCommentConfirmation: false,
      }),
    ).toBeNull());
});
