---
target: Translation creation/edit dialog and all tabs (re-critique)
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:/Users/simon/.supacode/repos/lingo-tracker/features/apps/tracker/src/app/browser/dialogs/translation-editor/translation-editor-dialog.ts"
target_fingerprint: "sha256:28e1378efb682268e63c10874f4ee3ddddff09a4a6a16ae08c4efbd78e086fa3"
target_path: /Users/simon/.supacode/repos/lingo-tracker/features/apps/tracker/src/app/browser/dialogs/translation-editor/translation-editor-dialog.ts
timestamp: 2026-09-06T05-01-25Z
slug: gs-translation-editor-translation-editor-dialog-ts
---
Method: dual-agent (A: design review · B: detector + browser evidence, full parser mode, live browser on :4200).

Re-critique of the same target assessed at 19/40 on 2026-09-06. **Now 26/40.** 4 of 6 P-issues fixed, 2 partial; 6 of 10 minors fixed. No regressions in the fixed set — but the two survivors are the two that define the product, and one *new* P0 arrived with the auto-translate feature.

## Regression scorecard — how the changes held up

| Prev | Issue | Verdict | Proof |
|---|---|---|---|
| P1 | Key field forbids dotted syntax | **PARTIAL** | `ts:159` validator unchanged, no paste handler exists. Only the error copy improved. |
| P2 | Window Escape + no dirty guard | **FIXED** | `ts:328` `disableClose`, `ts:330-345` keydown/backdrop routed, `ts:349-364` 3-source dirty check. |
| P3 | Raw English enum statuses | **FIXED mechanism / broken content** | `ts:227-232` + `html:249` localize it — onto four wrong translations. |
| P4 | Disabled Save, no diagnosis | **FIXED** | `html:319`, `ts:619-631`, tab error dot `html:66-72`. |
| P5 | `--color-warn` doesn't exist | **FIXED here, not repo-wide** | `scss:156-159` + `tokens.scss:36`. Detector found 3 surviving refs in `translation-browser.scss:88,89,91`. |
| P6 | `otherLocales` as geography | **FIXED** | de "Weitere Sprachen", ru "Другие локали", ja "他のロケール". |

Minors: fixed — location tooltip, reduced-motion (16/18 transitions now covered), focusable hidden add-button, nested `role="dialog"` (B confirms exactly one at runtime), `getLocaleDisplayName` via `Intl.DisplayNames`. Not fixed — responsive (still one breakpoint in 690 lines), 3 `!important` / 14 `::ng-deep`, similar-translation cards styled as navigation, 570px fixed height still in the file.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | `errorMessage` (`ts:623`) never clears as fields are fixed; no `aria-live` anywhere (B). |
| 2 | Match System / Real World | 2 | `stale` = de "Abgestanden", ru "Залежалый", es "Duro", fr-ca "Vicié". `saving` = es "Ahorro…". |
| 3 | User Control and Freedom | 3 | Dirty guard is excellent — but the discard dialog lies after auto-translate. |
| 4 | Consistency and Standards | 3 | Base value is a 4-row textarea (`html:110`); every locale value is a single-line input (`html:259`). |
| 5 | Error Prevention | 2 | Dots still rejected; duplicates still only a 409 (`ts:833`); no ICU-placeholder parity check. |
| 6 | Recognition Rather Than Recall | 2 | Full dotted key is tooltip-only (`html:28`). Tab 3 shows a tree with no key and no value. |
| 7 | Flexibility and Efficiency | 3 | Ctrl+Enter now documented — but hardcoded "Ctrl" in all six locales while `ts:485` binds `meta.enter`. |
| 8 | Aesthetic and Minimalist Design | 3 | Idle Similar-Translations card always painted; B measured 350px dead space on tab 3 at 1440. |
| 9 | Error Recovery | 2 | Raw `error.error.message` piped to banner (`ts:848`); API's 422 "auto-translation not enabled" collapsed into a generic toast (`ts:654`). |
| 10 | Help and Documentation | 3 | Both disabled tabs now explain themselves. Nothing explains the status lifecycle or what auto-translate writes. |
| **Total** | | **26/40** | **Up 7. Seams closed; the model underneath is unchanged.** |

Cognitive load: **4 failures of 8** — single focus (Tab 1 holds five concerns), grouping (location pill and its control separated by a tab boundary and named differently), one-thing-at-a-time (`ts:600` comment nag interrupts every save), progressive disclosure (idle similar-translations card).

## Design Specificity Verdict

**Meaningfully more authored than last time; still a Material tab dialog wearing a LingoTracker coat.**

Newly product-specific: `ts:238` `canAutoTranslate` with the `saveFirst` tooltip encodes a real architectural truth. `html:242`/`scss:686` pairs the human locale name with a mono `fr-ca` chip — the dual audience in one row, with a source comment naming the person it serves. `tokens.scss:34-36` fixes `--color-warning` *and* records why two tokens exist (2.1:1 contrast on parchment).

Still category-interchangeable: the three-tab strip is the whole interaction model, and it costs ~120 lines of compensating machinery (`selectedTabIndex`, `formRevision`, `baseTabHasError`, the error dot, two disabled tooltips, the base-value reference banner, a fixed 570px height the new flex layout works around). The full dotted key — the deliverable — is uncopyable, while other people's suggested keys get a clipboard button (`ts:562`).

**Deterministic scan:** 5 findings, one rule (`side-tab`), all in SCSS. Run in **full parser mode** (agent B installed the missing parser deps, then removed them) — identical to the degraded run, so unlike last time this is not an undercount. 3 genuine, 2 defensible false positives (`similar-translations.scss:9` and `dialog.scss:469` are state channels, not decoration). Notable pattern: the same 3px left-stripe idiom on four different card types in one dialog. **Zero hardcoded colors in the directory** — fully tokenized.

**Token sweep:** 13 unresolved `var()` refs across `apps/tracker/src`. `--color-warn` survives at `translation-browser.scss:88,89,91` (with fallback). Worse: 7 `--mat-sys-*` refs in `collection-form-dialog.scss` (`:34,41,50,69,79,88,90`) with **no fallback** — `theme.scss` uses M2 APIs, which never emit `--mat-sys-*`. Same silent-failure class as the bug you just fixed.

**Browser (live, both modes, light+dark, 1440/900/390, EN+DE):** 0 console errors. Focus trap correct, 7 stops, nothing escapes. The 570px height **does not clip** — `min-height: 0` lets it shrink (420px at 900×700, 529px at 390×844). Two real defects it exposed, below.

## What's Working

- **The unsaved-changes guard is architecturally right, not just present.** `ts:327-346` owns `disableClose` in the component rather than trusting call sites, routes Escape through `dialogRef.keydownEvents()` instead of `window`, and `hasUnsavedChanges()` compares baselines for three independent state sources — form, `selectedFolderPath`, `tagsList` — two of which live outside the form. Most implementations check `form.dirty` and ship the bug.
- **`--color-warning-text` is a token fix with a stated reason.** `tokens.scss:34-36` records *why* two tokens are needed and gives dark mode its own value. That comment is what stops the next developer re-collapsing them.
- **`getLocaleDisplayName()` serves both personas in one row.** `ts:955-968` resolves through `Intl.DisplayNames` *in the active UI language*, with an uppercase fallback and try/catch; `html:242` keeps the raw code beside it. Neither audience translates for the other.

## Priority Issues

**[P0] Auto-translate writes the repository from inside an unsaved form — and the discard dialog then lies about it.**
`ts:646-648` POSTs to `resources/translate`; `resources.controller.ts:80-105` persists to disk. `ts:673` then marks the form dirty, so Cancel shows "Closing now will lose them" — the locale values are already committed to disk and cannot be lost. No confirmation before the write, no undo after. This breaks PRODUCT.md principle 1 (files are the truth, every action a reviewable diff) *and* principle 4 (never let a destructive state be a surprise), then misreports what happened.
Fix: make the endpoint return candidates and let Save persist them; or keep the write, confirm before it ("writes N locales to `apps.common.buttons.ok` now"), and reset the dirty baselines after. → `/impeccable harden`

**[P1] `stale` is mistranslated in four of six locales — on the control P3's fix just made prominent.**
de "Abgestanden" (beer), ru "Залежалый" (unsold goods), es "Duro" (hard bread), fr-ca "Vicié" (foul air). Plus `saving` = es "Ahorro…", fr-ca "Économie…" — the *money* sense, on the submit button. PRODUCT.md fixes the status lifecycle as non-renamable domain vocabulary and calls it "the spine". A translation tool shipping a wrong translation of its own core noun is the worst dogfooding failure available.
Fix: de "Veraltet", ru "Устарело", es "Desactualizado", fr-ca "Obsolète"; `saving` → "Guardando…" / "Enregistrement…". → `/impeccable clarify`

**[P1] The key field still refuses the one string the primary user is holding.**
`ts:159` `/^[a-zA-Z0-9_-]+$/`, unchanged, no paste interception. `#buildFullKey` (`ts:811-817`) joins with `.` — the app writes the syntax it won't read. The copy improved; the rejection didn't.
Fix: intercept paste/input, split at the last `.`, set `selectedFolderPath` to the prefix, put the leaf in the control, flash the location pill. Keep the pattern as backstop, not front door. → `/impeccable harden`

**[P2] Hint text overflows and paints over content in German at narrow widths (browser-measured).**
`.mat-mdc-form-field-subscript-wrapper` is 22px with `overflow: visible`. At 390px the key hint renders 42px, tags hint 62px; in German the key hint reaches **62px** and the tags hint **82px**, spilling onto `.base-locale-card` below. Cause: no `subscriptSizing="dynamic"` at `html:77, :127, :142`. Also at 390px the tab strip paginates and scrolls the *active* tab out of view with no indicator. PRODUCT.md makes long-DE/RU survival binding.
Fix: `subscriptSizing="dynamic"` on the three fields; add a real breakpoint (there is exactly one `@media` breakpoint in 690 lines, scoped to `.base-value-reference`) and drop the dialog to full-width below ~600px. → `/impeccable adapt`

**[P2] Other-locale values are single-line inputs while the base value is a four-row textarea.**
`html:110-120` vs `html:259-265`. Exactly backwards: the translator, whose whole job is Tab 2, gets the worse field for the languages that run 30–40% longer. `TextFieldModule` is already imported (`ts:27`) — the fix costs nothing. → `/impeccable polish`

**[P3] The full dotted key is uncopyable, and the error banner never clears.**
`fullKeyPreview()` (`ts:255-263`) renders only into `[matTooltip]` (`html:28`) — unreachable by keyboard, touch, and selection. Separately `errorMessage` (`ts:623`) persists after the user fixes the fields, so a stale "Fix the highlighted fields" banner sits over a now-valid form, undoing the credibility P4 just earned. → `/impeccable polish`

## Persona Red Flags

**Alex (power-user dev):** pasted key still rejected (`ts:159`); the key he came for is uncopyable (`html:28`); `saveShortcutHint` hardcodes "Ctrl + Enter" in all six locales while `ts:485` also binds `meta.enter`; the comment nag fires on every save (`ts:600`); still no save-and-add-another.

**Jordan (first-time translator):** single-line input for every language she writes (`html:259`); a status dropdown offering "Abgestanden"/"Залежалый"/"Duro"; no status color reaches the select (`html:244-253`) so the list view's chip vocabulary doesn't transfer; auto-translate's tooltip describes the mechanism but never says it writes files.

**i18n owner:** auto-translate is all-or-nothing on empty locales (`ts:665`) — no per-locale control, no preview, no re-run of one stale locale; the API's 422 "Auto-translation is not enabled for this collection" is swallowed into a generic toast (`ts:654`); create mode hardcodes non-base status to `'new'` (`ts:780`) so a verified import can't be seeded; no ICU-placeholder parity check, though `skippedLocales` (`ts:688-694`) proves the server already reasons about it.

## Minor Observations

- **20 dialog-scope i18n entries are `stale`, 2 are `new`** — concentrated in es (10) and fr-ca (9). Translations exist but no longer match the current base value. The tool is not clean against itself.
- `similarTranslations.showMoreX` is genuinely untranslated in fr-ca ("Show {count} more").
- `otherLocalesToggleX` is referenced by nothing — six locales maintained for a dead string, in a product whose job is finding dead strings.
- `ts:711-720`'s `hasKeyChanged` rejection is now unreachable dead code (`html:85` makes the key readonly).
- `folder-picker.ts` sets no `aria-activedescendant` and never calls `.focus()` — the visual tree highlight moves, the screen reader does not.
- `html:5` uses `class="mat-dialog-title"`, not the directive; the accessible name works only because both call sites pass `ariaLabelledBy`. A third call site ships a nameless dialog.
- `scss:12` hardcodes `max-height: 90vh`, duplicating what both call sites already pass. `scss:8` `:host { max-height: inherit }` has no effect.
- `html:92` renders the *error* string `error.keyRenamingNotSupported` as a steady-state `mat-hint`.
- es/fr-ca `keyHint`/`keyPatternError` name the tab as "pestaña Ubicación"/"onglet Emplacement" but the real labels are "Cambiar ubicación"/"Changer d'emplacement". de/ru/ja got this right.
- fr-ca `error.createFailed` = "Échec de la traduction" (translation failed, not create failed). de `conflict.chooseDifferentKey` uses *Taste* (keyboard key) for *Schlüssel*.
- Reduced motion covers 16/18 transitions; uncovered: `picker-folder-node.scss:93` `.folder-icon`, `:104` `.folder-name`.
- `translation-main-header.ts:95-99` builds the dialog data without `readOnly` — only the button's disabled state keeps a read-only collection out of an editable create dialog.
- App-shell bug found in passing: `header.keysCountX` / `header.localesCountX` render as raw keys in German (2 console warnings).
- The 4 new tests cover only P2. The tab error dot, the readonly key, and auto-translate ship untested.

## Questions to Consider

1. **If auto-translate writes to disk, why is it inside a form with a Save button?** The dialog now has two meanings of "saved" and tells the user about only one.
2. **The tab strip survived this re-critique — did it earn that, or just outlast the reviewer?** One scrolling column deletes the disabled-tab, cross-tab-validity, fixed-height, dead-space, and label-pagination problems at once.
3. **What check would have caught `stale` = "Abgestanden"?** Key parity is 100%. A glossary term per lifecycle status, enforced across locales, is the product demonstrating its own glossary feature on itself.
4. **`--color-warn` is fixed here and still live three files away, and 7 `--mat-sys-*` refs resolve to nothing with no fallback.** Twenty lines of CI resolving every `var(--color-*)` against `tokens.scss` makes the fix permanent instead of local.
