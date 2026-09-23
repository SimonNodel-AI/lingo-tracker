import { CollectionNotFoundError } from '@simoncodes-ca/core';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { exitWithError, PromptCancelledError } from './report-error';

describe('exitWithError', () => {
  let log: MockInstance;
  let exit: MockInstance;

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the error message and exits with code 1', () => {
    exitWithError(new Error('Output directory is not writable.'));

    expect(log).toHaveBeenCalledWith('❌ Output directory is not writable.');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('prints a typed core error by its message', () => {
    exitWithError(new CollectionNotFoundError('app'));

    expect(log).toHaveBeenCalledWith('❌ Collection "app" not found');
  });

  it('adds the prefix and stringifies a non-Error value', () => {
    exitWithError('boom', 'Translation failed: ');

    expect(log).toHaveBeenCalledWith('❌ Translation failed: boom');
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('PromptCancelledError', () => {
  it('keeps the "<operation> cancelled" message and the operation', () => {
    const error = new PromptCancelledError('Import');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PromptCancelledError');
    expect(error.message).toBe('Import cancelled');
    expect(error.operation).toBe('Import');
  });
});
