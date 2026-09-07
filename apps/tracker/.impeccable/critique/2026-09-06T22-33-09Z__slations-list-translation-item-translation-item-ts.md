---
target: compact and full detail translation resource item in the main content area of the browser view
total_score: 14
max_score: 36
na_heuristics: 9
p0_count: 2
p1_count: 3
target_identity: "file:/Users/simon/.supacode/repos/lingo-tracker/features/apps/tracker/src/app/browser/translations/list/translation-item/translation-item.ts"
target_fingerprint: "sha256:699cf174e39ea7423816a11af7c44a0c9d325911169d19dc7f1585703a7669ef"
target_path: /Users/simon/.supacode/repos/lingo-tracker/features/apps/tracker/src/app/browser/translations/list/translation-item/translation-item.ts
timestamp: 2026-09-06T22-33-09Z
slug: slations-list-translation-item-translation-item-ts
closed: true
---
Method: dual-agent (A: design review · B: detector + browser evidence). Both ran isolated; no degradation.

**Target:** `apps/tracker/src/app/browser/translations/list/translation-item/` (compact + full detail) · Mode: **Operate**

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 1 | Compact shows an unlabeled value and silently falls back to the base locale — an all-`new` key renders confident English (`translation-item.ts:187-199`, `.html:45`) |
| 2 | Match System / Real World | 2 | "base locale" never appears on the item; base value is unlabeled; `Comment: -` renders on every commentless card |
| 3 | User Control and Freedom | 1 | Locale list clipped to 4 rows; expand chevron gated on value *length*, not on content being hidden (`translation-item.ts:211-216` vs `.scss:190-192`) |
| 4 | Consistency and Standards | 2 | `new`/`stale` share a color in rows but differ in the rollup; rollup is a `div[role=button]` with `cursor: default` and no click action |
| 5 | Error Prevention | 2 | Bare `Delete` key deletes a focused row, no modifier (`translation-item.ts:292-296`); read-only produces no visual change to the item |
| 6 | Recognition Rather Than Recall | 1 | Full key can be copied but never read — truncated at 50 chars, tooltip says only "Click to copy" (`item-header.html:9`) |
| 7 | Flexibility and Efficiency | 2 | Double-click-to-edit, `E`, `Delete` all exist and are entirely undiscoverable |
| 8 | Aesthetic and Minimalist Design | 1 | ~200px of `CODE · icon · "Translated" · :` chrome before every value; a constant word rendered ~40x per screen |
| 9 | Error Recovery | n/a | The item renders no error state of its own; errors live at list level |
| 10 | Help and Documentation | 2 | Rollup tooltip is the only explainer, and it repeats "Translated" with the locale code demoted to the right edge |
| **Total** | | **14/36** | **Poor — significant rework needed** |

## Design Specificity Verdict

**LLM assessment: mostly generic, with one bespoke component that is off-brand.** A generic key/value inspector could ship this card with a find-and-replace. Nothing in the composition knows it is looking at translations. The one authored element — the segmented status ring — is drawn in raw Tailwind hex (`#f97316`, `#eab308`, `#3b82f6`, `#10b981`, `translation-rollup.ts:277-298`) with a hardcoded `#18181b` tooltip panel. The single component with a point of view is the one that abandons the binding watercolor identity.

The hierarchy is inverted against the stated primary job: the **base value is the card's title** (18px bold coral) while the **key is a small grey chip**. The developer arrives holding a key, not an English string.

**Deterministic scan:** `impeccable detect` returned **exit 0, zero findings** on the target directory and `translation-list.html`. Verified as a real clean result — the same binary returns 6 findings on `src/app/browser`, and `--no-config` gives the identical empty set. One adjacent true positive just outside scope: `side-tab` at `translation-list.scss:63` (`border-left: 4px solid var(--color-info)`).

**In-page detector:** injection succeeded (mutation preflight passed; live server on :8400, since stopped). Console reported **67 anti-patterns**. **No user-visible overlay was confirmed** — the evidence is console output only.

Convergence between the two assessments:

| Finding | Design review | Measured evidence |
|---|---|---|
| `--color-primary` on item background fails AA | computed 2.68:1 | measured **2.68 light** (dark passes at 5.50) |
| Locales hidden with no affordance | `needsExpansion()` keyed on wrong signal | wrapper clientHeight **128px** vs scrollHeight **295px**, expand button **never rendered** |
| Compact value is unlabeled | code path at `:187` | live: every row rendered **Arabic RTL text in an LTR box**, no locale indicator |
| Rollup is an affordance lie | `role=button`, `cursor: default` | **40x40 `div`**, below the 44px target, not a `<button>` |

Detector-only catches: every full-detail item costs an **extra tab stop** (`.locale-scroll-wrapper` is focusable and draws its own focus ring), and **all three status icon colors fail the 3:1 non-text minimum** in light theme — warning 1.84, verified 2.32, info 2.90.

## Overall Impression

The item is a table pretending to be a card. It renders the one thing that never varies (the word "Translated," ~40x per screen) at higher visual weight than the things that do vary, and it clips or truncates every piece of data a user actually came for. The biggest opportunity is a straight inversion: **make the key readable and the gap visible, and demote the English source.**

## What's Working

1. **Locale rows sort by status priority, not alphabetically** (`translation-item.ts:143-148`). The translator sees `stale` and `new` at the top of every card without filtering.
2. **The `sr-only` per-item status breakdown** (`translation-item.html:19-24`) gives screen-reader users a summary sighted users can't get without hovering.
3. **The border-flash on a recently-updated item** (`translation-item.scss:262-271`) plus search highlighting is a well-judged "that landed" moment.

## Priority Issues

**[P0] Locales are silently unreachable.** `needsExpansion()` gates the chevron on any value exceeding 200 characters (`translation-item.ts:211-216`), but the region is clipped to 4 rows regardless of locale count (`.scss:190-192`). On `mockDesignSystem` 6 of 11 locales render behind a near-invisible scrollbar with no chevron and a fade that can never clear.
*Why it matters:* the i18n owner sweeping for gaps before a release signs off on a card that hid 60% of its data.
*Fix:* return `true` from `needsExpansion()` when locale count exceeds the visible-row max **or** a value is long; replace the fade with a counted affordance ("+6 more locales").
*Command:* `/impeccable harden`

**[P0] Compact mode doesn't say which locale it's showing, and falls back to base silently.** `primaryLocaleValue()` picks `filteredLocales()[0]` and falls back to the base locale (`translation-item.ts:187-199`), then renders it bare (`.html:45`).
*Why it matters:* the translator cannot tell "es is done" from "es is empty and you're reading en".
*Fix:* prefix the compact value with locale code + status icon; render base-locale fallback in a visibly different treatment.
*Command:* `/impeccable clarify`

**[P1] The full key can never be read, only copied.** `TruncateKeyPipe` collapses keys at 50 chars; the chip's only tooltip is "Click to copy" (`item-header.html:9`). At 768px `word-break: break-all` shreds it mid-token into 3-4 lines, 70px tall, with the rollup visually overlapping it.
*Fix:* tooltip the untruncated key; swap `break-all` for `overflow-wrap: anywhere` with break opportunities at `.` segments.
*Command:* `/impeccable clarify`

**[P1] The status spine is hardcoded English, off-palette, and self-contradictory.** `translation-rollup.ts:273-298` hardcodes `'New'|'Stale'|'Translated'|'Verified'` and Tailwind hex; `:351-364` hardcodes the aria-label. Verified live: with the UI in German, the tooltip reads "Translated" five times. `item-locales.scss:42-44` paints `new` and `stale` identically while the rollup gives them two different oranges.
*Fix:* route labels through `TRACKER_TOKENS.BROWSER.STATUS.*`, replace hex with `--color-*` tokens, add a distinct `stale` token.
*Command:* `/impeccable harden`

**[P1] The card's most important text fails WCAG AA, and every status icon fails the non-text minimum.** `--color-primary` #d4726a on #ede8e0 = **2.68:1**, applied to both `.compact-value` and `.base-value`. Status icons in light theme: warning **1.84**, verified **2.32**, info **2.90** against a 3:1 floor. Dark theme passes throughout.
*Fix:* `--color-text-primary` for both value slots, reserving coral for the key chip or a left accent rule; darken the status hues for light theme.
*Command:* `/impeccable colorize`

## Persona Red Flags

**Developer-in-flow (primary).** Chip shows `apps...confirmDelete.title`, no tooltip. Must copy to clipboard and paste elsewhere to read it.

**Translator-in-a-locale.** Compact gives an unlabeled string and an English fallback when the target locale is empty. Cannot distinguish translated from missing.

**i18n owner pre-release.** 11-locale collection renders 4 locales; 6 hide behind an invisible scroll region with no chevron.

**Keyboard / screen-reader user.** Row focus ring works (`outline: 2px solid`), but every full-detail item costs a second meaningless tab stop on the scroll wrapper. The rollup announces `role="button"` with `cursor: default` and no click handler. Bare `Delete` on a focused row deletes the resource.

**RTL translator (verified on `mockDesignSystem`).** Arabic values render with no `dir="auto"` (`translation-item.html:45`, `item-locales.html:19`), left-aligned in an LTR grid, `${variable}` placeholders bidi-scrambled mid-string.

## Minor Observations

- Virtual-scroll `itemSize` is ~17% short (220px computed vs 258px measured, `translation-list.ts:92-115`) because `filteredLocales()` returns `[]` for "All locales" — the last item is cut mid-card at max scroll.
- Read-only collections change nothing visible on the item: drag handle still `cursor: grab`; only the overflow menu's delete entry is disabled, two clicks deep.
- The header theme toggle never reached `data-theme="dark"` across 4 cycles; dark was only reachable via OS preference emulation.
- `Comment: -` renders on every commentless card.
- `.status-chip { min-width: 80px }` is sized for English "translated"; Russian `Переведено` will shift the value column card-to-card.
- Dead computed signals never referenced in the template: `rollupStatus`, `hasMetadata`, `previewTags`.
- `.locale-code { min-width: 44px }` applies a touch-target value to a non-interactive `<span>`.
- The `:` separator column is decoration inside a grid that already separates columns.
- Tag chips are identical on every row in a folder and occupy the prime right-hand slot ahead of status.

## Questions to Consider

1. If status is the spine, why is `Translated` — a constant — rendered ~40x per screen, while the thing that actually varies gets clipped away?
2. The base value is the biggest, boldest, most colorful element. Who came here to read English?
3. What is compact mode's job? If it can't answer "is this key done?", is it a density mode?
4. `needsExpansion()` asks "is any value long?" when the real question is "is anything hidden?"
5. Why did the design investment go into a 40px ring that can't distinguish 1-of-11 from 11-of-11, instead of an 11-cell locale strip?
