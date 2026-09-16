---
version: 1
slug: "undle-form-dialog-bundle-form-dialog-html-1bd13ed1"
primary_target: "apps/tracker/src/app/collections/bundle-form-dialog/bundle-form-dialog.html"
related_targets: ["apps/tracker/src/app/collections/bundle-form-dialog/bundle-form-dialog.ts","apps/tracker/src/app/collections/bundle-form-dialog/bundle-form-dialog.scss"]
---

# Surface: Bundle form dialog (create / edit)

Scope: a new dialog component under `apps/tracker/src/app/collections/bundle-form-dialog/`, opened from the home page's "Add bundle" button and from a bundle card's Edit action. Mode: **Operate**. New surface inside the established world; the collection form dialog is its sibling and the anatomy is inherited.

Audience and job: the i18n owner or a developer defining which collections and entries ship in which output files, occasionally, with the output path and the consuming app in mind. The task is unforgiving: a wrong rule silently drops keys from a release, so the dialog must show what it will write before saving.

Content (from `BundleDefinition`): name (key of `bundles`, immutable in edit), `dist`, `bundleName` pattern with `{locale}`, `collections` = All or per-collection entries with optional `bundledKeyPrefix`, `entriesSelectionRules` All or rules of `matchingPattern` + `matchingTags` + `matchingTagOperator`, and `mergeStrategy`; `typeDistFile`, `tokenCasing`, `tokenConstantName`; `transformICUToTransloco`.

Constraints: every string via Transloco resources. Name locked after creation. Casing and ICU options inherit project defaults and say so. Delete stays in the card menu. Needs a dry-run API (files to be written, keys per locale, conflicts, locales) that recomputes as the form changes; without it the preview column shows the file tree only and states that counts are unavailable.

## Direction contract

THESIS: A master-detail dialog: a rail of sections on the left, one section's form in the middle, and a live preview of what the bundle will write on the right. It refuses the single scrolling form (the collection dialog's shape, too long for per-collection rules) and the wizard.

OWN-WORLD: The Watercolor Ledger dialog family: parchment panel, 3px coral top rule, coral header tile (`add_box` create, `inventory_2` edit), Headline title with a one-line subtitle, close at top right, hairline-separated header/body/footer. Rail on parchment-subtle with a right hairline; the active item lifts to parchment with `sm` shadow and a coral glyph. Labels above wells, IBM Plex Mono for every path, pattern, key, and tag. Segmented controls are parchment-muted pills inside a hairline well, never Material outline fields. Switch rows with coral-tinted 30px tiles introduce Types and Options. The preview column is parchment-subtle with a left hairline, mono file tree, "new" pills in coral-text on a 12% coral tint, a dry-run definition list, and one example key in a bordered well.

STORY: The visitor sees the bundle's sections at a glance, works one section at a time with room for its rules, and watches the right column update with the files, counts, and an example key, so they know what saving will change before they press the primary button.

FIRST VIEWPORT: 1160px panel, columns 240px rail / fluid pane / 320px preview, body min-height about 520px, panel capped at 90vh with the pane owning scroll. Rail items in order: Output (mono summary `dist/pattern.json`), Collections with a count and one child per collection showing "all" or "n rules", "Add a collection", hairline, Types (file name or "off"), Options ("ICU → Transloco"). Create opens on the first collection's pane; edit opens on Output. Collection pane: title + Remove text button, Key prefix and On key conflicts (First wins / This overrides) side by side, Entries segmented (All entries / Only matching rules), Rules table (Key pattern mono well, Tags well with chips and an operator between them, remove), "Add rule". Preview column: "Will write" tree, "Dry run" list (collections, keys per locale, conflicts, locales) with a caption that it recomputes from the resources on disk, "Example key" showing source key, prefixed key, and token path. Footer: validity summary at left ("2 collections · 6 files · types on"), Cancel, primary "Create bundle" / "Save changes".

Signature interaction: editing any field re-runs the dry run and the preview column updates in place; files that do not exist yet carry a "new" pill; a rule change moves the example key. Selecting a rail item swaps the pane without closing the dialog; an invalid section shows an error dot in the rail.

FORM: Direction D, a user-directed merge of comp C (sections rail) and comp B (output preview), with the third-column placement chosen over the in-rail placement after both were rendered. No concept-seed roll: the four structures were brief-pinned and hand-built. Approved comps: `.impeccable/mocks/bundle-dialog/d-rail-preview-column-create-light.png` and `d-rail-preview-column-edit-light.png` (sidecar `d-rail-preview.json`, approved: true).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Unresolved for the build round
- Dry-run endpoint contract and its latency; debounce and a stale indicator while recomputing.
- "Add a collection" picker: inline list in the pane or a menu from the rail.
- Behaviour below 1200px viewport: collapse the preview to a footer disclosure or hide the rail behind a section select.
- Validation copy for name collisions, non-`.ts` type file, and patterns without `{locale}`.
