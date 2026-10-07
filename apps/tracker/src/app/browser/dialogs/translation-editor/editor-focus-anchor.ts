import { Directive, effect, ElementRef, inject, input } from '@angular/core';
import { EditorFocus } from './editor-focus';
import type { EditorFocusTarget } from './editor-panels';

/** Registers conditional and overlay elements with their editor's focus scope. */
@Directive({
  standalone: true,
  selector: '[editorFocusAnchor]',
})
export class EditorFocusAnchorDirective {
  readonly editorFocusAnchor = input.required<EditorFocusTarget | null>();
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly focus = inject(EditorFocus);

  constructor() {
    effect((onCleanup) => {
      const target = this.editorFocusAnchor();
      if (target === null) return;
      onCleanup(this.focus.register(target, this.element.nativeElement));
    });
  }
}
