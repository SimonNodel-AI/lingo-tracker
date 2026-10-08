import { describe, expect, it, vi } from 'vitest';
import { EditorFocus } from './editor-focus';
import type { EditorFocusTarget } from './editor-panels';

describe('EditorFocus', () => {
  it('focuses only the anchor registered for each target', () => {
    const focus = new EditorFocus();
    const targets: EditorFocusTarget[] = [
      'key',
      'base-value',
      'comment',
      'location-pill',
      'locales-row',
      'folder-filter',
      'drawer-first-control',
    ];
    const fakes = targets.map(() => ({ focus: vi.fn() }));
    targets.forEach((target, index) => {
      const element = fakes[index];
      if (element) focus.register(target, element);
    });
    targets.forEach((target, index) => {
      focus.focus(target);
      fakes.forEach((fake, other) => {
        expect(fake.focus).toHaveBeenCalledTimes(other <= index ? 1 : 0);
      });
    });
  });

  it('ignores anchors that are not rendered', () => {
    const focus = new EditorFocus();
    expect(() => focus.focus('folder-filter')).not.toThrow();
  });

  it('resolves the current anchor after conditional views change', () => {
    const focus = new EditorFocus();
    focus.focus('drawer-first-control');
    const first = { focus: vi.fn() };
    const removeFirst = focus.register('drawer-first-control', first);
    focus.focus('drawer-first-control');
    removeFirst();
    const replacement = { focus: vi.fn() };
    const removeReplacement = focus.register('drawer-first-control', replacement);
    focus.focus('drawer-first-control');
    removeReplacement();
    focus.focus('drawer-first-control');
    expect(first.focus).toHaveBeenCalledTimes(1);
    expect(replacement.focus).toHaveBeenCalledTimes(1);
  });

  it('focuses, reveals and selects all existing comment text in order', () => {
    const comment = document.createElement('textarea');
    comment.value = 'Translator context';
    const calls: string[] = [];
    vi.spyOn(comment, 'focus').mockImplementation(() => calls.push('focus'));
    comment.scrollIntoView = vi.fn(() => calls.push('scroll'));
    const select = vi.spyOn(comment, 'setSelectionRange').mockImplementation(() => calls.push('select'));
    const focus = new EditorFocus();
    focus.register('comment', comment);
    focus.focus('comment');
    expect(calls).toEqual(['focus', 'scroll', 'select']);
    expect(comment.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(select).toHaveBeenCalledWith(0, comment.value.length);
  });

  it('parks the caret in an empty comment even without scrollIntoView', () => {
    const comment = document.createElement('textarea');
    const select = vi.spyOn(comment, 'setSelectionRange');
    const focus = new EditorFocus();
    focus.register('comment', comment);
    focus.focus('comment');
    expect(select).toHaveBeenCalledWith(0, 0);
  });

  it('does not select textarea contents for other targets', () => {
    const value = document.createElement('textarea');
    const select = vi.spyOn(value, 'setSelectionRange');
    const focus = new EditorFocus();
    focus.register('base-value', value);
    focus.focus('base-value');
    expect(select).not.toHaveBeenCalled();
  });
});
