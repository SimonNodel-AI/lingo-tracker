import type { ResourceSummaryDto } from '@simoncodes-ca/data-transfer';
import { EMPTY, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../shared/api-error/api-error';
import { EditorSubmitSession, type EditorSubmitTrigger } from './editor-submit';

const input: EditorSubmitTrigger = {
  mode: 'create',
  draft: { key: ' ok ', folderPath: 'common', baseValue: 'OK', comment: 'Context', tags: [], translations: [] },
  readOnly: false,
  invalid: false,
  collision: false,
};

const original: ResourceSummaryDto = {
  fullKey: 'common.ok',
  folderPath: 'common',
  entryKey: 'ok',
  base: { locale: 'en', value: 'OK' },
  targets: [],
  tags: [],
  inheritedTags: [],
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function session(overrides: Partial<ConstructorParameters<typeof EditorSubmitSession>[0]> = {}) {
  const create = vi.fn(() => of({ entriesCreated: 1, created: true }));
  const update = vi.fn(() => of({ resolvedKey: 'common.ok', updated: true }));
  const confirmMissingComment = vi.fn(async () => true);
  const chooseConflict = vi.fn(async () => false);
  const onWriteStart = vi.fn();
  return {
    submit: new EditorSubmitSession({
      writes: { create, update },
      confirmMissingComment,
      chooseConflict,
      onWriteStart,
      ...overrides,
    }),
    create,
    update,
    confirmMissingComment,
    chooseConflict,
    onWriteStart,
  };
}

describe('EditorSubmitSession', () => {
  it('ignores a second trigger while the missing-comment confirmation is pending', async () => {
    const confirmation = deferred<boolean>();
    const harness = session({ confirmMissingComment: vi.fn(() => confirmation.promise) });
    const withoutComment = { ...input, draft: { ...input.draft, comment: '' } };
    const first = harness.submit.trigger(withoutComment);

    expect(harness.submit.phase()).toBe('confirming-comment');
    expect(await harness.submit.trigger(withoutComment)).toEqual({ kind: 'ignored' });
    confirmation.resolve(true);
    expect(await first).toMatchObject({ kind: 'outcome' });
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.create).toHaveBeenCalledWith(expect.objectContaining({ key: 'common.ok' }));
  });

  it('ignores a trigger during a write', async () => {
    const response = new Subject<{ entriesCreated: number; created: boolean }>();
    const harness = session({ writes: { create: vi.fn(() => response), update: vi.fn() } });
    const first = harness.submit.trigger(input);

    expect(harness.submit.phase()).toBe('writing');
    expect(harness.submit.isSubmitting()).toBe(true);
    expect(await harness.submit.trigger(input)).toEqual({ kind: 'ignored' });
    response.next({ entriesCreated: 1, created: true });
    response.complete();
    expect(await first).toMatchObject({ kind: 'outcome' });
    expect(harness.submit.phase()).toBe('done');
    expect(harness.submit.isSubmitting()).toBe(true);
    expect(await harness.submit.trigger(input)).toEqual({ kind: 'ignored' });
  });

  it('remembers Save Anyway after a refused write', async () => {
    const failure = new ApiError({ kind: 'other', status: 503 });
    const create = vi
      .fn()
      .mockReturnValueOnce(throwError(() => failure))
      .mockReturnValueOnce(of({ entriesCreated: 1, created: true }));
    const harness = session({ writes: { create, update: vi.fn() } });
    const withoutComment = { ...input, draft: { ...input.draft, comment: '' } };

    expect(await harness.submit.trigger(withoutComment)).toMatchObject({ kind: 'message', message: 'create-failed' });
    expect(await harness.submit.trigger(withoutComment)).toMatchObject({ kind: 'outcome' });
    expect(harness.confirmMissingComment).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('allows the comment prompt again after Add Comment', async () => {
    const confirmMissingComment = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const harness = session({ confirmMissingComment });
    const withoutComment = { ...input, draft: { ...input.draft, comment: '' } };

    expect(await harness.submit.trigger(withoutComment)).toEqual({ kind: 'focus-comment' });
    expect(await harness.submit.trigger(withoutComment)).toMatchObject({ kind: 'outcome' });
    expect(confirmMissingComment).toHaveBeenCalledTimes(2);
  });

  it('opens one conflict prompt for repeated triggers on a known collision', async () => {
    const choice = deferred<boolean>();
    const chooseConflict = vi.fn(() => choice.promise);
    const harness = session({ chooseConflict });
    const first = harness.submit.trigger({ ...input, collision: true });

    expect(harness.submit.phase()).toBe('choosing-conflict');
    expect(await harness.submit.trigger({ ...input, collision: true })).toEqual({ kind: 'ignored' });
    expect(chooseConflict).toHaveBeenCalledTimes(1);
    expect(chooseConflict).toHaveBeenCalledWith('common.ok');
    choice.resolve(false);
    expect(await first).toEqual({ kind: 'ignored' });
    expect(harness.submit.phase()).toBe('idle');
    expect(harness.create).not.toHaveBeenCalled();
  });

  it('keeps a server conflict in the same session until the choice resolves', async () => {
    const choice = deferred<boolean>();
    const chooseConflict = vi.fn(() => choice.promise);
    const failure = new ApiError({ kind: 'conflict', status: 409 });
    const harness = session({
      writes: { create: vi.fn(() => throwError(() => failure)), update: vi.fn() },
      chooseConflict,
    });
    const first = harness.submit.trigger(input);
    await vi.waitFor(() => expect(harness.submit.phase()).toBe('choosing-conflict'));

    expect(await harness.submit.trigger(input)).toEqual({ kind: 'ignored' });
    expect(chooseConflict).toHaveBeenCalledTimes(1);
    choice.resolve(true);
    expect(await first).toEqual({ kind: 'outcome', outcome: { kind: 'open-existing', fullKey: 'common.ok' } });
    expect(harness.submit.isSubmitting()).toBe(true);
  });

  it('shows an unexpected message and returns to idle when a write completes empty', async () => {
    const harness = session({ writes: { create: vi.fn(() => EMPTY), update: vi.fn() } });

    expect(await harness.submit.trigger(input)).toEqual({ kind: 'message', message: 'unexpected' });
    expect(harness.submit.phase()).toBe('idle');
    expect(harness.submit.isSubmitting()).toBe(false);
  });

  it('shows an unexpected message and returns to idle when a prompt rejects', async () => {
    const confirmMissingComment = vi.fn(async () => {
      throw new Error('Confirmation failed');
    });
    const harness = session({ confirmMissingComment });

    expect(await harness.submit.trigger({ ...input, draft: { ...input.draft, comment: '' } })).toEqual({
      kind: 'message',
      message: 'unexpected',
    });
    expect(harness.submit.phase()).toBe('idle');
    expect(harness.submit.isSubmitting()).toBe(false);
    expect(harness.create).not.toHaveBeenCalled();
  });

  it('shows an unexpected message and returns to idle when the conflict prompt rejects', async () => {
    const chooseConflict = vi.fn(async () => {
      throw new Error('Conflict prompt failed');
    });
    const harness = session({ chooseConflict });

    expect(await harness.submit.trigger({ ...input, collision: true })).toEqual({
      kind: 'message',
      message: 'unexpected',
    });
    expect(harness.submit.phase()).toBe('idle');
    expect(harness.submit.isSubmitting()).toBe(false);
  });

  it('maps each refusal to the dialog decision', async () => {
    const cases = [
      { mode: 'create', error: 'invalid', message: 'invalid-request' },
      { mode: 'create', error: 'not-found', message: 'create-failed' },
      { mode: 'create', error: 'other', message: 'create-failed' },
      { mode: 'edit', error: 'not-found', message: 'not-found' },
      { mode: 'edit', error: 'invalid', message: 'invalid-request' },
      { mode: 'edit', error: 'conflict', message: 'update-failed' },
      { mode: 'edit', error: 'other', message: 'update-failed' },
    ] as const;

    for (const testCase of cases) {
      const failure = new ApiError({ kind: testCase.error, status: 400 });
      const writes = { create: vi.fn(() => throwError(() => failure)), update: vi.fn(() => throwError(() => failure)) };
      const harness = session({ writes });
      expect(await harness.submit.trigger({ ...input, mode: testCase.mode, original })).toEqual({
        kind: 'message',
        message: testCase.message,
        ...(testCase.message === 'not-found' ? {} : { error: failure }),
      });
    }

    const unexpected = new Error('offline');
    const harness = session({ writes: { create: vi.fn(() => throwError(() => unexpected)), update: vi.fn() } });
    expect(await harness.submit.trigger(input)).toEqual({ kind: 'message', message: 'unexpected' });
    expect(await session().submit.trigger({ ...input, mode: 'edit' })).toEqual({
      kind: 'message',
      message: 'missing-resource',
    });
  });

  it('returns validation focus before prompts or writes', async () => {
    const harness = session();
    expect(await harness.submit.trigger({ ...input, invalid: true, collision: true })).toEqual({ kind: 'invalid' });
    expect(harness.chooseConflict).not.toHaveBeenCalled();
    expect(harness.create).not.toHaveBeenCalled();
  });
});
