# Glossary

Alphabetical reference for every domain term used in LingoTracker documentation. Each entry links to the spoke document where the concept is explained in full context.

Return to [architecture README](README.md).

---

## B

### Base Locale

The authoritative source language for all translation resources — the locale whose values are treated as the ground truth for staleness detection. Configured globally in `.lingo-tracker.json` as `baseLocale` (e.g. `"en"`) and overridable per collection. The base locale's value is what all other locale translations are derived from.

Tracker metadata for the base locale omits `status` and `baseChecksum`; only `checksum` is stored (the MD5 of the base value itself).

Explained in context: [`domain-and-data-model.md`](domain-and-data-model.md)

---

### Bundle

A generated JSON file (one per locale) that aggregates translation values from one or more [collections](#collection) into a flat or hierarchical format consumable by the Angular Transloco library. Bundles are defined in the `bundles` section of `.lingo-tracker.json`. Each bundle specifies a `dist` output directory, a `bundleName` pattern (e.g. `{locale}`), and which collections (or `"All"`) to include.

During bundle generation, ICU simple placeholder syntax (`{varName}`) is converted to Transloco double-brace syntax (`{{ varName }}`); complex ICU constructs (`plural`, `select`) pass through unchanged.

Explained in context: [`bundle-generation.md`](bundle-generation.md), [`core-library.md`](core-library.md)

---

### Bundle Selection

What a [bundle](#bundle) holds for one locale: each final key, its value, and the resource the value came from. In code, `libs/core/src/lib/bundle/bundle-selection.ts` has two functions. `resolveBundleCollections(definition, config, { cwd })` opens each [collection](#collection) the definition reads once per run (`'All'` means every collection, with every entry and no prefix), and reports a name the config does not have once: `Collection '<name>' not found in config`. `selectBundleEntries(collections, locale, { transformICUToTransloco, cache })` reads each collection for the locale through the [Collection Reader](#collection-reader), keeps the entries that match a rule (key pattern and [tags](#tags)), prepends `bundledKeyPrefix`, converts [ICU](#icu-format) to [Transloco](#transloco) when asked, and merges: the first value of a key wins, unless a later collection's `mergeStrategy` is `'override'`. It returns `{ entries, conflicts, warnings }`; each entry has a `value` and an `origin` (`collectionName`, `sourceKey`). Each collection's base value comes from its own [base locale](#base-locale); `COLLECTION_BASE_LOCALE` asks for every collection's base value. `generateBundle` writes the JSON files from it, `planBundle` counts keys and reports conflicts from it, and the type file takes its keys from it. None of them selects entries itself.

Explained in context: [`core-library.md`](core-library.md#bundle-selection), [`bundle-generation.md`](bundle-generation.md#entry-filtering-pipeline)

---

## C

### Checksum

An MD5 hash of a translation value, stored in [`tracker_meta.json`](#tracker-metadata) for every locale. Two checksums are tracked per non-base locale entry:

- **`checksum`** — MD5 of the current translation value for that locale.
- **`baseChecksum`** — MD5 of the [base locale](#base-locale) value at the time the translation was last written.

When the base value changes, a new `checksum` is computed for it. If `baseChecksum` no longer matches the base locale's current `checksum`, the translation is automatically marked [stale](#staleness).

Explained in context: [`domain-and-data-model.md`](domain-and-data-model.md), [`core-library.md`](core-library.md)

---

### Collection

A named group of translation [resources](#resource-entry) that share a common `translationsFolder` on disk and optional configuration overrides (base locale, locales, import/export folders, auto-translation settings, collection-level tags). Collections are defined under the `collections` key in `.lingo-tracker.json`.

Collections may declare a `tags?: string[]` array. These are **collection-level (inherited) tags** — every resource in the collection inherits them automatically at read time. See [Tags](#tags) for the inheritance model.

Example collections from the project's own config: `trackerResources` (the Tracker UI's own strings), `TestDataPlayground`, and `mockDesignSystem`.

**Collection (resolved).** Code outside the config module never reads a collection's raw entry to get its settings. `openCollection(config, name)` in `@simoncodes-ca/core` returns a `Collection` with the effective values: `baseLocale` (collection, else global, else `en`), `locales` (collection, else global, else none), `targetLocales` (the locales without the base locale), `translationConfig` (collection, else global; the two are not merged), the absolute `translationsFolder`, normalized `tags`, `protectedTermsFiles` (the paths of the global and collection [protected-terms](#protected-term) files, resolved but not read), and `readOnly`. It throws `CollectionNotFoundError` for an unknown name, and `ReadOnlyCollectionError` when `{ writable: true }` is set on a read-only collection. The CLI and the API both open collections this way. Every resource and folder operation (`addResource`, `editResource`, `deleteResource`, `moveResource`, `translateExistingResource`, `translateLocale`, `createFolder`, `deleteFolder`, `moveFolder`) takes the opened `Collection` as its first parameter, like the [Import run](#import-run), so the base locale and locales come only from it.

Explained in context: [`domain-and-data-model.md`](domain-and-data-model.md), [`cli.md`](cli.md), [`core-library.md`](core-library.md#config-and-collection-resolution)

---

### Collection Index

The API's in-memory copy of each open [collection's](#collection) [resource tree](#resource-tree). In code, `CollectionIndex` in `apps/api/src/app/cache/collection-index.service.ts` has four methods: `tree(collection, path)` and `search(collection, query, maxResults)` read, `status(collection)` answers the `cache/status` endpoint, and `apply(mutations)` takes the [resource mutations](#resource-mutation) of a write. Indexing on first read, revalidation against a disk fingerprint, patching, and the memory cap (least recently used eviction) are internal. When a patch does not match the tree, the index drops that collection and indexes it again on the next read. The HTTP endpoints and the Tracker UI still call it the "cache".

Explained in context: [`api.md`](api.md#collection-index)

---

### Collection Reader

The read side of the [Resource Folder](#resource-folder): the one walk over a [collection's](#collection) `translationsFolder`. In code, `readCollection(collection)` in `libs/core/src/lib/resource/read-collection.ts` opens every folder with the collection's [base locale](#base-locale) and returns `{ resources, problems }`. Each `StoredResource` has an address (`fullKey`, `folderPath`, `entryKey`), the `entry` as `ResourceFolder.treeEntry()` reads it, and `effectiveTags` ([Tags](#tags)). The rules are the same for every caller. Hidden folders are skipped. An entry without metadata is read with `metadata: {}`, so it counts as `new`. A folder whose file is not valid JSON, or that cannot be listed, is left out and returned as a problem, and the caller reports it. Export, validate, the [Bundle Selection](#bundle-selection) (bundle, dry-run plan and type file), the resource tree, disk search and the CLI `glossary` all read through it.

Explained in context: [`core-library.md`](core-library.md#collection-reader)

---

### Command Runner

The one place that runs a CLI command. In code, `defineCommand<Options>()(spec)` in `apps/cli/src/runner/command-runner.ts` returns the function `main.ts` calls. A command is a spec: a `name`, what it opens (`collection: 'writable' | 'read' | 'none'`, and `config: false` for `init` and `install-skill`), its `prompts` for missing values, the options it `required` (an absent flag, or an empty answer, fails; `run` sees them typed as present), and `run`, which makes the core call and prints. The runner does the rest the same way for every command. It finds the project root (`INIT_CWD`, else `process.cwd()`) and reads the one interactive rule (stdin and stdout are both a terminal, `runner/terminal.ts`). It loads the config with core `loadConfig`, then resolves the [collection](#collection): the flag, else the only one, else a prompt when interactive, else `Missing required option: --collection`. It opens the collection with core `openCollection`, asks the questions when interactive, checks the required options, and calls `run`. A cancel prints `❌ <name> cancelled.` once and exits 0. A thrown error prints `❌ <message>` and exits 1, as does an unknown collection or a missing required flag. `run` returns `{ exitCode: 1 }` for a failure it has already reported. The runner sets `process.exitCode` and never calls `process.exit()`.

Explained in context: [`cli.md`](cli.md#command-runner)

---

## E

### Export Run

One export of one or more [collections](#collection) to one file per target locale. In code, `runExport(collections, options)` in `libs/core/src/lib/export/run-export.ts` is the whole run: it chooses the locales (every collection's target locales, narrowed to the requested ones), filters each collection's resources by status and tags for the locales it has, annotates [protected terms](#protected-term), writes the JSON or XLIFF files, and returns the totals, an outcome per locale, and the Markdown summary. The collections must share one [base locale](#base-locale).

Explained in context: [`core-library.md`](core-library.md#export-pipeline)

---

## I

### ICU Format

The [ICU MessageFormat](https://unicode-org.github.io/icu/userguide/format_parse/messages/) standard for representing locale-sensitive strings. LingoTracker stores translation values in ICU format internally. Simple placeholders use single braces: `Hello {name}`. Complex constructs use keyword-based syntax: `{count, plural, one {# item} other {# items}}`.

During [bundle](#bundle) generation, simple `{varName}` placeholders are converted to Transloco's `{{ varName }}` syntax. Complex ICU constructs are passed through as-is because Transloco's messageformat pipe handles them natively.

Explained in context: [`domain-and-data-model.md`](domain-and-data-model.md), [`bundle-generation.md`](bundle-generation.md)

---

### Import Run

One import of a set of resources into one locale of one [collection](#collection). A format adapter (`parseJsonImport`, `parseXliffImport`) turns a file into resources; `importResources(collection, resources, options)` in `libs/core/src/lib/import/import-resources.ts` does the rest: strategy defaults, Transloco reference resolution (migration only), placeholder normalization and auto-fix, validation, and the per-[folder](#resource-folder) merge. The state of one run (settings, changes, warnings, errors, written files) lives in an `ImportSession`.

Explained in context: [`core-library.md`](core-library.md#import-pipeline)

---

## L

### Locale Seeding

What each of a [collection's](#collection) target locales gets when a resource's base value is written: the translation the caller supplied, else an auto-translation from the [Translator](#translator) when the collection enables it, else (or when the Translator skipped the locale) a copy of the base value with status `new`, except that on edit a real translation is kept (and is `stale`). In code, `seedLocales(collection, request)` in `libs/core/src/resource/locale-seeding.ts`. `addResource` applies it to every target locale; `editResource` applies it after a base value change, to the locales that need work by the [staleness rule](#staleness-rule), and never replaces a real translation with a copy. The API, the CLI and the Tracker do not decide this themselves.

Explained in context: [`core-library.md`](core-library.md#locale-seeding)

---

### Locale Metadata

The per-locale record stored within [`tracker_meta.json`](#tracker-metadata) for each [resource entry](#resource-entry). Defined by the `LocaleMetadata` interface in `@simoncodes-ca/domain`:

```typescript
interface LocaleMetadata {
  checksum: string;        // MD5 of this locale's current value
  baseChecksum?: string;   // MD5 of the base locale value at write time (non-base locales only)
  status?: TranslationStatus; // absent for the base locale
}
```

Explained in context: [`domain-and-data-model.md`](domain-and-data-model.md)

---

## P

### Preferred Terminology

A global list of rules. Each rule maps a **discouraged** source-language term to the **preferred** term, with an optional `reason`. LingoTracker warns when a base-locale value uses a discouraged term, and suggests the preferred one. It never blocks. Only an unreadable rule file fails `validate`.

The rules are project configuration rather than resource data. They live in a standalone JSON file, a bare array of rule objects. `.lingo-tracker.json` names that file with `preferredTerminologyFile`. Omit the setting and the rules fall back to `.lingo-tracker-preferred-terminology.json` beside the config. Collections cannot override the rules.

Matching is case-insensitive and whole-word, and it covers only the text a reader sees. ICU arguments and selectors, Transloco placeholders, and tags are skipped. The pure rule and matching functions live in `libs/domain`, so the Tracker UI and core share them.

Contrast with [Protected Term](#protected-term), which keeps a word unchanged in translations and blocks imports that alter it.

Explained in context: [`docs/features/preferred-terminology.md`](../docs/features/preferred-terminology.md)

---

### Protected Term

A word that must stay unchanged through translation. A brand name, a product name, or a piece of jargon all qualify. `iPhone` stays `iPhone` in every locale.

Protected terms are project configuration rather than resource data. Nothing about them reaches `resource_entries.json` or `tracker_meta.json`.

The list lives in a standalone JSON file, which holds a bare array of strings. `.lingo-tracker.json` names that file with `protectedTermsFile`. Omit the setting globally and the list falls back to `.lingo-tracker-protected-terms.json` beside the config. A [collection](#collection) may name a file of its own, and LingoTracker adds those terms to the global ones. A collection has no default file.

Example file:
```json
[
  "Acme",
  "C++",
  "iPhone",
  "Node.js"
]
```

A term matches only as a whole word. LingoTracker uses the list in three places. Export marks each string with the terms found in its source, as a `doNotTranslate` array in JSON and as a `Do not translate:` note in XLIFF. Import rejects any translation that omits a term present in the source. The [Translator](#translator) skips (does not store) a machine translation that omits one. The terms in force for a collection are read from `Collection.protectedTermsFiles` with `readProtectedTermsInForce`.

Explained in context: [`domain-and-data-model.md`](domain-and-data-model.md#protected-terms), [`core-library.md`](core-library.md#protected-terms-resolution)

---

### Public Surface

The names a library's `index.ts` barrel exports — everything a caller must know to use it. The `domain` and `core` barrels list their exports by name, never with `export *`. They list only names that something outside the library uses, plus the types those names' signatures need. A helper that only its own library uses stays exported from its file but not from the barrel. `libs/domain/src/index.spec.ts` pins domain's runtime exports, so adding one is a deliberate change.

Explained in context: [`monorepo-structure.md`](monorepo-structure.md#public-surface), [`core-library.md`](core-library.md#public-surface)

---

## R

### Resource Entry

A single translatable string identified by a [resource key](#resource-key). Stored as one JSON property in a `resource_entries.json` file. A resource entry contains:

- `source` — the base locale value (the source text)
- locale keys (e.g. `"es"`, `"fr-ca"`) — translation values
- optional `comment` — context for translators
- optional `tags` — string array for filtering during bundle/export

Example:
```json
{
  "title": {
    "source": "Delete Resource",
    "comment": "Title of the confirmation dialog",
    "tags": ["browser"],
    "es": "Eliminar recurso",
    "fr-ca": "Supprimer la ressource"
  }
}
```

Explained in context: [`domain-and-data-model.md`](domain-and-data-model.md)

---

### Resource Entry Draft

The translation editor's view of the [resource entry](#resource-entry) it is writing, as plain data: entry key, target folder, base value, comment, tags, and one value and status for each non-base locale. The pure module `apps/tracker/src/app/browser/dialogs/translation-editor/resource-entry-draft.ts` holds the editor's rules for a draft: dotted-key absorption, key collision, the "Where it lands" tree, tag edits, the create and update DTOs, and the unsaved-work check. The module has no Angular dependency.

Explained in context: [`frontend.md`](frontend.md#translation-editor-and-the-resource-entry-draft)

---

### Resource Folder

One folder of the translation hierarchy, seen as a unit: its `resource_entries.json` ([resource entries](#resource-entry)) and `tracker_meta.json` ([tracker metadata](#tracker-metadata)) are always read and written together. In code, `openResourceFolder()` returns a `ResourceFolder` (`libs/core/src/lib/resource/resource-folder.ts`), and every core operation that changes resources goes through it. Whole-collection reads go through it too, by way of the [Collection Reader](#collection-reader). It computes checksums and applies the [staleness rule](#staleness-rule).

Explained in context: [`core-library.md`](core-library.md#resource-crud-flows)

---

### Resource Mutation

One change that a core write made to a translations folder: `upsert` (key and the stored entry), `remove` (key), `add-folder` / `remove-folder` (path), or `reindex` (the change is too broad to describe, for example a locale was added). Each carries the absolute `translationsFolder` it applies to. `addResource`, `editResource`, `translateExistingResource`, `deleteResource`, `moveResource`, `createFolder`, `deleteFolder`, `moveFolder`, `addLocaleToCollection` and `removeLocaleFromCollection` return them as `mutations`. The type is in `libs/core/src/lib/resource/resource-mutation.ts`. The [Collection Index](#collection-index) uses them to update itself without reading the disk again.

Explained in context: [`api.md`](api.md#writes-resource-mutations)

---

### Resource Key

A dot-delimited string that uniquely identifies a [resource entry](#resource-entry) within a [collection](#collection). Segments may contain only alphanumeric characters, underscores, and hyphens (`[A-Za-z0-9_-]`).

Example: `apps.common.buttons.ok`

All segments except the last define the folder hierarchy on disk; the last segment is the entry key within `resource_entries.json`. See also [resolved key](#resolved-key).

Explained in context: [`libs-domain.md`](libs-domain.md)

---

### Resource Summary

One [resource entry](#resource-entry) as the API and the Tracker see it: an explicit address — `fullKey` (`apps.common.buttons.ok`), `folderPath` (`apps.common.buttons`, `''` at the root) and `entryKey` (`ok`) — the base locale and value, and one row per target locale of the [collection](#collection), in collection order, with `value`, `status`, `needsWork` (the [staleness rule](#staleness-rule)'s `needsTranslation`) and `sameAsBase` (`isUntranslatedCopy`, compared trimmed). The base locale and target locales come from the opened `Collection`, never from the metadata. In code, `buildResourceSummary(fullKey, entry, collection)` and `summaryTarget(summary, locale)` in `libs/domain/src/lib/resource-summary.ts`; `ResourceSummaryDto` in `data-transfer` is the same type. The Tracker's pure `row-view.ts` turns a summary into what one list row shows.

Explained in context: [`api.md`](api.md#mapper-layer), [`frontend.md`](frontend.md#translation-rows-and-the-row-view)

---

### Resolved Key

The fully qualified dot-delimited key after combining an input key with an optional [target folder](#target-folder). Resolution is additive: `resolvedKey = targetFolder + "." + key` (or just `key` if no target folder is specified).

Example: key `ok` with target folder `apps.common.buttons` resolves to `apps.common.buttons.ok`.

The resolved key determines the filesystem path: `apps/common/buttons/` folder, entry key `ok` in `resource_entries.json`.

Explained in context: [`libs-domain.md`](libs-domain.md)

---

## S

### Staleness

The condition where a translation's `baseChecksum` no longer matches the [base locale](#base-locale)'s current [checksum](#checksum). This means the source text changed after the translation was written, so the translation is out of sync. A stale resource carries `status: "stale"` in its [locale metadata](#locale-metadata) and will fail CI validation by default.

Staleness is detected automatically during resource reads — no explicit re-scan is required.

Explained in context: [`domain-and-data-model.md`](domain-and-data-model.md), [`core-library.md`](core-library.md)

---

### Staleness Rule

The one rule for what happens to translations when the [base locale](#base-locale) value changes (`applyBaseChange` in `libs/domain/src/lib/staleness.ts`): the base checksum is updated, every other locale's `baseChecksum` is set to the new base checksum, and its status becomes `stale` — or `new` when the translation is identical to the new base value (an untranslated copy). Edit, import, and normalize all use this rule. The same module holds `recordTranslation`, `needsTranslation`, and `resolveImportStatus`.

Explained in context: [`core-library.md`](core-library.md#resource-crud-flows)

---

## T

### Target Folder

An optional dot-delimited path prefix that scopes an input [resource key](#resource-key) to a specific folder within the collection's translation hierarchy. Used when a resource is created (`addResource`, `add-resource --target-folder`, `CreateResourceDto.targetFolder`) to place a short key (e.g. `ok`) at a specific location (e.g. `apps.common.buttons`) without repeating the full path in the key itself.

Validated to the same segment rules as a resource key (`[A-Za-z0-9_-]`). An empty string means no folder scoping.

An edit does not use it. `editResource(collection, key, { moveTo })` takes the full existing key, and `moveTo` is the folder the entry moves to (`''` for the collection root); `UpdateResourceDto.moveTo` and `edit-resource --target-folder` map to it.

Explained in context: [`domain-and-data-model.md`](domain-and-data-model.md), [`core-library.md`](core-library.md#collection-bound-operations), [`cli.md`](cli.md)

---

### Tracker Metadata

The `tracker_meta.json` file stored alongside every `resource_entries.json`. It holds [locale metadata](#locale-metadata) (checksums and translation status) for every resource entry in that folder, keyed first by entry key then by locale code.

Example:
```json
{
  "title": {
    "en": {
      "checksum": "cc367b544fab23df0ddaf982fb1445b5"
    },
    "es": {
      "checksum": "b2640f303143f6238cbbe0a626d23b11",
      "baseChecksum": "cc367b544fab23df0ddaf982fb1445b5",
      "status": "translated"
    }
  }
}
```

The base locale entry has only `checksum`. Non-base locale entries add `baseChecksum` and `status`.

Explained in context: [`domain-and-data-model.md`](domain-and-data-model.md)

---

### Transloco

The Angular internationalization library ([jsverse/transloco](https://jsverse.github.io/transloco/)) that LingoTracker is designed to integrate with. Transloco consumes locale JSON [bundle](#bundle) files at runtime. LingoTracker converts ICU simple placeholder syntax to Transloco's `{{ varName }}` interpolation syntax during bundle generation.

Explained in context: [`frontend.md`](frontend.md), [`bundle-generation.md`](bundle-generation.md)

---

### Tags

String labels that can be attached to [resource entries](#resource-entry) (stored in `resource_entries.json`) or to an entire [collection](#collection) (stored in `.lingo-tracker.json`). Tags are used to filter resources during bundle generation and export/import.

**Per-resource tags** — stored as `tags?: string[]` on each resource entry. Set via `add-resource --tags`, `edit-resource --tags`, or the Tracker UI chip input.

**Collection-level (inherited) tags** — declared as `tags?: string[]` on the collection config. Every resource in the collection inherits these tags at read time without them being written to `resource_entries.json`. The merge rule is: `effectiveTags = union(collectionTags, resourceTags)` (deduped, normalized). This is implemented in `libs/domain/src/lib/effective-tags.ts`.

Inheritance is:
- **Additive only** — no negative/override syntax. To exempt a resource from a tag, move it to a different collection.
- **Not stored in bundle files** — the destination collection's own config re-applies its tags on import.
- **Visible in the Tracker UI** — inherited tags are shown as dashed-border chips with a tooltip; they cannot be removed per-resource.

Tag normalization: lowercase, hyphens replace spaces, non-`[a-z0-9-]` stripped, max 50 chars.

Explained in context: [`domain-and-data-model.md`](domain-and-data-model.md), [`cli.md`](cli.md), [`api.md`](api.md)

---

### Typed Errors

The errors core raises on purpose. Each is a subclass of `LingoTrackerError` (`libs/core/src/lib/errors/lingo-tracker-error.ts`) with a stable `code` (for example `RESOURCE_NOT_FOUND`) and typed payload fields (for example `key`). The message text comes from `ErrorMessages`. Adapters decide with `instanceof`, never by matching the message: the API maps each class to one HTTP status in `LingoTrackerExceptionFilter`, and the CLI prints the message. Domain validators throw plain `Error`; core converts them to typed errors in one place.

Explained in context: [`core-library.md`](core-library.md#error-model), [`api.md`](api.md#error-mapping), [`cli.md`](cli.md#errors-and-exit-codes)

---

### Translation Status

An enum (`TranslationStatus` in `@simoncodes-ca/domain`) that tracks the review lifecycle of a non-base locale translation. Four possible values:

| Status | Meaning | CI validation result |
|---|---|---|
| `new` | Resource added but not yet translated (value is a copy of the base) | Failure |
| `translated` | Has a translation value but not reviewed | Failure by default; warning with `--allow-translated` |
| `stale` | Base locale value changed after translation was written | Failure |
| `verified` | Translation reviewed and approved by a language expert | Success |

The lifecycle flows: `new` → `translated` → `verified`. If the base value changes after `verified`, the status automatically reverts to `stale`.

Explained in context: [`domain-and-data-model.md`](domain-and-data-model.md), [`bundle-generation.md`](bundle-generation.md), [`domain-and-data-model.md`](domain-and-data-model.md)

---

### Translation Status Summary

The roll-up of a set of locale [translation statuses](#translation-status): the number of locales in each status (`StatusCounts`) and the worst status. The pure module `libs/domain/src/lib/translation-status-summary.ts` holds the rules. `countByStatus(statuses)` counts the statuses and ignores a locale with no status. `worstStatus(counts)` applies `STATUS_PRECEDENCE`, which is worst first: `stale` > `new` > `translated` > `verified`. Every roll-up in the Tracker UI uses this module: the rollup ring, the screen-reader breakdown, the locale column, the status filter counts, and sort by status. The glyphs, label tokens and display order are presentation. They are in one Tracker table, `shared/translation-status/translation-status-presentation.ts`, which the rows and the translation editor's status labels both use.

Explained in context: [`frontend.md`](frontend.md#translation-status-summary)

---

### Translator

The one way core machine-translates text for a [collection](#collection). In code, `openTranslator(collection, { provider?, protectedTerms? })` in `libs/core/src/lib/translation/translator.ts` returns a `Translator` with one method, `translate(entries, locales) → { values, skipped }`. Opening it checks that the collection's translation config is enabled (`AutoTranslationDisabledError`) and, unless a provider is injected, reads the API key (`TranslationError` `MISSING_API_KEY`) and builds the configured provider. It reads the collection's protected terms once, unless they are passed (`ProtectedTermsFileError` for a malformed file). `translate` makes one provider call per locale and ignores the base locale. It never sends complex [ICU](#icu-format). It protects simple placeholders and skips a translation that lost a marker. It skips a translation that dropped a [protected term](#protected-term) present in the source. It returns every value normalized to ICU. Each skip carries a reason: `complex-icu`, `placeholder-mismatch` or `protected-term`. [Locale seeding](#locale-seeding), `translateExistingResource` and `translateLocale` all translate through it; they only choose what needs work (the [staleness rule](#staleness-rule)) and store the values. The provider is the seam: `GoogleTranslateV2Provider` in production, `InMemoryTranslationProvider` (a deterministic transform that records its calls, internal to core) in core's specs.

Explained in context: [`core-library.md`](core-library.md#auto-translation-pipeline)
