import type { EditorFocusTarget } from './editor-panels';

/** Minimal anchor contract, also usable without an Angular view. */
export interface EditorFocusAnchor {
  focus(): void;
}

/** Resolves registered view anchors; scheduling remains with the dialog. */
export class EditorFocus {
  readonly #registered = new Map<EditorFocusTarget, { element: EditorFocusAnchor }[]>();

  /** The latest live registration wins; cleanup reveals any earlier live anchor. */
  register(target: EditorFocusTarget, element: EditorFocusAnchor): () => void {
    const stack = this.#registered.get(target) ?? [];
    const registration = { element };
    stack.push(registration);
    this.#registered.set(target, stack);
    return () => {
      const index = stack.indexOf(registration);
      if (index < 0) return;
      stack.splice(index, 1);
      if (stack.length === 0) this.#registered.delete(target);
    };
  }

  focus(target: EditorFocusTarget): void {
    const element = this.#registered.get(target)?.at(-1)?.element;
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
