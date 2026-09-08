---
target: compact and full detail translation resource item in the main content area of the browser view
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:/Users/simon/.supacode/repos/lingo-tracker/features/apps/tracker/src/app/browser/translations/list/translation-item"
timestamp: 2026-09-07T06-19-22Z
slug: src-app-browser-translations-list-translation-item
closed: true
---
Method: dual-agent (A: design review · B: detector + browser evidence).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | The value — the loudest element — is status-blind; `new` and `verified` rows are typographically identical. |
| 2 | Match System / Real World | 3 | Domain vocabulary respected, ICU plurals correct across RU/JA. German `moreLocalesX` renames `locale` → `Region`. |
| 3 | User Control and Freedom | 2 | No undo on delete; `isExpanded` is a local signal inside a recycling virtual scroll, so expansion resets on scroll. |
| 4 | Consistency and Standards | 2 | Compact and full show different information, not different density. `role="listitem"` also carries `tabindex="0"`, `cdkDrag`, keydown, dblclick. |
| 5 | Error Prevention | 1 | `onKeyDown` case `'delete'` has no read-only guard, nor does `deleteTranslation`. Only the menu item is guarded. |
| 6 | Recognition Rather Than Recall | 2 | Copy affordance hover-only with no `:focus-visible`; `e` / `Delete` / dblclick / long-press undiscoverable. |
| 7 | Flexibility and Efficiency | 2 | Shortcuts unadvertised; ~4 tab stops × 310 items, no roving tabindex; `MAX_VISIBLE_LOCALE_ROWS = 4` vs 11-locale collections. |
| 8 | Aesthetic and Minimalist Design | 2 | 11 identical "Translated" pills over 11 identical globes; ~50px reserved empty comment band per full card. |
| 9 | Error Recovery | 2 | No item-level error state. A locale byte-identical to base is labeled "Translated". |
| 10 | Help and Documentation | 2 | No legend for the four status hues; the rollup ring teaches nothing without hover. |
| **Total** | | **20/40** | **Fair — competent chrome, weak on the product's own spine** |

All ten heuristics apply (Operate surface). Raised A's marks on #4, #7, #8: shortcuts and the density toggle exist, they are merely unadvertised.

## Design Specificity Verdict

**Category-interchangeable, with one genuinely authored component bolted on.** Strip the coral and this is a Jira issue row. Card + tinted header band + mono ID pill + tag chips + status pill + overflow menu. Nothing structural is shaped by what LingoTracker is for.

- The row never compares base to translation — full density stacks base (Nunito bold coral 18px) and locale values (mono, grey, sm) as unrelated blocks with no shared baseline.
- ICU placeholders, the thing the product validates, render as undifferentiated plain text. No mismatch marking.
- `stale` means the base changed and the MD5 drifted; the row shows an amber triangle and a pill shaped identically to `translated`. No "was", no drift, no date.
- The watercolor identity is spent on the wrong element: `--color-primary-text` coral fires on 100% of rows at full saturation, while the four status hues live only in 16px glyphs.

`TranslationRollup` is the exception — proportional segments, real `<button>`, `aria-expanded`, dark-panel token override.

**Deterministic scan.** `impeccable detect src/app/browser/translations/list` → exit 2, 1 finding: `side-tab` at `translation-list.scss:63` (`border-left: 4px solid var(--color-info)` on `.search-info`). Header directory clean. Five sibling `side-tab` hits in the editor dialog, outside target.

**Browser overlay** (injection succeeded; compact, full, and 11-locale mockDesignSystem; live server on 8400 confirmed stopped):

| Rule | Full | Compact | mockDS |
|---|---|---|---|
| `low-contrast` | 41 | 65 | 46 |
| `clipped-overflow-container` | 5 | 5 | 5 |
| `text-overflow` | 1 | 1 | 1 |
| `cramped-padding` | 1 | 1 | 0 |
| `radial-halo` / `dark-glow` | 1 | 2 | 1 |

The `low-contrast` mass is one root cause per row, and it corrects a point A scored as a strength. A verified the status tokens clear 3:1 against `--color-background` (`#faf8f5`). The overlay measured them against what they actually sit on — `--color-background-muted` (`#ede8e0`) — where `#3f7aa8` lands at 3.8:1, 32 instances in compact. The 3:1 non-text floor holds; 4.5:1 does not. The drag handle (`#a89f93 on #ede8e0`, 2.1:1) misses even the graphical floor.

Also confirmed: `text-overflow` on `span.collection-folder` — 17px on trackerResources, 171px on mockDesignSystem; breadcrumb truncation not scaling with path length. `low-contrast` on `a.skip-to-main` (3.1:1) is a genuine a11y bug.

**Accepted false positives:** `radial-halo` / `dark-glow` on `body` (rule misclassified a light page as dark); all five `clipped-overflow-container` (app-shell scroll chain; CDK reparents overlays to `cdk-overlay-container`).

## Overall Impression

Carefully built, under-designed. The code is disciplined — honest expand labels, a base-fallback tag that closes a real lie, a tooltip that re-pins dark-surface tokens. But the thinking went into not-lying rather than into what the row is for. A well-behaved generic list row wearing LingoTracker's palette, in a product whose reason to exist is the relationship between a source string and its translations — a relationship this row never draws.

Biggest opportunity: make the value block carry status, and make the base↔translation comparison the row's structure.

## What's Working

1. `+N more locales` instead of a bare chevron (`translation-item.ts:206-213`) — names what is withheld, pluralizes through the transloco pipe so it survives a live language switch.
2. The base-fallback `source` tag (`translation-item.html:50-52`) — closes a specific way this UI could lie.
3. `TranslationRollup` — real button, focusable, `aria-expanded`, proportional segments, dark-panel token override.

## Priority Issues

### [P0] Keyboard Delete bypasses the read-only guard, and read-only is invisible on the row
`onKeyDown` case `'delete'` (`translation-item.ts:278-281`) → `deleteTranslation` (`with-item-actions.feature.ts:108`) with no `isReadOnly()` check. Only `item-header.html:78` guards the menu item. A focused card in a read-only collection opens a destructive confirmation and fails at the API after the user confirms. Read-only changes nothing visible: the drag handle keeps `cursor: grab` at full opacity while `isDragDisabled()` is true. Violates Principle 4 verbatim.
**Fix:** early-return on `isReadOnly()` in the keydown delete branch and in `deleteTranslation`; persistent `[data-readonly]` treatment — lock glyph in the header band, dimmed `cursor: not-allowed` drag handle.
**Command:** `/impeccable harden`

### [P1] Compact shows the wrong locale and hides the base value entirely
`compactDisplay` (`translation-item.ts:145`) takes `nonBaseLocales[0]` — alphabetical, never chosen. On mockDesignSystem that is Arabic. The base value the developer wrote is not rendered at all in compact. Principle 2: the shortest path from landing to that key wins.
**Fix:** compact renders the base value as row identity, rollup ring carries the rest. Drive any locale choice from the existing locale filter, not array position.
**Command:** `/impeccable shape`

### [P1] Status is invisible on the element carrying the row's weight
The value is `--color-primary-text` bold at both densities regardless of status. `--empty` only fires on a literally empty string, so "untranslated pass-through equals the English" renders identically to verified. Status lives in a 16px glyph and a neutral pill at 3.8:1 on the muted row background (32 compact instances, confirmed by overlay). Principle 3 fails at both densities.
**Fix:** make status a property of the value block — tint its left border or text with `--color-status-*`; give the pill in `item-locales.scss:70-80` a status-tinted fill; raise light-mode tokens to clear 4.5:1 against `#ede8e0`, not `#faf8f5`; detect and mark base-identical values.
**Command:** `/impeccable colorize`

### [P2] Compact overflows the list horizontally; the ellipsis never fires
Measured on icuEdgeCases at 1440px: `.item-container` renders 1336px inside a 1036px viewport, right edge x=1764. `white-space: nowrap` (`translation-item.scss:129`) resolves to max-content because CDK's absolutely-positioned `.cdk-virtual-scroll-content-wrapper` imposes no width. Rollup, comment and menu are pushed off-screen on most rows — every per-item action silently disappears.
**Fix:** `max-width: 100%` + `min-width: 0` on `.item-container` and the content wrapper; regression test asserting `item.scrollWidth <= viewport.clientWidth`.
**Command:** `/impeccable adapt`

### [P2] "Compact" isn't compact, and full detail adds air rather than information
Compact is ~93px/row for two lines, inheriting the full header band unchanged (40px header min-height, 44px button floor, padding, margin). Eight rows in a 900px viewport where a table shows 25. Full density reserves ~50px of empty band on every card without a comment, and repeats 4–11 identical status pills next to 4–11 identical globes. Toggling density changes what information exists, not how tightly it is packed.
**Fix:** strip the header band in compact to a single line; drop `.comment-expand-row`'s reserved height when there is neither comment nor expand; collapse the status column to one summary when every visible row shares a status; suppress inherited tags when constant across the list.
**Command:** `/impeccable distill`

## Persona Red Flags

**Flow-state developer:** compact shows Arabic where English belongs. Eight rows visible in "compact". Key chip wraps mid-key at 900px, one character per line at 600px (`overflow-wrap: anywhere`, `item-header.scss:81`, no min-width floor). Copy affordance is `opacity: 0` until hover with no `:focus-visible` counterpart — keyboard and touch users never learn the chip copies.

**Translator working a locale at a time:** their content is the quietest thing on the card (grey, sm, mono). Monospace for natural-language prose forces JA into a mono fallback with no CJK coverage. `MAX_VISIBLE_LOCALE_ROWS = 4` puts their locale behind a click on most cards. Rows sort by `STATUS_SORT_PRIORITY` then code, so their locale moves position card to card — no stable column to scan down.

**i18n owner auditing before release:** 11 locales, 4 shown; auditing 659 keys means 659 clicks. The ring collapses `new` and `stale` into one `priority_high` center icon (`translation-rollup.ts:387-391`) — the two states triaged differently are recoverable only from amber-vs-orange arcs ~20° apart at similar luminance, identical under deuteranopia. No count on the ring. No item-level mismatch state, so an ICU placeholder-count mismatch is surfaced nowhere.

**Alex (power user):** ~1,240 tab stops across 310 items, no roving tabindex. Four of the row's twelve affordances are unadvertised.

## Minor Observations

- `tag-list.component.html:3` — hardcoded English `'Inherited from collection'` tooltip, in the product whose Principle 5 is no hardcoded copy.
- `item-locales.scss:79` — `min-width: 80px` comment tuned to English; survives RU only by accident of being min-width.
- `translation-item.ts:328-337` — `hasMetadata` and `previewTags` computed and never used. Dead signals.
- `borderFlash` (`translation-item.scss:268-277`) has no `prefers-reduced-motion` guard; neither does the density-toggle `icon-flip`.
- Focus ring `outline-offset: 2px` against 4px compact row gap — it will clip the neighbour.
- Base-locale row shows `help_outline` `?`, implying missing data. Base locale has no status by definition; use an em-dash or nothing.
- `side-tab` at `translation-list.scss:63` is on a notification banner rather than a card — defensible, but five siblings in the editor dialog make it a habit.

## Questions to Consider

1. Why is this a card at all? A table with sticky locale columns gives the i18n owner 11 locales × 40 keys in one screen and gives the translator the stable vertical column they lack.
2. If status is the spine, why can't you see it without reading? Nothing is legible in peripheral vision, at 50% zoom, or in a screenshot pasted into Slack.
3. The differentiator is that files are the truth and every change is a reviewable diff. Where is the diff? `stale` means the base changed; the row knows and won't show what changed.
4. Compact hides the base value; full makes it the headline. Both can't be right. Answering that honestly is what makes this component LingoTracker's instead of anyone's.
