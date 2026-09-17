---
version: 1
slug: "app-collections-collections-manager-html-dafe3602"
primary_target: "apps/tracker/src/app/collections/collections-manager.html"
related_targets: ["apps/tracker/src/app/collections/collections-manager.ts","apps/tracker/src/app/collections/collections-manager.scss"]
---

# Surface: Tracker home (collections page, route `/collections`)

Scope: the app landing page rendered by `CollectionsManager`. Visitor mode: **Operate**.

Audience and job: a developer mid-feature who wants to open a collection and get to a key; the i18n owner who, before a release, regenerates bundles and confirms they wrote cleanly. Task frequency: collections daily, bundles at release time.

Content: the project's collections (identity cards: tile, name, mono folder path, read-only lock, locale chips with BASE tag and +N overflow, Edit/Delete menu) and its bundle definitions from `.lingo-tracker.json` (name, `dist` + `bundleName` output pattern, collections consumed or "All collections", `typeDistFile`, locale count). Actions: Add collection; Add bundle; Edit/Delete bundle; Generate per bundle; Generate all. States: populated; collections but no bundles; a bundle mid-generation; generation succeeded; generation failed.

Constraints: identity-only collection cards (no key counts or status rollups this round). Bundle editor dialog, API/DTO/store code, header nav as a system pattern, and the empty-project onboarding state are out of scope and get their own passes. URL stays `/collections` for now. Every string goes through Transloco.

## Direction contract

THESIS: Bundles are the output of the collections beside them, so they live in a persistent right-hand column instead of a second stacked section or a separate tab. The page refuses the "list of cards, then another list of cards" arrangement and the tabbed dashboard.

OWN-WORLD: The Watercolor Ledger, unchanged: parchment-subtle page with paper grain, parchment cards one tonal step up with hairline borders, coral tiles and the single filled coral action per section, sky reserved for BASE chips and focus, IBM Plex Mono for every path, file, locale code, and the `{locale}` placeholder (ink, weight 600, never sky). Bundle cards share the collection card anatomy; a bundle's tile glyph is `inventory_2`, a collection's is `folder`. Generation results are quiet strips inside the card (success tint, amber warning-text for warnings, neutral with a 2px coral progress bar while running).

STORY: The visitor lands, sees the project by name, its collections on the left and its bundles on the right, and understands which files feed which outputs by hovering a bundle. They open a collection to work, or press Generate and read the result without leaving the page.

FIRST VIEWPORT: Toolbar as today. Page header: display title = the served project's folder name (`lingo-tracker`), subtitle `.lingo-tracker.json · 4 collections · 2 bundles · base en` (mono for file and locale), watercolor rule. Below, a two-column grid: left `minmax(0,1fr)` Collections section (h2 + count, filled coral "Add collection" right-aligned, auto-fill card grid at `minmax(300px,1fr)`); right 420px sticky Bundles column (h2 + count, small outline "Generate all" and small filled "Add bundle", caption "Hover a bundle to see the collections it includes.", stacked compact bundle cards). Each bundle card: tile, name, mono output path, Collections row of text chips, Types row with mono path, optional result strip, footer with locale count and an outline Generate button. Under 1100px the columns stack, collections first, bundles as a one- or two-column grid. Empty bundles: a dashed card in the column with a one-sentence explanation and a filled coral "Create bundle"; header actions hidden.

Signature interaction: hovering or focusing a bundle card lifts it (hover border/shadow), tints the chips of the collections it consumes coral, highlights those collection cards with the card hover treatment, and dims the others to 50% opacity; leaving restores. "All collections" highlights every card. Generate: the button becomes a disabled "Generating…" with spinner, the strip shows the file being written and n of N locales with a determinate bar, then swaps to the result strip (files written, keys per locale, warnings) with a Details disclosure and relative time; failure uses the error tint with a Retry action. Reduced motion disables lift and bar animation.

FORM: Direction C — Split view, user-chosen from three brief-pinned, hand-built HTML comps (A stacked ledger, B segmented tabs, C split view). No concept-seed roll was run: the structures were pinned in the brief. Approved comp: `.impeccable/mocks/home/c-split-populated-light-1440.png` (source `c-split.html`, sidecar `c-split.json` approved: true). Heading chosen from four rendered variants (`title-*.png`).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Unresolved for the build round
- API must expose the project root folder name and include `bundles` in the config DTO (the mapper currently drops it); a generate endpoint is needed for the run state.
- Result strip copy for warnings and failures is only specified in words; comp shows success and running.
- Whether the browser header's back link says the project name or "Collections".
