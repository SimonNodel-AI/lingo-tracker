import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { EMPTY, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { injectConfirm } from './confirm';

describe('confirm', () => {
  it.each([true, false, undefined])('resolves only explicit true for %s', async (answer) => {
    const open = vi.fn().mockReturnValue({ afterClosed: () => of(answer) });
    TestBed.configureTestingModule({ providers: [{ provide: MatDialog, useValue: { open } }] });
    const confirm = TestBed.runInInjectionContext(() => injectConfirm());
    const data = { title: 'Title', message: 'Message', actionType: 'destructive' as const };

    await expect(confirm(data, { width: '400px' })).resolves.toBe(answer === true);
    expect(open).toHaveBeenCalledWith(expect.any(Function), { data, width: '400px' });
    expect(open.mock.calls[0][1].data).toBe(data);
  });

  it('keeps a stale session from opening the dialog', async () => {
    const open = vi.fn();
    TestBed.configureTestingModule({ providers: [{ provide: MatDialog, useValue: { open } }] });
    const confirm = TestBed.runInInjectionContext(() => injectConfirm());
    await expect(confirm({ title: 'Title', message: 'Message' }, { canOpen: () => false })).resolves.toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('passes the close lock through to the dialog', async () => {
    const open = vi.fn().mockReturnValue({ afterClosed: () => of(true) });
    TestBed.configureTestingModule({ providers: [{ provide: MatDialog, useValue: { open } }] });
    const confirm = TestBed.runInInjectionContext(() => injectConfirm());
    const data = { title: 'Title', message: 'Message' };

    await expect(confirm(data, { width: '440px', disableClose: true })).resolves.toBe(true);
    expect(open.mock.calls[0][1]).toEqual({ data, width: '440px', disableClose: true });
  });

  it('resolves false when afterClosed completes without an answer', async () => {
    const open = vi.fn().mockReturnValue({ afterClosed: () => EMPTY });
    TestBed.configureTestingModule({ providers: [{ provide: MatDialog, useValue: { open } }] });
    const confirm = TestBed.runInInjectionContext(() => injectConfirm());

    await expect(confirm({ title: 'Title', message: 'Message' })).resolves.toBe(false);
  });
});
