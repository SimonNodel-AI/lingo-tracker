---
version: 1
slug: "ion-editor-translation-editor-dialog-html-07d62026"
primary_target: "apps/tracker/src/app/browser/dialogs/translation-editor/translation-editor-dialog.html"
related_targets: ["apps/tracker/src/app/browser/dialogs/translation-editor/translation-editor-dialog.ts","apps/tracker/src/app/browser/dialogs/translation-editor/translation-editor-dialog.scss"]
---

# Surface: Translation editor dialog (create / edit resource)

Scope: redesign of `apps/tracker/src/app/browser/dialogs/translation-editor/`, opened from "Add Translation" in the browser header and from a translation row's edit action. Mode: **Operate**. Existing surface inside the established world; converges on the collection/bundle dialog anatomy (coral top rule, header tile, one-line subtitle, hairlines, footer validity line + Cancel + primary) and drops Material outline fields and Material tabs.

Audience and job: the developer mid-feature adding or fixing one key, then a translator/reviewer editing locale values and statuses. The dialog must always show where the entry lands (folder + full key), let the user move it without leaving, warn about duplicate values and colliding keys before save, and keep other-locale editing one step away.

Content: location (folder path, changeable, folder creation), key (single segment, locked in edit), English base value, similar existing values (debounced search, appear-on-match, pinned until the value changes; hidden in edit until the value is edited), live key-collision state with "Open existing", other locales (value; status select in edit; auto-translation note in create), comment and tags inline at full weight (comment is near-required: saving without one prompts a confirmation; inherited collection tags read-only).

Constraints: every string via Transloco resources. Key renaming unsupported (Move lives in the list). Read-only collections: inputs disabled, no primary. The 409 path stays as a fallback. Width up to ~1000px with a collapse below ~1100px viewport; <640px stays full-screen. Escape guard and Ctrl+Enter save unchanged.

## Direction

Chosen: **B — Editor with context column** (`.impeccable/mocks/resource-dialog/b-context.html`, sidecar `b-context.json` approved: true; approved comps `b-context-create-light.png` and `b-context-edit-light.png`). User amendment: comment and tags stay inline, never behind a disclosure. The three comps considered (see the mocks folder's `brief.md`):
- A `a-focused.html`: 640px single column, editable breadcrumb location with autocomplete, full-width result line, amber similar strip, disclosure rows for Other locales and Details.
- B `b-context.html`: 980px editor + 320px context column (mini tree with the new/editing entry, full key + availability, pinned similar values, locale summary); popover tree for location; drawer for other locales.
- C `c-rail.html`: 1000px sections rail (Location & key / English value / Other locales / Details) with per-section summaries and error dots; persistent folder tree in the Location pane.

No concept-seed roll: the three structures were fixed in the user interview. A and C are declined.

## Unresolved for the build round
- Similar-search contract: keep the 300ms debounce over `searchTranslations`; whether "Use key" closes the dialog and opens the existing entry or copies the key.
- Live collision check source: folder contents already in `BrowserStore` vs. an API probe.
- Behaviour of the breadcrumb/popover when the folder does not exist yet (create-on-save copy).
