---
target: Create/Edit Translation dialog and all tabs
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:/Users/simon/.supacode/repos/lingo-tracker/features/apps/tracker/src/app/browser/dialogs/translation-editor/translation-editor-dialog.ts"
target_fingerprint: "sha256:6e9d1725f1b2dab364eaf6bb74c03242d9242907d2c9925a715d79a8db0a1892"
target_path: /Users/simon/.supacode/repos/lingo-tracker/features/apps/tracker/src/app/browser/dialogs/translation-editor/translation-editor-dialog.ts
timestamp: 2026-09-06T04-11-52Z
slug: gs-translation-editor-translation-editor-dialog-ts
---
Method: dual-agent (A: design review · B: detector + evidence). Detector ran DEGRADED (HTML/CSS parser modules unavailable, regex fallback; no contrast/token/DOM rules). Findings are an undercount.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Save disabled (html:258) with no indication of what is invalid or where |
| 2 | Match System / Real World | 2 | Raw enum statuses; `otherLocales` mistranslated as geography in de/ru/ja |
| 3 | User Control and Freedom | 1 | No unsaved-changes guard; `onCancel()` bare close (ts:379) |
| 4 | Consistency and Standards | 2 | Statuses are localized pills in list view, bare English here |
| 5 | Error Prevention | 1 | Key renaming rejected after submit (ts:481); duplicates only as server 409 |
| 6 | Recognition Rather Than Recall | 2 | Full dotted key never shown as one string |
| 7 | Flexibility and Efficiency | 2 | Ctrl/Cmd+Enter (ts:364) undocumented; no auto-translate; no save-and-add-another |
| 8 | Aesthetic and Minimalist Design | 3 | Similar Translations holds permanent space in idle state |
| 9 | Error Recovery | 2 | Raw server messages piped to user, never mapped to a field |
| 10 | Help and Documentation | 1 | `keyHint` misinforms; neither disabled tab explains itself |
| **Total** | | **19/40** | **Below average — structurally sound, systemically leaky** |

## Design Specificity Verdict

Partly authored; the authored parts are chrome, not flow. SCSS is genuinely LingoTracker (parchment, coral accent rails scss:296, mono location pill, scroll-reveal shadow). Interaction model is stock Material — swap labels and it creates a CRM contact.

Three tells:
- Dot-delimited key syntax is the product's own, and the key field forbids the dot (ts:151).
- Status is "the spine" and renders as raw English enum (html:193) though `browser.status.*` is localized in all six locales.
- Read-only banner uses `var(--color-warn, #b26a00)` (scss:140-143); `--color-warn` does not exist — tokens.scss:33 defines `--color-warning`. Hardcoded brown fires 100% of the time, both themes.

Deterministic scan: 5 findings, one rule (`side-tab`) across 4 files; 3 are false positives (tree selection indicator, neutral-token state rails). Browser overlay unavailable — dev server on :4200 but no injection attempted; live contrast unverified, and the degraded detector also skipped computed contrast.

i18n parity is perfect (49/49 editor keys, 13/13 picker keys, six locales). Every key exists; some hold the wrong words.

## Overall Impression

Craft is real, bones are sound; failures are at the seams where the dialog meets the product's own promises. Localized except the status control. Has a confirmation guard — pointed at an optional comment field while Escape vaporizes the form. Has a folder picker — hidden behind a third tab while the field that could accept the path rejects its syntax. Biggest opportunity: collapse the tab strip.

## What's Working

- Base-value reference banner on Tab 2 (html:169-178) — solves the working-memory problem the tab split creates; scroll-reveal shadow communicates rather than decorates.
- Similar Translations state machine (similar-translations.ts:33-38) — four states as one computed, debounced 300ms, self-filtering in edit mode.
- Inherited tags as dashed non-removable chips (html:117-121) — communicates inheritance without a word.

## Priority Issues

**[P1] Key field forbids the product's own key syntax.** ts:151 `/^[a-zA-Z0-9_-]+$/`. User arrives holding `apps.common.buttons.ok`; error mentions neither dots nor folders while `#buildFullKey()` (ts:578) joins with a dot. Fix: accept dots on paste, split at last `.`, set folder prefix, flash the pill. Command: /impeccable harden

**[P2] Window-scoped Escape + no dirty guard destroys work.** ts:359 binds Escape to window; no `disableClose` at either call site (with-item-actions.feature.ts:70, translation-main-header.ts:101). Escape over the conflict dialog closes the editor beneath it. Fix: delete the HostListener, set disableClose, route backdropClick/keydownEvents through a form.dirty check. Command: /impeccable harden

**[P3] Statuses render as untranslated raw enums.** html:191-194. Fix: map through TOKENS.BROWSER.STATUS.* and reuse the list view's status chip. Command: /impeccable clarify

**[P4] Disabled Save with no diagnosis, no per-tab validity signal.** html:258 + html:69 (touched-gated errors). Fix: enable, validate on click, markAllAsTouched, jump to first invalid tab, add error dot to tab label. Command: /impeccable harden

**[P5] Read-only styling references a nonexistent token.** scss:140-143. Never adapts to dark theme. PRODUCT.md makes read-only legibility binding. Fix: rename to --color-warning, extend lock state to pill and tab strip, tooltip the disabled Tab 3. Command: /impeccable polish

**[P6] `otherLocales` mistranslated as geography in de/ru/ja; `readOnlyNotice` untranslated in all five non-English locales.** de "Andere Orte", ru "Другие населенные пункты" (other populated settlements), ja "その他の地域". Related: `stale` as de "Abgestanden", ru "Залежалый". Fix: retranslate as software-locale terms; fill readOnlyNotice. Command: /impeccable clarify

## Persona Red Flags

**Alex (power user):** key field rejects his clipboard. Ctrl+Enter is undocumented and rewarded with an unrequested comment nag (ts:681, disableClose:true). No save-and-add-another. Escape is a landmine.

**Jordan (first-timer/translator):** keyHint never says what a key is or that it composes with the folder path. Location pill styled as static metadata — she'll never find Tab 3. Tab 2 disabled and unexplained. Status vocabulary in raw English without teaching color. Comment is a single-line input (html:103) though TextFieldModule is imported unused (ts:27).

**i18n owner:** auto-translate absent from the dialog entirely (lives only at translation-item/item-header.ts:161). Create mode hardcodes non-base status to 'new' (ts:547) and hides the select. Key rename rejected only after a round-trip through the comment nag (ts:481). Full dotted key not copyable anywhere.

## Minor Observations

- Fixed 570px content height (scss:182) + `overflow: hidden !important` (scss:186) clips on an 800px viewport with no scroll escape.
- Responsive unaddressed: 700px both call sites, one @media in 603 lines. German/Russian tab labels force Material pagination arrows.
- `.location-pill-path` truncates with no tooltip (scss:110).
- Reduced-motion covers 3 of 16 transitions (scss:597 only); three sibling SCSS files have no such query.
- Folder picker add-subfolder button is opacity:0 until hover but stays focusable.
- Tree has no aria-activedescendant and no role="treeitem"; DOM focus never moves.
- Hand-rolled role="dialog" (html:1) nested inside MatDialog's own.
- getLocaleDisplayName() just uppercases — `fr-ca` renders FR-CA.
- Similar-translation cards copy to clipboard but are styled as navigation; the 409 flow already knows how to open the resource.
- 3 `!important` and 14 `::ng-deep` uses fighting Material internals.

## Questions to Consider

- Why is there a tab strip at all? One scrolling column kills the disabled-tab, cross-tab-validity, fixed-height, and label-overflow problems at once.
- Why does the dialog nag about a missing comment but not about unsaved work?
- Should the location pill be an input rather than a tab destination?
- `--color-warn` failed silently. What else references a token that doesn't exist? A CI check resolving every var(--color-*) against tokens.scss would catch it.
