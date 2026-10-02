import { createEnvironmentInjector, DestroyRef, EnvironmentInjector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { toApiError } from '../../shared/api-error/api-error';
import { submitDialogConfigWrite } from './dialog-config-submit';

describe('dialog Config Write submit', () => {
  it('locks closing and saving until success, then closes with the result', () => {
    const write = new Subject<unknown>();
    const saving = signal(false);
    const dialogRef = { disableClose: false as boolean | undefined, close: vi.fn() };
    const onRefusal = vi.fn();
    TestBed.configureTestingModule({});
    const destroyRef = TestBed.inject(DestroyRef);

    submitDialogConfigWrite({ dialogRef, write, saving, result: 'saved', destroyRef, onRefusal });
    expect(saving()).toBe(true);
    expect(dialogRef.disableClose).toBe(true);
    expect(write.observed).toBe(true);
    write.next(null);
    expect(dialogRef.close).toHaveBeenCalledWith('saved');
    expect(onRefusal).not.toHaveBeenCalled();
  });

  it('restores the previous close lock and saving state on refusal', () => {
    const write = new Subject<unknown>();
    const saving = signal(false);
    const dialogRef = { disableClose: undefined as boolean | undefined, close: vi.fn() };
    const onRefusal = vi.fn();
    TestBed.configureTestingModule({});
    const destroyRef = TestBed.inject(DestroyRef);

    submitDialogConfigWrite({ dialogRef, write, saving, result: 'saved', destroyRef, onRefusal });
    write.error(toApiError(new HttpErrorResponse({ status: 409 })));
    expect(saving()).toBe(false);
    expect(dialogRef.disableClose).toBeUndefined();
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(onRefusal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'conflict' }));
  });

  it('restores a pre-existing true close lock on refusal', () => {
    const write = new Subject<unknown>();
    const saving = signal(false);
    const dialogRef = { disableClose: true as boolean | undefined, close: vi.fn() };
    TestBed.configureTestingModule({});

    submitDialogConfigWrite({
      dialogRef,
      write,
      saving,
      result: 'saved',
      destroyRef: TestBed.inject(DestroyRef),
      onRefusal: vi.fn(),
    });
    write.error(new Error('refused'));
    expect(dialogRef.disableClose).toBe(true);
    expect(saving()).toBe(false);
  });

  it('unsubscribes on dialog destruction and leaves the close lock as it was mid-write', () => {
    const write = new Subject<unknown>();
    const saving = signal(false);
    const dialogRef = { disableClose: false as boolean | undefined, close: vi.fn() };
    const onRefusal = vi.fn();
    TestBed.configureTestingModule({});
    const injector = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));

    submitDialogConfigWrite({
      dialogRef,
      write,
      saving,
      result: 'saved',
      destroyRef: injector.get(DestroyRef),
      onRefusal,
    });
    expect(write.observed).toBe(true);
    injector.destroy();
    expect(write.observed).toBe(false);
    expect(dialogRef.disableClose).toBe(true);
    expect(saving()).toBe(true);
    write.next(null);
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(onRefusal).not.toHaveBeenCalled();
  });
});
