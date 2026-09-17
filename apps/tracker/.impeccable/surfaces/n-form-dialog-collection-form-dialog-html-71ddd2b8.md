---
version: 1
slug: "n-form-dialog-collection-form-dialog-html-71ddd2b8"
primary_target: "apps/tracker/src/app/collections/collection-form-dialog/collection-form-dialog.html"
related_targets: ["apps/tracker/src/app/collections/collection-form-dialog/collection-form-dialog.ts","apps/tracker/src/app/collections/collection-form-dialog/collection-form-dialog.scss"]
---

# Surface: Collection form dialog (create / edit)

Scope: `apps/tracker/src/app/collections/collection-form-dialog/*`, opened from the Collections manager. Mode: Operate. Refinement of an established surface; the watercolor world and Angular Material component base are inherited, not reopened.

Audience and job: a developer registering a folder of translation files as a collection, or adjusting an existing one. Occasional task, done with the folder path already in mind. Translators and the i18n owner edit locales and protected terms less often.

Constraints: every string via Transloco resources; read-only state must be unmistakable; base locale is immutable after creation; protected terms editable only when a terms file is configured; delete stays in the card menu.

## Direction contract

THESIS: One dialog, three labelled groups (Source, Locales, Options) that read top to bottom in the order a developer thinks. It refuses the flat stack of equally weighted outlined fields and the radio-list of locales.

OWN-WORLD: Parchment panel with the 3px coral top rule and header pattern of the translation editor. Nunito labels above fields, IBM Plex Mono for paths and locale codes. Locales are pill chips identical to the Collections card chips, base chip in the sky-blue tint with a BASE tag. Read-only is a switch row on a subtle panel with a warm lock tile. Optional metadata sits in a single disclosure row with counts.

STORY: The visitor sees where the files live, which locales are tracked and which one is the base, and whether the collection is locked, then creates or saves without scrolling past things that do not apply.

FIRST VIEWPORT: 540px panel. Header: folder tile, title, one-sentence purpose, close. Body: Source (name, folder with hint), Locales (chip row with inline add input, one hint line), Options (read-only switch row, disclosure "Tags & protected terms"). Footer right-aligned: Cancel, primary "Create collection" / "Save changes".

FORM: Direction A "Grouped ledger", chosen by the user from three hand-built HTML comps (`.impeccable/mocks/collection-dialog/a-ledger*.png`, approved sidecars). No concept-seed roll: this is a refinement inside an established surface, so no seed key exists.

Signature interaction: clicking a locale chip in create mode makes it the base; the BASE tag slides to it. In edit mode the base chip carries a lock and its remove control is absent.

Approved comp: `.impeccable/mocks/collection-dialog/a-ledger-create-light.png` and `a-ledger-edit-light.png`.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
