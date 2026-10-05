import { describe, expect, it, vi } from 'vitest';
import { EditorFocus, type EditorFocusAnchor, type EditorFocusAnchors } from './editor-focus';

function anchors(): EditorFocusAnchors {
  return {
    key: () => undefined,
    'base-value': () => undefined,
    comment: () => undefined,
    'location-pill': () => undefined,
    'locales-row': () => undefined,
    'folder-filter': () => undefined,
    'drawer-first-control': () => undefined,
  };
}

describe('EditorFocus', () => {
  it('focuses only the anchor registered for each target', () => {
    const registered = anchors();
    const targets = Object.keys(registered) as (keyof EditorFocusAnchors)[];
    const fakes = targets.map(() => ({ focus: vi.fn() }));
    targets.forEach((target, index) => {
      registered[target] = () => fakes[index];
    });
    const focus = new EditorFocus(registered);
    targets.forEach((target, index) => {
      focus.focus(target);
      fakes.forEach((fake, other) => {
        expect(fake.focus).toHaveBeenCalledTimes(other <= index ? 1 : 0);
      });
    });
  });

  it('ignores anchors that are not rendered', () => {
    const focus = new EditorFocus(anchors());
    expect(() => focus.focus('folder-filter')).not.toThrow();
  });

  it('resolves the current anchor after conditional views change', () => {
    const registered = anchors();
    let current: EditorFocusAnchor | undefined;
    registered['drawer-first-control'] = () => current;
    const focus = new EditorFocus(registered);
    focus.focus('drawer-first-control');
    const first = { focus: vi.fn() };
    current = first;
    focus.focus('drawer-first-control');
    const replacement = { focus: vi.fn() };
    current = replacement;
    focus.focus('drawer-first-control');
    current = undefined;
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
    const registered = anchors();
    registered.comment = () => comment;
    new EditorFocus(registered).focus('comment');
    expect(calls).toEqual(['focus', 'scroll', 'select']);
    expect(comment.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(select).toHaveBeenCalledWith(0, comment.value.length);
  });

  it('parks the caret in an empty comment even without scrollIntoView', () => {
    const comment = document.createElement('textarea');
    const select = vi.spyOn(comment, 'setSelectionRange');
    const registered = anchors();
    registered.comment = () => comment;
    new EditorFocus(registered).focus('comment');
    expect(select).toHaveBeenCalledWith(0, 0);
  });

  it('does not select textarea contents for other targets', () => {
    const value = document.createElement('textarea');
    const select = vi.spyOn(value, 'setSelectionRange');
    const registered = anchors();
    registered['base-value'] = () => value;
    new EditorFocus(registered).focus('base-value');
    expect(select).not.toHaveBeenCalled();
  });
});
