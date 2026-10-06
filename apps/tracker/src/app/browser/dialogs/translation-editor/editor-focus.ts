import type { EditorFocusTarget } from './editor-panels';

/** Minimal anchor contract, also usable without an Angular view. */
export interface EditorFocusAnchor {
  focus(): void;
}

/** Lazy anchors follow conditional views as they appear and disappear. */
export type EditorFocusAnchors = Record<EditorFocusTarget, () => EditorFocusAnchor | undefined>;

/** Resolves a named focus intent; scheduling remains with the dialog. */
export class EditorFocus {
  constructor(private readonly anchors: EditorFocusAnchors) {}

  focus(target: EditorFocusTarget): void {
    const element = this.anchors[target]();
    if (!element) return;
    element.focus();
    if (target === 'comment' && element instanceof HTMLTextAreaElement) {
      // The field may be below the fold on a scrolled form.
      element.scrollIntoView?.({ block: 'nearest' });
      // Select existing text for a rewrite, or park the caret in an empty field.
      element.setSelectionRange(0, element.value.length);
    }
  }
}
