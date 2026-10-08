import { Component, effect, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EditorFocus } from './editor-focus';
import { EditorFocusAnchorDirective } from './editor-focus-anchor';
import { EditorPanels, type EditorFocusTarget } from './editor-panels';

@Component({
  imports: [EditorFocusAnchorDirective],
  providers: [{ provide: EditorFocus, useFactory: () => new EditorFocus() }],
  template: `
    @if (visible()) { <input data-testid="older" [editorFocusAnchor]="target()" /> }
    @if (newerVisible()) { <input data-testid="newer" [editorFocusAnchor]="target()" /> }
  `,
})
class Host {
  readonly visible = signal(true);
  readonly newerVisible = signal(false);
  readonly target = signal<EditorFocusTarget | null>('folder-filter');
  readonly focus = inject(EditorFocus);
  readonly panels = new EditorPanels({ canOpenFolderPopover: () => true, canOpenLocalesDrawer: () => true });

  constructor() {
    effect((onCleanup) => {
      const request = this.panels.focusRequest();
      if (request === null) return;
      const timer = setTimeout(() => this.focus.focus(request.target));
      onCleanup(() => clearTimeout(timer));
    });
  }
}

describe('EditorFocusAnchorDirective', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('registers the element and unregisters it when its conditional view is destroyed', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const element = (fixture.nativeElement as HTMLElement).querySelector('input');
    expect(element).toBeDefined();
    if (element === null) return;
    const focus = vi.spyOn(element, 'focus');
    fixture.componentInstance.focus.focus('folder-filter');
    expect(focus).toHaveBeenCalledTimes(1);
    fixture.componentInstance.visible.set(false);
    fixture.detectChanges();
    fixture.componentInstance.focus.focus('folder-filter');
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('moves its registration when the target changes and removes it for a null target', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const element = (fixture.nativeElement as HTMLElement).querySelector('input');
    if (element === null) throw new Error('Missing focus anchor');
    const focus = vi.spyOn(element, 'focus');
    fixture.componentInstance.target.set('key');
    fixture.detectChanges();
    fixture.componentInstance.focus.focus('folder-filter');
    expect(focus).not.toHaveBeenCalled();
    fixture.componentInstance.focus.focus('key');
    expect(focus).toHaveBeenCalledTimes(1);
    fixture.componentInstance.target.set(null);
    fixture.detectChanges();
    fixture.componentInstance.focus.focus('key');
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('lands a deferred focus request on an element rendered after the request', () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(Host);
    const host = fixture.componentInstance;
    host.visible.set(false);
    fixture.detectChanges();
    host.panels.openFolderPopover();
    host.visible.set(true);
    fixture.detectChanges();
    const element = (fixture.nativeElement as HTMLElement).querySelector('input');
    if (element === null) throw new Error('Missing focus anchor');
    const focus = vi.spyOn(element, 'focus');
    expect(focus).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(focus).toHaveBeenCalledOnce();
  });

  it('unregisters the element when the host is destroyed', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const element = (fixture.nativeElement as HTMLElement).querySelector('input');
    if (element === null) throw new Error('Missing focus anchor');
    const focus = vi.spyOn(element, 'focus');
    const registry = fixture.componentInstance.focus;
    fixture.destroy();
    registry.focus('folder-filter');
    expect(focus).not.toHaveBeenCalled();
  });

  it('focuses the latest live anchor and restores the older one when the newer view is destroyed', () => {
    const fixture = TestBed.createComponent(Host);
    const host = fixture.componentInstance;
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const older = root.querySelector<HTMLInputElement>('[data-testid="older"]');
    if (older === null) throw new Error('Missing older focus anchor');
    const focusOlder = vi.spyOn(older, 'focus');

    host.newerVisible.set(true);
    fixture.detectChanges();
    const newer = root.querySelector<HTMLInputElement>('[data-testid="newer"]');
    if (newer === null) throw new Error('Missing newer focus anchor');
    const focusNewer = vi.spyOn(newer, 'focus');
    host.focus.focus('folder-filter');
    expect(focusNewer).toHaveBeenCalledOnce();
    expect(focusOlder).not.toHaveBeenCalled();

    host.newerVisible.set(false);
    fixture.detectChanges();
    host.focus.focus('folder-filter');
    expect(focusOlder).toHaveBeenCalledOnce();
    expect(focusNewer).toHaveBeenCalledOnce();

    host.newerVisible.set(true);
    fixture.detectChanges();
    const replacement = root.querySelector<HTMLInputElement>('[data-testid="newer"]');
    if (replacement === null) throw new Error('Missing replacement focus anchor');
    const focusReplacement = vi.spyOn(replacement, 'focus');
    host.visible.set(false);
    fixture.detectChanges();
    host.focus.focus('folder-filter');
    expect(focusReplacement).toHaveBeenCalledOnce();
    expect(focusOlder).toHaveBeenCalledOnce();
  });
});
