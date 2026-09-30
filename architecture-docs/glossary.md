# Glossary

Alphabetical reference for every domain term used in LingoTracker documentation. Each entry links to the spoke document where the concept is explained in full context.

Return to [architecture README](README.md).

---

## A

### API Error

The one error value the Tracker UI sees for a failed API request (`ApiError` in `apps/tracker/src/app/shared/api-error/api-error.ts`). A functional `HttpClient` interceptor, installed once by `provideTrackerHttpClient()`, converts every failed response at the HTTP seam — every `HttpClient` request goes through it, the API clients and the Transloco loader alike — so Angular's `HttpErrorResponse` never reaches a store or a dialog. An `ApiError` carries a `kind` shrunk to what a consumer branches on (`invalid`, `not-found`, `conflict`, `other`), the real HTTP `status`, the `serverMessage` of the API's `{ statusCode, message, error }` body when it had one, and the body's `errors` array as `details` (bundle rule messages, preferred-terminology rule errors). Consumers decide with `kind` and show `apiErrorMessage(error, fallback)`: the server's message, else their own localized fallback. No status is special: the API's catch-all answers an unmapped exception with a 500 that carries no message, so it lands on the fallback by the same rule, and a 500 that does carry one (an `InvalidConfigError` naming what is wrong with `.lingo-tracker.json`) is shown as is. It is the Tracker's counterpart of the [typed errors](#typed-errors) the API maps to HTTP.

Explained in context: [`frontend.md`](frontend.md#api-errors--one-adapter-at-the-http-seam), [`api.md`](api.md#error-mapping)

---

## B

### Base Locale

The authoritative source language for all translation resources — the locale whose values are treated as the ground truth for staleness detection. Configured globally in `.lingo-tracker.json` as `baseLocale` (e.g. `"en"`) and overridable per collection. The base locale's value is what all other locale translations are derived from.

Tracker metadata for the base locale omits `status` and `baseChecksum`; only `checksum` is stored (the MD5 of the base value itself).

Explained in context: [`domain-and-data-model.md`](domain-and-data-model.md)

---

### Browser Session

The one path that opens a [collection](#collection) in the Tracker UI. In code, `openCollection(settings)` in `apps/tracker/src/app/browser/store/features/with-browser-session.feature.ts`, a feature of the root-provided `BrowserStore`. It takes a `CollectionSettings`, the Tracker's [resolved collection](#collection) (`resolveCollectionSettings(config, name)` in `apps/tracker/src/app/collections/store/collection-settings.ts`, with core's rules: `baseLocale` is the collection value if it is non-empty, else the global one if non-empty, else `en` (`||`, so an empty string falls through); `locales` collection, else global, else none; `translationEnabled` from the collection `translation` config, else the global one, not merged; `readOnly`). It bumps the session counter `sessionId`, starts every store feature at its own initial state (each feature exports it; the session names no other feature's fields), stores the settings as `collectionSettings` (with the projections `selectedCollection`, `availableLocales`, `baseLocale`, `isReadOnly`), restores the collection's saved view preferences (`restoreViewPreferences`, owned by the view-preferences feature, which reads a missing or retired `medium` density as `compact`), and starts index polling. Store loaders capture `sessionId` when a request starts and drop the response if another open has happened since (`captureSession`/`withinSession` in `apps/tracker/src/app/browser/store/session-guard.ts`), so a slow response from the previous collection, or from an earlier open of the same one, never lands in the new session. The [List Scope](#list-scope)'s loads are cancelled outright on every open, not just dropped. This includes the entry writes (`createResource`, `updateResource`, `deleteResource`, `translateResource`): each still resolves its Observable for the caller, but only patches or drops a cache row while its own session is still open, so the translation editor dialog's save cannot land in a collection that replaced the one it was editing. Because the store outlives the route, this is what keeps one collection's search results, folder selection, folder tree or pending folder operation from showing up in the next collection. **Re-entering the open collection is not an open**: the user keeps their place (folder, expansion, search box and results, filters), and only `updateSettings(settings)` runs. A `readOnly` or `translationEnabled` change writes the changed settings in place; equal settings, as on an unrelated config reload, are a no-op. A change to `locales`, `baseLocale` or `translationsFolder` invalidates data cached under the old settings, so `updateSettings` runs `openCollection(settings)` instead — a fresh session, with the collection's saved view preferences restored against its current locales (dropping any locale the collection no longer has, so it cannot leave a stale column on screen or in storage). `collectionSettings` is the browser's one source of settings, `translationEnabled` and `translationsFolder` included. The `TranslationBrowser` route component is the only production caller of both methods.

Explained in context: [`frontend.md`](frontend.md#browserstore--feature-composition)

---

### Bundle

A generated JSON file (one per locale) that aggregates translation values from one or more [collections](#collection) into a flat or hierarchical format consumable by the Angular Transloco library. Bundles are defined in the `bundles` section of `.lingo-tracker.json`. Each bundle specifies a `dist` output directory, a `bundleName` pattern (e.g. `{locale}`), and which collections (or `"All"`) to include.

During bundle generation, ICU simple placeholder syntax (`{varName}`) is converted to Transloco double-brace syntax (`{{ varName }}`); complex ICU constructs (`plural`, `select`) pass through unchanged.

Core generates a saved bundle by its name for the API. For a CLI run, `generateBundles(config, { names?, locales?, overrides, cwd })` selects all or named bundles, prepares each request once, continues after an individual failure, and returns one outcome per bundle plus totals. [Bundle Run Preparation](#bundle-run-preparation) supplies the shared settings for generation and planning. Type generation has one outcome: written, skipped, failed, or not configured; a deprecated-setting warning travels with that outcome even when type writing fails, for the CLI to print or the API job to log.

Explained in context: [`bundle-generation.md`](bundle-generation.md), [`core-library.md`](core-library.md)

---

### Bundle Definition

One entry under `bundles` in `.lingo-tracker.json`: how a [bundle](#bundle) is built. It lives in domain, so core, the API, the CLI and the Tracker share one type and one set of rules. In code, `libs/domain/src/lib/bundle-definition.ts` declares `BundleDefinition` (`bundleName`, `dist`, `collections`, and the optional `typeDistFile`, `tokenCasing`, `tokenConstantName`, `transformICUToTransloco`), `CollectionBundleDefinition` and `EntrySelectionRule`. The data-transfer `BundleDefinitionDto` types are aliases of these, so the API does not map them. The rules are pure. `validateBundleKey(key)` accepts letters, digits, hyphens and underscores. `validateBundleDefinition(definition, collectionNames)` returns every problem at once: `bundleName` needs the `{locale}` placeholder, `dist` is required, each collection must exist and appear only once per `bundledKeyPrefix`, rules need a `matchingPattern`, `tokenCasing` is `upperCase` or `camelCase`, `typeDistFile` must end in `.ts` and `tokenConstantName` must be a JavaScript identifier. `normalizeBundleDefinition(definition)` trims strings, drops empty optionals and empty tags, keeps the `'All'` literals, moves a legacy `typeDist` to `typeDistFile`, and never throws on malformed input. `checkBundleDefinition(definition, collectionNames, key?)` runs both and returns the normalized definition with every error (key errors first); it is the one check core, the API dry run and the Tracker form run. `findBundleDefinition(bundles, key)` looks a key up by own property only. `bundleOutputFile(definition, locale)` is the file core writes for a locale: `<dist>/<bundleName with {locale} replaced>.json`, with `/` separators and no leading `./`. Core's add and update operations run `checkBundleDefinition` and throw `InvalidBundleDefinitionError`. The API dry run runs the same check, and the Tracker bundle form runs it on submit.

Explained in context: [`core-library.md`](core-library.md#bundle-definition), [`api.md`](api.md#bundles), [`frontend.md`](frontend.md#bundle-form-dialog)

---

### Bundle Draft

The Tracker bundle form's raw choices, including inherited settings and disabled type options. `apps/tracker/src/app/collections/bundle-form-dialog/bundle-draft.ts` maps definitions to and from those choices, gates dry-run requests, derives preview paths and trees, and chooses the first invalid section. It has no Angular dependency; the dialog owns the form and preview state.

Explained in context: [`frontend.md`](frontend.md#bundle-form-dialog)

---

### Bundle Run Preparation

The core step shared by a dry-run plan and generation. `prepareBundleRun` in `libs/core/src/lib/bundle/prepare-bundle-run.ts` takes `source: 'supplied'` with a definition for a full Bundle Definition and locale check, or `source: 'saved'` with a name for the existing lookup and locale check. Both modes resolve settings (including the token constant name) and return `{ definition, settings, locales, collections, typeWarning, tokenConstantNameOverride }`. Collections open on first use. A saved bundle with a deleted collection keeps running with a warning. The job service prepares synchronously before queueing. `selectPreparedBundleLocale` selects one locale and adds the empty-bundle warning in one place.

Explained in context: [`bundle-generation.md`](bundle-generation.md#where-bundle-generation-lives), [`api.md`](api.md#bundles)

---

### Bundle Selection

What a [bundle](#bundle) holds for one locale: each final key, its value, and the resource the value came from. In code, `libs/core/src/lib/bundle/bundle-selection.ts` has two functions. `resolveBundleCollections(definition, config, { cwd })` opens each [collection](#collection) the definition reads once per run (`'All'` means every collection, with every entry and no prefix). For saved generation it warns once about an unknown collection; a supplied dry-run definition is rejected before selection. `selectBundleEntries(collections, locale, { transformICUToTransloco, cache })` reads each collection for the locale through the [Collection Reader](#collection-reader), keeps the entries that match a rule (key pattern and [tags](#tags)), prepends `bundledKeyPrefix`, converts [ICU](#icu-format) to [Transloco](#transloco) when asked, and merges: the first value of a key wins, unless a later collection's `mergeStrategy` is `'override'`. It returns `{ entries, conflicts, warnings }`; each entry has a `value` and an `origin` (`collectionName`, `sourceKey`). Each collection's base value comes from its own [base locale](#base-locale); `COLLECTION_BASE_LOCALE` asks for every collection's base value. `generateBundle` writes the JSON files from it, `planBundle` counts keys and reports conflicts from it, and the type file takes its keys from it. None of them selects entries itself.

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

### CLI Help Text

The long examples appended to `import`, `validate`, and `preferred-terminology` help. `apps/cli/src/runner/help-text.ts` holds these strings so the [Command Registration](#command-registration) list stays short. Registration passes each string to Commander's `addHelpText('after', ...)` unchanged.

Explained in context: [`cli.md`](cli.md#command-runner)

---

### CLI Option Definitions

Reusable Commander flag declarations in `apps/cli/src/runner/options.ts`. A definition registers one option when the [Command Registration](#command-registration) is applied. `option({ flags, description?, defaultValue?, parse? })` states which strings are help descriptions and which values Commander parses by default. The module owns the collection flag, token casing choices, repeatable list parser, shared `init` and `add-collection` flags, `--yes`, resource field groups, and the value conversions for `--setup-bundle`, `validate --skip-locales`, and `find-similar --max-results`.

Explained in context: [`cli.md`](cli.md#command-runner)

---

### Collection

A named group of translation [resources](#resource-entry) that share a common `translationsFolder` on disk and optional configuration overrides (base locale, locales, import/export folders, auto-translation settings, collection-level tags). Collections are defined under the `collections` key in `.lingo-tracker.json`.

Collections may declare a `tags?: string[]` array. These are **collection-level (inherited) tags** — every resource in the collection inherits them automatically at read time. See [Tags](#tags) for the inheritance model.

Example collections from the project's own config: `trackerResources` (the Tracker UI's own strings), `TestDataPlayground`, and `mockDesignSystem`.

**Collection (resolved).** Code outside the config module never reads a collection's raw entry to get its settings. `openCollection(config, name)` in `@simoncodes-ca/core` returns a `Collection` with the effective values: `baseLocale` (collection, else global, else `en`), `locales` (collection, else global, else none), `targetLocales` (the locales without the base locale), `translationConfig` (collection, else global; the two are not merged), the absolute `translationsFolder`, normalized `tags`, `termFiles` (the paths of the [protected-terms](#protected-term) and [preferred-terminology](#preferred-terminology) files, resolved but not read; `readProjectTerms(collection)` reads them as the [Project Terms](#project-terms)), and `readOnly`. It throws `CollectionNotFoundError` for an unknown name, and `ReadOnlyCollectionError` when `{ writable: true }` is set on a read-only collection. The CLI and the API both open collections this way. Every resource and folder operation (`addResource`, `editResource`, `deleteResource`, `moveResource`, `translateExistingResource`, `translateLocale`, `createFolder`, `deleteFolder`, `moveFolder`) takes the opened `Collection` as its first parameter, like the [Import run](#import-run), so the base locale and locales come only from it.

Explained in context: [`domain-and-data-model.md`](domain-and-data-model.md), [`cli.md`](cli.md), [`core-library.md`](core-library.md#config-and-collection-resolution)

---

### Collection Entry

The write side of a [collection's](#collection) record in `.lingo-tracker.json`: the one place that decides what the stored entry contains. In code, `libs/core/src/lib/config/collection-entry.ts` holds three pure functions over the in-memory config: `toCollectionEntry(config, collection)` builds the record (`translationsFolder`, trimmed, plus only the settings that differ from the global config, so a collection inherits by omission; `translation` is kept verbatim; `readOnly` only when true; tags normalized), `addCollectionEntry` registers it (a folder under `node_modules` is read-only unless the caller decides) and `patchCollectionEntry` changes it, with an optional rename in place. Patch semantics: a field the patch sets replaces the stored value (a setting is cleared, so the collection inherits, with its empty value: `tags: []`, `readOnly: false`, `locales: []`, and `''` for `exportFolder`, `importFolder`, `baseLocale` and `protectedTermsFile`; `translation` has no empty value and cannot be cleared by a patch, only replaced), a field set to `null` is `InvalidCollectionError`, and a field left out or `undefined` keeps its stored value, so a client that never sends `translation`, `exportFolder` or `importFolder` cannot lose them; the merged record is then re-minimized. An empty `locales` list means inherit, never "no locales". The rule for every field is listed once, keyed by the `LingoTrackerCollection` type, so a new field does not compile until its rule is written. `addCollection`, `editCollectionTags` and `setCollectionProtectedTermsFile` write through it. `updateCollection`, `addLocaleToCollection` and `removeLocaleFromCollection` share one locale-change path: validate, read every folder, seed added locales, purge removed locales, then write the minimized record once through `patchCollectionEntry`. A changed record returns reindex mutations for the old and new translations folders. The errors are typed: `CollectionNotFoundError`, `CollectionAlreadyExistsError`, `InvalidCollectionError`.

Explained in context: [`core-library.md`](core-library.md#config-and-collection-resolution)

---

### Collection Index

The API's in-memory copy of each open [collection's](#collection) [resource tree](#resource-tree). In code, `CollectionIndex` in `apps/api/src/app/cache/collection-index.service.ts` has four methods: `tree(collection, path)` and `search(collection, query, { mode, limit })` read (search runs [Resource Search](#resource-search) over the index tree, or over the disk before the collection is indexed), `status(collection)` answers the `cache/status` endpoint, and `apply(mutations)` takes the [resource mutations](#resource-mutation) of a write. Indexing on first read, revalidation against a disk fingerprint, patching, and the memory cap (least recently used eviction) are internal. When a patch does not match the tree, the index drops that collection and indexes it again on the next read. The HTTP endpoints and the Tracker UI still call it the "cache".

Explained in context: [`api.md`](api.md#collection-index)

---

### Collection Lifecycle

The core operation that registers or changes a [Collection Entry](#collection-entry) together with its optional protected terms. `addCollection(name, collection, { cwd?, protectedTerms? })` and `updateCollection(name, newName, patch, { cwd?, protectedTerms? })` check the term list and the resulting entry before their first write. The resulting entry supplies the file pointer, including one supplied in the same request or retained through a rename. A missing pointer raises `ProtectedTermsFileNotSetError` and changes no file. After any locale file changes required by an update, core writes `.lingo-tracker.json` and then the protected-terms file. The two files are not atomic: if the terms write itself fails, the config entry remains written. `editCollectionTags(name, { add?, remove?, set? }, { cwd? })` edits inherited tags in the registration, with core enforcing flag combinations and normalization. `initConfig(config, { cwd? })` validates and creates a config through the same config write path with an exclusive file create, refusing an existing file even when it appears during the write.

Explained in context: [`core-library.md`](core-library.md#config-and-collection-resolution), [`api.md`](api.md#collections), [`cli.md`](cli.md)

---

### Collection Reader

The read side of the [Resource Folder](#resource-folder): the one walk over a [collection's](#collection) `translationsFolder`. In code, `readCollection(collection)` in `libs/core/src/lib/resource/read-collection.ts` opens every folder with the collection's [base locale](#base-locale) and returns `{ resources, problems }`. Each `StoredResource` has an address (`fullKey`, `folderPath`, `entryKey`), the `entry` as `ResourceFolder.treeEntry()` reads it, and `effectiveTags` ([Tags](#tags)). The rules are the same for every caller. Hidden folders are skipped, with everything below them; this rule, and the rules for a missing or unlistable folder, are the collection-folder policy that the [Collection Sweep](#collection-sweep) shares. An entry without metadata is read with `metadata: {}`, so it counts as `new`. A folder whose file is not valid JSON, or that cannot be listed, is left out and returned as a problem, and the caller reports it. Export, validate, the [Bundle Selection](#bundle-selection) (bundle, dry-run plan and type file), the resource tree, [Resource Search](#resource-search) on the disk (the API before indexing, the CLI `find-similar`) and the CLI `glossary` all read through it.

Explained in context: [`core-library.md`](core-library.md#collection-reader)

---

### Collection Sweep

The write side of the [Resource Folder](#resource-folder), the twin of the [Collection Reader](#collection-reader): the one walk that writes over many folders of a [collection](#collection). In code, `sweepCollection(collection, { startPath? })` in `libs/core/src/lib/resource/collection-sweep.ts` yields each collection folder under `startPath` (default: the root) opened with the collection's [base locale](#base-locale), or a problem for a folder it cannot read (invalid JSON, or not listable). The caller changes and saves each folder, and decides what a problem means. `sweepKeys` is the same sweep reduced to the full keys and the problems. It visits the same folders as the reader: hidden folders and everything below them are not part of the collection. The shared locale-change path for add-locale, remove-locale and edit-collection reads every folder before writing; normalize, folder delete (its entry count), folder move and the wildcard resource move go through it.

Explained in context: [`core-library.md`](core-library.md#collection-sweep)

---

### Command Registration

The CLI declaration that connects a name, description, ordered option definitions, optional positional argument and help text to a lazy command import. `registerCommand<Options>(program, registration)` in `apps/cli/src/runner/register-command.ts` installs it on Commander, then loads and invokes the handler when the action runs. Its optional `mapOptions(raw, args)` converts raw flags and positional arguments before invocation. The shared [CLI Option Definitions](#cli-option-definitions) supply repeated flags and parsers.

Explained in context: [`cli.md`](cli.md#command-runner)

---

### Command Runner

The CLI execution path. `registerCommand(program, registration)` applies the command's flags to Commander; `defineCommand<Options>()(spec)` in `apps/cli/src/runner/command-runner.ts` returns the function its lazy action calls. A command spec has a `name`, what it opens (`collection: 'writable' | 'read' | 'many' | 'none'`, and `config: false` for `init` and `install-skill`), its `prompts` for missing values, the options it `required` (an absent flag, or an empty answer, fails; `run` sees them typed as present), and `run`, which makes the core call and prints. The runner finds the project root (`INIT_CWD`, else `process.cwd()`), reads the interactive rule, and loads the config. For one collection it resolves the flag, the only configured name, or an interactive selection. For `many` it supplies all opened collections to prompt builders, then selects all or an ordered, deduplicated list after the prompts. An empty config or unknown name fails with exit 1. The four many-collection commands are `validate`, `export`, `normalize`, and `glossary`; `normalizeCollections` in core applies the named versus all read-only rule after receiving the opened collections. The runner handles cancellation and errors, sets `process.exitCode`, and never calls `process.exit()`.

Explained in context: [`cli.md`](cli.md#command-runner)

---

### Config Write

One write to `.lingo-tracker.json` from the Tracker UI, and the one way its outcome comes back. In code, `injectConfigWrite(store)` in `apps/tracker/src/app/collections/store/config-write.ts` returns the function that runs one, and every mutation of `CollectionsStore` is: `createCollection`, `updateCollection`, `deleteCollection`, `updateGlobalConfig`, and the bundle feature's `createBundle`, `updateBundle`, `deleteBundle`. Each sends its request, reloads `GET /api/config`, stores the config, and returns an Observable of that config, so the caller hears back only once the store already holds what the server holds; if that reload fails, the write still happened, so the Observable resolves with `null` and the store reports the load failure in `error`; a rejected write errors with the [API Error](#api-error) of the request (`conflict` for a taken name, `invalid` with the rule messages or the per-row preferred-terminology errors as `details`, anything else) and leaves the store as it was. The Observable is cold, like the browser store's entry writes: nothing is sent until the caller subscribes, and the caller owns the reaction. The collection and bundle form dialogs write through the store themselves, cannot be closed while the write is in flight, and close only on success; a taken name lands on the name field, any other refusal on an error line in the dialog (the bundle dialog lists the server's rule messages). The collections manager toasts a create or edit only when a dialog closes with a saved result, and awaits a delete's outcome before it toasts. Settings Draft handles the save outcome: the saved config reseeds both lists, while the page gives one toast (a failed reload still earns the toast); a refusal keeps every edit and maps rule errors onto the rows that were sent, while the page shows its message. The store's `error` signal reports only a failed load (the initial one, or the reload after a write).

Explained in context: [`frontend.md`](frontend.md#collectionsstore)

---

### Confirmation

Confirmation is one boolean answer from the shared `ConfirmationDialog`. `injectConfirm()` in `apps/tracker/src/app/shared/confirm.ts` lazily opens the dialog with the caller's data and options, then resolves `true` only for an explicit confirmation. Cancel, backdrop close, and a close without an emitted result resolve `false`. A caller can supply a Browser Session guard checked after loading and before opening.

Explained in context: [`frontend.md`](frontend.md#lazy-loaded-dialogs)

---

## D

### Dialog Config Submit

Dialog Config Submit is how the collection and bundle form dialogs submit a [Config Write](#config-write). `submitDialogConfigWrite()` in `apps/tracker/src/app/collections/store/dialog-config-submit.ts` sets `saving`, locks closing during the write, closes with the caller's saved result on success, and restores the previous close setting and `saving` on refusal. `NamedEntrySubmit` in the same module owns the server-taken-name validator, the create/update choice and rename patch, the editable-name conflict, and the localized refusal fallback for both forms. It returns a name conflict or a message with API details; each form renders that outcome in its own fields. `classifyConfigRefusal()` still gives other callers a `conflict`, `invalid`, or `other` refusal and preserves API details for every kind. The settings page uses that classification for preferred-terminology rule errors but owns its save subscription because it is a page and must keep saving after navigation.

Explained in context: [`frontend.md`](frontend.md#bundle-form-dialog)

---

## E

### Editor Location

The translation editor's folder-selection state in `apps/tracker/src/app/browser/dialogs/translation-editor/editor-location.ts`. It owns the selected folder, dotted-key continuation, known entries from the browser and [Folder Peek](#folder-peek), the live key collision and "Where it lands" tree, and the decision to peek an unknown target folder. An edit can peek its original folder or a destination; its own key is exempt from collision only in the original folder. The dialog keeps the form, popover staging and filter, focus and save protocol.

Explained in context: [`frontend.md`](frontend.md#translation-editor-and-the-resource-entry-draft)

---

### Editor Outcome

How the Tracker's translation editor closed: the one result its launcher reads. In code, the `EditorOutcome` union in `apps/tracker/src/app/browser/dialogs/translation-editor/editor-submit.ts`, with five kinds: `saved` (an edit stayed in its folder), `moved` (an edit with a `moveTo`, with the new key and folder), `created`, `open-existing` (the key is taken and the user asked for the entry that holds it) and `cancelled` (no write, a dialog closed without a result, or an edit the server found nothing to change in). `saved`, `moved` and `created` carry the locales auto-translation skipped. `TranslationEditorLauncher` opens every create and edit (`openCreate`, `openEdit`, `openByFullKey`) and gives the feedback for each outcome: the toasts, and for `open-existing` the move of the list to the entry's folder and an edit of it, whose outcome the hand-off resolves with. The reload after a write is the store's, not the launcher's.

Explained in context: [`frontend.md`](frontend.md#the-editor-outcome)

---

### Editor Submit

The translation editor's save protocol in `apps/tracker/src/app/browser/dialogs/translation-editor/editor-submit.ts`. `submitGate(state)` returns the first blocking reason in this order: read-only, submitting, invalid form, key collision, comment confirmation. `submitEditor({ mode, draft, original, writes })` uses the [Resource Entry Draft](#resource-entry-draft) to build a create or update request, calls the supplied store write, and returns an Observable of an [Editor Outcome](#editor-outcome) or a classified refusal. One classifier handles both create and update API errors. The dialog chooses the existing localized message, conflict dialog and focus behavior for each refusal. [Editor Location](#editor-location) gathers known entries; `editor-entry-sources.ts` derives tag suggestions.

Explained in context: [`frontend.md`](frontend.md#translation-editor-and-the-resource-entry-draft)

---

### Entry Relocation

The one way [resource entries](#resource-entry) move between keys, inside a [collection](#collection) or into another one. In code, `relocateEntries(source, destination, relocations, { override? })` in `libs/core/src/lib/resource/relocate-entries.ts` takes a list of `{ from, to }` full keys and returns `{ moved, collisions, errors, mutations }`. It moves them as one batch: each [Resource Folder](#resource-folder) involved is opened and saved once, and only after every folder it sends entries to, so a failed write leaves no moved entry lost (except inside a cycle of folders that swap entries). The copy is lossless (checksums and statuses are kept; nothing is auto-translated). One collision rule applies: a destination key held by an entry that is not moving away is a collision, unless `override` replaces it; a key the batch frees is free. An entry moved into another collection is fitted to its locales: locales the destination does not have are dropped, and missing ones are seeded as a `new` copy of the base (the [Locale Seeding](#locale-seeding) fallback). Both collections must have the same [base locale](#base-locale). `editResource` (`moveTo`), `moveResource` and `moveFolder` move through it.

Explained in context: [`core-library.md`](core-library.md#entry-relocation)

---

### Existence Policy

`addResource` and `addResources` refuse an existing resolved key by default with `ResourceAlreadyExistsError`. Pass `onExisting: 'replace'` to replace its translations and metadata. The check happens before locale seeding or any write. A batch checks every item before translating any of them; duplicate resolved keys within a batch are always refused. The API uses `fail`; the CLI uses `fail` unless `--override` is passed or an interactive user confirms replacement.

Explained in context: [`core-library.md`](core-library.md#add-resource)

---

### Export Run

One export of one or more [collections](#collection) to one file per target locale. In code, `runExport(collections, options)` in `libs/core/src/lib/export/run-export.ts` is the whole run: it validates the base property name and output directory, resolves the output path from the explicit option, configured folder, or default, chooses the locales (every collection's target locales, narrowed to the requested ones), filters each collection's resources by status and tags for the locales it has, annotates [protected terms](#protected-term), writes the JSON or XLIFF files, and returns the totals, an outcome per locale, and the Markdown summary. An empty `locales` list means no target remains. It calls `onStart` with the resolved path and locales before reading resources, so the CLI can print the plan. Collections with targets must share one [base locale](#base-locale).

Explained in context: [`core-library.md`](core-library.md#export-pipeline)

---

## F

### Folder Address

A dot-delimited path to a folder in a [collection](#collection), such as `apps.common.buttons`. The empty address names the translations root. `lib/resource/folder-address.ts` validates each segment with the domain `isValidSegment` rule, resolves the address beneath the collection's `translationsFolder`, and checks whether that path exists. Folder create, delete and move decide whether the root is allowed and retain their own error labels; `createFolder` returns the resolved Folder Address as `folderAddress`, with a whitespace-only parent treated as the root; wildcard resource moves use key-style diagnostics for their prefix.

Explained in context: [`core-library.md`](core-library.md#resource-crud-flows)

---

### Folder Move Plan

The Tracker's pure store-side decision for a successful or failed folder move. In `apps/tracker/src/app/browser/store/folder-move-plan.ts`, `planFolderMove` receives the current tree and expansion plus the source node captured before HTTP, then returns expansion changes, the path to show, and either a tree patch with any destination-child load or a root reload. `planFolderMoveRollback` restores an absent source only when its parent is loaded. `withFolderWritesFeature` applies these decisions after its [Browser Session](#browser-session) guard; it still owns HTTP, loaders, navigation, and outcomes.

Explained in context: [`frontend.md`](frontend.md#optimistic-updates-with-rollback)

---

### Folder Peek

A read of one folder's entries without changing the [List Scope](#list-scope). `FolderPeek.openFolderPeek()` gives each translation editor dialog a scope with its own successful-read cache. A later dialog gets a fresh scope and fresh data. `openByFullKey` also opens a fresh scope for each hand-off. Concurrent scopes share an in-flight API request, but no completed result. A response from an earlier [Browser Session](#browser-session) is dropped; a failed read can be retried.

Explained in context: [`frontend.md`](frontend.md#translation-editor-and-the-resource-entry-draft)

---

### Folder Writes

The Tracker UI's one store feature for creating, deleting and moving folders, and for dropping a resource into a folder. `withFolderWritesFeature` in `apps/tracker/src/app/browser/store/features/with-folder-writes.feature.ts` returns a cold `Observable` of a typed outcome from each write. The feature refuses every write in a read-only collection before HTTP, owns move no-op checks, and updates cached tree and rows only in the [Browser Session](#browser-session) where the write began. The [Folder Move Plan](#folder-move-plan) decides the tree, expansion, reload, navigation, and rollback effects of folder moves. A failed optimistic move restores only the moved item against current state when its parent is loaded; an unloaded parent gets its children on its next load, so a newer tree load survives. Deletion shows the parent only if the current folder is the deleted folder or one of its descendants. Callers turn outcomes into their existing toasts or inline feedback; folder writes do not set the shared load `error`. The sidebar draft lives in this feature. The picker keeps an independent draft because it can be open alongside the sidebar; both drafts use `folder-draft.ts` for their transitions.

Explained in context: [`frontend.md`](frontend.md#optimistic-updates-with-rollback)

---

## I

### ICU Format

The [ICU MessageFormat](https://unicode-org.github.io/icu/userguide/format_parse/messages/) standard for representing locale-sensitive strings. LingoTracker stores translation values in ICU format internally. Simple placeholders use single braces: `Hello {name}`. Complex constructs use keyword-based syntax: `{count, plural, one {# item} other {# items}}`.

During [bundle](#bundle) generation, simple `{varName}` placeholders are converted to Transloco's `{{ varName }}` syntax. Complex ICU constructs are passed through as-is because Transloco's messageformat pipe handles them natively.

Explained in context: [`domain-and-data-model.md`](domain-and-data-model.md), [`bundle-generation.md`](bundle-generation.md)

---

### Import Run

One file import into one locale of one [collection](#collection). `runImport(collection, { source, format?, locale, ...options })` in `libs/core/src/lib/import/run-import.ts` detects the format, reads JSON or XLIFF through its adapter, emits a large-source warning before the run header, applies the resources, and returns the result with a lazy `summary()` renderer. Source failures raise `ImportSourceError` before any resource write. `importResources(collection, resources, options)` remains the entry point for callers with parsed resources. It applies strategy defaults, reads the collection's [Project Terms](#project-terms), resolves Transloco references (migration only), normalizes and repairs placeholders, validates, and merges per [folder](#resource-folder). The session and CLI prompts share domain's `DEFAULT_IMPORT_STRATEGY` and import locale rule; the prompts use `importableLocales` for choices. An `ImportSession` holds its settings, terms, changes, warnings, errors, and written files. A base-locale import without the migration strategy raises `InvalidImportLocaleError`.

Explained in context: [`core-library.md`](core-library.md#import-pipeline)

---

## J

### Job Registry

The API's in-memory runner for background jobs. Each `JobRegistry` instance owns a serial queue, UUID-keyed jobs, lifecycle timestamps, DTO snapshots, and eviction of finished jobs after 30 minutes or when a new job would exceed 100 retained jobs. Queued and running jobs remain until they finish, even above the cap. `BundleJobService` and `TranslationJobService` each have their own instance. Preconditions run synchronously before registration, and a failed run does not stop later jobs in that instance.

Explained in context: [`api.md`](api.md#translation-job-system)

---

## L

### List Edit Merge

`listEditProblem()` and `mergeListEdit()` in `libs/domain/src/lib/list-edit.ts` provide the shared add, remove and set rules for collection tags and protected terms. Core maps a missing or conflicting edit to each command's typed error and message. Each caller supplies its own normalization: tags use `normalizeTags()`, while protected terms keep case and punctuation with `normalizeProtectedTerms()`.

Explained in context: [`core-library.md`](core-library.md#project-terms), [`domain-and-data-model.md`](domain-and-data-model.md#protected-terms)

---

### List Scope

What the Tracker's translation list shows, and the only loader of its rows. In code, `withListScopeFeature` in `apps/tracker/src/app/browser/store/features/with-list-scope.feature.ts`, a feature of `BrowserStore`. The scope is a folder or a search query (`ListScope = { kind: 'folder'; path } | { kind: 'search'; query }`). Other code asks it to `showFolder(path)`, `showQuery(query)`, `clearSearch()` (back to the folder behind the search, loaded again only when its rows are not that folder's; a no-op when no search is shown) or `reloadList()`. Only the List Scope writes `currentFolderPath`, the busy flag `isListLoading` (of which `isTranslationsLoading` and `isSearchLoading` are readings) and its own error `listError`, and only it loads the rows (`translations`, `searchResults`); entry writes and moves patch the loaded rows in place. Every load runs through one `switchMap`, so a newer scope cancels an older load, and the [Browser Session](#browser-session) cancels it on every open, which also stops its not-ready retries. One failure rule: when the index is not ready and a list has already loaded in the session, the list goes back to the last scope that loaded (`shownScope`, whose rows are the ones on screen) and a toast gives the reason; any other failure, a search's included, is `listError`, which no other load can clear, shown with a Retry that loads the same scope again. `isDisabled` (folder navigation locked) is derived: a search is shown, or a move is in flight.

Explained in context: [`frontend.md`](frontend.md#list-scope--what-the-list-shows)

---

### Locale Seeding

What each of a [collection's](#collection) target locales gets when a resource's base value is written: the translation the caller supplied, else an auto-translation from the [Translator](#translator) when the collection enables it, else (or when the Translator skipped the locale) a copy of the base value with status `new`, except that on edit a real translation is kept (and is `stale`). In code, `seedLocales(collection, request)` in `libs/core/src/lib/resource/locale-seeding.ts`. `addResource` applies it to every target locale; `editResource` applies it after a base value change, to the locales that need work by the [staleness rule](#staleness-rule), and never replaces a real translation with a copy. A locale that is missing from a stored entry gets the same fallback, a `new` copy of the base, from the [Resource Folder](#resource-folder)'s `seedLocale`, which add-locale, edit-collection and normalize share. The API, the CLI and the Tracker do not decide this themselves.

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

The rules are project configuration rather than resource data. They live in a standalone JSON file, a bare array of rule objects. `.lingo-tracker.json` names that file with `preferredTerminologyFile`. Omit the setting and the rules fall back to `.lingo-tracker-preferred-terminology.json` beside the config. Collections cannot override the rules. Core reads the file as a term file (`lib/config/term-file.ts`, shared with the protected-terms files): a missing default file is an empty list, a missing named file is a warning, a file that exists but cannot be used (malformed JSON, the wrong shape, an invalid rule) is an error and reads as empty. Nothing is thrown; the problem travels with the [Project Terms](#project-terms) to whoever ran the check.

Matching is case-insensitive and whole-word, and it covers only the text a reader sees. ICU arguments and selectors, Transloco placeholders, and tags are skipped. The pure rule and matching functions live in `libs/domain`, so the Tracker UI and core share them.

The check runs in core, where the value is stored: `addResource` and `editResource` (on a supplied base value) return `terminology` (`findings`, one per rule the value breaks, and the rule-file `problems`); an [import run](#import-run) into the base locale adds one warning per finding and opens its warnings with a rule-file problem; `validateResources` reports findings as warnings and a broken rule file as a failure. The CLI and the API only render what core returned.

Contrast with [Protected Term](#protected-term), which keeps a word unchanged in translations and blocks imports that alter it.

Explained in context: [`docs/features/preferred-terminology.md`](../docs/features/preferred-terminology.md)

---

### Preferred Terminology Draft

`PreferredTerminologyDraft` in `apps/tracker/src/app/settings/preferred-terminology-draft.ts` stages settings-page rule edits. It owns rows, normalization, client validation, error visibility, change counts, and mapping server rule-error indexes back to submitted rows. It has no API dependency; [Settings Draft](#settings-draft) owns the Config Write.

Explained in context: [`frontend.md`](frontend.md#protected-terms-in-the-ui)

---

### Project Terms

The terms and rules in force for an opened [collection](#collection): its [protected terms](#protected-term) (the global list united with the collection's own) and the project's [preferred terminology](#preferred-terminology). In code, `readProjectTerms(collection)` in `libs/core/src/lib/config/project-terms.ts` reads the files `openCollection` resolved into `Collection.termFiles` and returns `ProjectTerms`: `protectedTerms`, `preferredTerminology`, `problems` (every term file that is named but missing, a warning, or exists but cannot be used, an error) and `checkBaseValue(key, value)`, the advisory terminology check of a stored base value (its findings, and the rule-file problems that limited it). Opening a collection reads nothing; each operation reads the Project Terms once, and nothing is cached, so a long-running API sees a hand edit or `git pull` on its next request. Reading never throws. A consumer that guards values with the protected terms and has no advisory channel asks for `requireProtectedTerms(terms)`, which throws `ProtectedTermsFileError` for a broken protected-terms file: the [Translator](#translator) when it opens, and the [import run](#import-run) before it writes. The Translator reports a missing named protected-terms file in its `problems`. Every other consumer reports the problems: `addResource` and `editResource` in their `terminology` result, import in its `warnings`, export in its `warnings` and, for a broken protected-terms file, its `errors` (the command exits 1), `validate` as printed warnings and, for a broken rule file, a failure. The two file kinds share one term-file module (`term-file.ts`: pointer resolution, the missing-file rule, the read that reports instead of throwing, the write with typed errors); each kind adds only its item check and its serialization. Direct writes of the global lists go through [Project Terms Update](#project-terms-update).

Explained in context: [`core-library.md`](core-library.md#project-terms)

---

### Project Terms Update

`updateProjectTerms(config, update, { cwd, beforeWrite? })` in core validates edits to global or collection protected terms and project-wide preferred terminology, then reads and writes the requested files. Its protected-terms `file` option changes a pointer inside the same update. `beforeWrite` receives the read view and any pointer-change message after the new location is readable; it may throw to abort. Core saves the exact previous bytes of term files it changes. On failure, it restores those files and reverts only its pointer key if that key still holds the new value, preserving unrelated config edits. The original error keeps its type and message if a restore fails, with the restore failure attached as its cause. The API still returns its usual config update message.

Explained in context: [`core-library.md`](core-library.md#project-terms), [`api.md`](api.md#endpoint-reference), [`cli.md`](cli.md#protected-terms-scoping)

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

A term matches only as a whole word. LingoTracker uses the list in three places. Export marks each string with the terms found in its source, as a `doNotTranslate` array in JSON and as a `Do not translate:` note in XLIFF. Import rejects any translation that omits a term present in the source. The [Translator](#translator) skips (does not store) a machine translation that omits one. All three read the terms in force for a collection as its [Project Terms](#project-terms); nobody passes the list in. `readProtectedTermsTarget()` reads the stored scope through `readGlobalProtectedTerms` / `readCollectionProtectedTerms`, which return `terms` (and a warning for a missing named file) and throw `ProtectedTermsFileError` for a malformed file. The config endpoint checks an untyped list with core `assertProtectedTerms()` before writing.

Explained in context: [`domain-and-data-model.md`](domain-and-data-model.md#protected-terms), [`core-library.md`](core-library.md#project-terms)

---

### Protected Term Add

`prepareProtectedTermAdd(existing, input)` in `apps/tracker/src/app/shared/protected-terms/protected-term-add.ts` normalizes a newly entered term with the domain rule and checks exact, case-sensitive duplicates. It returns `blank`, `duplicate`, or `added` with the normalized term. The settings draft and collection chips use this one add rule.

Explained in context: [`frontend.md`](frontend.md#protected-terms-in-the-ui)

---

### Protected Terms Chips

`ProtectedTermsChips` in `apps/tracker/src/app/shared/protected-terms/protected-terms-chips.ts` holds the collection dialog's list. `seedRaw(values)` preserves stored values, order, and duplicates exactly. `add(value)` uses the [Protected Term Add](#protected-term-add) rule; `remove(value)` drops matching chips. It has no staged row or error state.

Explained in context: [`frontend.md`](frontend.md#protected-terms-in-the-ui)

---

### Protected Terms Draft

`ProtectedTermsDraft` in `apps/tracker/src/app/shared/protected-terms/protected-terms-draft.ts` stages protected-term edits for Settings. It uses the shared add rule and domain normalization, and owns removed and restored rows, rename status, filtering and reveal requests, change counts, and the sorted save list. It has no API or DOM dependency; Settings owns scrolling and [Settings Draft](#settings-draft) owns the Config Write.

Explained in context: [`frontend.md`](frontend.md#protected-terms-in-the-ui)

---

### Public Surface

The names a library's `index.ts` barrel exports — everything a caller must know to use it. The `domain` and `core` barrels list their exports by name, never with `export *`. They list only names that something outside the library uses, plus the types those names' signatures need. A helper that only its own library uses stays exported from its file but not from the barrel. `libs/domain/src/index.spec.ts` pins domain's runtime exports, so adding one is a deliberate change.

Explained in context: [`monorepo-structure.md`](monorepo-structure.md#public-surface), [`core-library.md`](core-library.md#public-surface)

---

## R

### Resource Batches

Core owns writes of many resource entries. `addResources(collection, items)` checks every item for malformed keys and folder addresses, unknown locales, duplicate or existing resolved keys, and unreadable folder JSON before it translates any item. Translation failures also stop the batch before any write. Preflight reads folders but does not create them or check whether a later filesystem write can succeed. It rejects duplicate resolved keys within the batch with `ResourceAlreadyExistsError`; an existing exact key is refused unless `onExisting: 'replace'` is passed. Parent/child keys remain allowed at add time and may later appear as bundle-plan hierarchical conflicts. It then writes in input order and returns created count, deduplicated skipped locales and terminology problems, all findings, and all [mutations](#resource-mutation). A filesystem write failure after preparation (for example, an existing file in the folder path or a permissions failure) can leave earlier entries, or one of the failing folder's two JSON files, on disk; there is no rollback or returned mutations, and the Collection Index catches up through disk-fingerprint revalidation. `moveResources(collection, ops, { config })` runs each move in order, resolves writable destination collections, reports a missing or read-only destination for its operation, and continues. The API passes each batch's mutations to the [Collection Index](#collection-index) once.

Explained in context: [`core-library.md`](core-library.md#resource-batches), [`api.md`](api.md#resources)

---

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

One folder of the translation hierarchy, seen as a unit: its `resource_entries.json` ([resource entries](#resource-entry)) and `tracker_meta.json` ([tracker metadata](#tracker-metadata)) are always read and written together. In code, `openResourceFolder()` returns a `ResourceFolder` (`libs/core/src/lib/resource/resource-folder.ts`), and every core operation that changes resources goes through it. Whole-collection reads go through it too, by way of the [Collection Reader](#collection-reader), and writes over many folders by way of the [Collection Sweep](#collection-sweep). It computes checksums and applies the [staleness rule](#staleness-rule); no caller builds `{ checksum, baseChecksum, status }` itself. Its operations: `setBase` (the staleness rule on a base change), `setTranslation`, `setStatus`, `setDetails`, `setEntry` (a lossless copy/replace: move, rename, add-resource reset after its existence policy allows replacement; with `targetLocales`, for an entry moved into another collection, it drops the other locales and seeds the missing ones by the `seedLocale` rule), `seedLocale` (the one seeding rule: a missing locale becomes a copy of the base with status `new`, for add-locale and normalize), `dropLocale`, `remove`, and `normalizeEntry(key, values, targetLocales)`, [normalize's](core-library.md#normalization-pipeline) write path: it stores the given values, drops a stray base-locale property, re-records every target-locale translation with a current checksum and its stored status (a translation whose stored `baseChecksum` differs from the base checksum becomes `stale`, see [staleness](#staleness)), puts a changed base through the staleness rule and seeds the missing target locales. Locales outside the collection keep their values and metadata as they are. One rule holds everywhere: a locale value with no metadata counts as `new`, in the reader, in validate and after normalize.

Explained in context: [`core-library.md`](core-library.md#resource-crud-flows)

---

### Resource Mutation

One change that a core write made to a translations folder: `upsert` (key and the stored entry), `remove` (key), `add-folder` / `remove-folder` (path), or `reindex` (the change is too broad to describe, for example a locale was added). Each carries the absolute `translationsFolder` it applies to. `addResource`, `addResources`, `editResource`, `translateExistingResource`, `translateLocale`, `deleteResource`, `moveResource`, `moveResources`, `createFolder`, `deleteFolder`, `moveFolder`, `addLocaleToCollection` and `removeLocaleFromCollection` return them as `mutations`. `translateLocale` returns one `reindex` after its first folder save attempt and reports it through `onWrite`, including a partial save failure. A folder save error is counted in the batch's `failures`, and later batches continue. It returns no mutation if no folder save was attempted. The type is in `libs/core/src/lib/resource/resource-mutation.ts`. The [Collection Index](#collection-index) uses them to update itself without reading the disk again.

Explained in context: [`api.md`](api.md#writes-resource-mutations)

---

### Resource Key

A dot-delimited string that uniquely identifies a [resource entry](#resource-entry) within a [collection](#collection). Segments may contain only alphanumeric characters, underscores, and hyphens (`[A-Za-z0-9_-]`).

Example: `apps.common.buttons.ok`

All segments except the last define the folder hierarchy on disk; the last segment is the entry key within `resource_entries.json`. See also [resolved key](#resolved-key).

Explained in context: [`libs-domain.md`](libs-domain.md)

---

### Resource Search

The one matcher over a [collection's](#collection) resources. In code, `searchResources(resources, collection, query, { mode, limit })` in `libs/core/src/lib/resource/search.ts`. It reads any iterable of `{ fullKey, entry }`: the [Collection Reader](#collection-reader)'s `resources` for the disk, or `treeResources(tree)` for the [Collection Index](#collection-index) tree. It is pure, so the reader's problems are the caller's to report. It ranks every match before applying `limit`, so a better match is never lost because it was found late. The matcher defaults to 100 for an invalid limit. Core `clampSearchLimit(requested)` applies the API page-size rule (default 100, maximum 500). A blank query returns nothing; the query is trimmed and case-insensitive. Text mode (the default) looks in the full key, the base value (always, under the collection's [base locale](#base-locale)) and every translation. Each hit gets one match type, the key first: `exact-key`, `partial-key`, `exact-value`, `partial-value`. They rank in the order exact-key, exact-value, partial-key, partial-value, then key. Similar-value mode compares the query with the base value only. A value matches when its `normalizedLevenshtein` score is at least 0.8 (`save` / `saved`), or when one text contains the other as whole words (`Save` / `Save draft`) with a score (`shorter / longer` length) of at least 0.4 (`CONTAINMENT_MIN_SCORE`), so a short label inside a long sentence does not count. A fragment inside a word does not count either (`connect` in `connection`, `don` in `don't`: apostrophes are word characters). Hits rank by `similarity`, then a key that contains the query, then key, with `matchType: 'similar-value'`. The API's `CollectionIndex.search` (`GET …/resources/search`, `mode=text | similar`) and the CLI `find-similar` use it. The Tracker's "Similar values" block asks the API for similar mode.

Explained in context: [`core-library.md`](core-library.md#resource-search), [`api.md`](api.md#collection-index)

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

### Run Summary Writer

The CLI utility `writeRunSummary(kind, text)` in `apps/cli/src/utils/write-run-summary.ts` chooses a temporary Markdown summary path and writes the import or export run's text there. Core supplies the text through import's `summary()` or export's `summary`; the CLI owns the file path and the announcement printed after the write.

Explained in context: [`cli.md`](cli.md#shared-utilities), [`core-library.md`](core-library.md#import-pipeline)

---

## S

### Settings Draft

`SettingsDraft` in `apps/tracker/src/app/settings/settings-draft.ts` composes the protected-terms and preferred-terminology drafts. It owns the combined change count, save gate, revert, reseeding, and one [Config Write](#config-write) through a write function supplied by the page. `save(write)` records submitted rule rows when it builds the payload and emits `saved`, `blocked`, `refused`, or `unchanged`; a refusal maps valid rule errors onto the submitted rows. The page owns focus, the banner, and the toast. Both child drafts remain free of API dependencies.

Explained in context: [`frontend.md`](frontend.md#protected-terms-in-the-ui)

---

### Similar Values

The translation editor's suggestions for a typed base value. `SimilarValues` waits 300 ms after an eligible edit, then asks [Resource Search](#resource-search) for similar-mode results. It removes the entry being edited and keeps at most 10 hits. Changing the value clears old hits; a value under three characters cancels the pending search. An API failure yields an empty list. The lookup is scoped to the [Browser Session](#browser-session).

Explained in context: [`frontend.md`](frontend.md#translation-editor-and-the-resource-entry-draft)

---

### Staleness

The condition where a translation's `baseChecksum` no longer matches the [base locale](#base-locale)'s current [checksum](#checksum). This means the source text changed after the translation was written, so the translation is out of sync. A stale resource carries `status: "stale"` in its [locale metadata](#locale-metadata) and will fail CI validation by default.

Staleness is detected automatically during resource reads — no explicit re-scan is required.

Normalize makes the condition explicit. A target translation whose stored `baseChecksum` differs from the base checksum (for example after a git merge, where one branch changed the base and another verified the translation) becomes `stale` and gets the current `baseChecksum`. A translation whose value is a copy of the base becomes `new`, and a `new` translation stays `new`. Normalize does not erase the signal by re-recording the translation with its old status.

Explained in context: [`domain-and-data-model.md`](domain-and-data-model.md), [`core-library.md`](core-library.md)

---

### Staleness Rule

The one rule for what happens to translations when the [base locale](#base-locale) value changes (`applyBaseChange` in `libs/domain/src/lib/staleness.ts`): the base checksum is updated, every other locale's `baseChecksum` is set to the new base checksum, and its status becomes `stale` — or `new` when the translation is identical to the new base value (an untranslated copy). Edit, import, and normalize all use this rule, through the [Resource Folder](#resource-folder)'s `setBase`; normalize re-records the translation checksums first, so the rule compares current values. The same module holds `recordTranslation`, `needsTranslation`, and `resolveImportStatus`.

Explained in context: [`core-library.md`](core-library.md#resource-crud-flows)

---

## T

### Tag List Edit

The pure Tracker helper in `apps/tracker/src/app/shared/tag-list-edit.ts` adds a normalized, deduplicated tag or removes all matching tags. An empty or duplicate add returns the original list. Resource-entry removal passes inherited tags so those stay in place; collection and bundle editors remove their own tags without that option.

Explained in context: [`frontend.md`](frontend.md#translation-editor-and-the-resource-entry-draft), [`frontend.md`](frontend.md#bundle-form-dialog)

---

### Target Folder

An optional dot-delimited path prefix that scopes an input [resource key](#resource-key) to a specific folder within the collection's translation hierarchy. Used when a resource is created (`addResource`, `add-resource --target-folder`, `CreateResourceDto.targetFolder`) to place a short key (e.g. `ok`) at a specific location (e.g. `apps.common.buttons`) without repeating the full path in the key itself.

Validated to the same segment rules as a resource key (`[A-Za-z0-9_-]`). An empty string means no folder scoping.

An edit does not use it. `editResource(collection, key, { moveTo })` takes the full existing key, and `moveTo` is the folder the entry moves to (`''` for the collection root); `UpdateResourceDto.moveTo` and `edit-resource --target-folder` map to it.

Explained in context: [`domain-and-data-model.md`](domain-and-data-model.md), [`core-library.md`](core-library.md#collection-bound-operations), [`cli.md`](cli.md)

---

### Term Glossary

A ranked list of existing translations that match candidate terms in a block of base-locale text. In core, `buildGlossary(collections, text, { extractor?, locales?, includeAll? })` reads each opened [collection](#collection) through the [Collection Reader](#collection-reader), extracts unique unigrams and bigrams by default, and matches them against base values. It returns the JSON payload (`baseLocale`, target `locales`, source counts, `matchCount`, `terms`) and separate unreadable-folder `readProblems`. By default, each entry contributes only its own collection's target locales. An explicit locale list can select stored translations outside those targets; only the base locale is removed. New and stale translations are omitted unless `includeAll` is set. An empty collection set raises `GlossaryNoCollectionsError`; different base locales raise `GlossaryBaseLocaleMismatchError`, because one glossary has one source language. The CLI selects input and prints or saves the payload, reporting reader problems on stderr.

Explained in context: [`core-library.md`](core-library.md#term-glossary), [`cli.md`](cli.md#glossary-pipeline)

---

### Term List Edit

The direct file-edit side of [Project Terms](#project-terms), owned by core config. Collection create and update can also provide a whole protected-terms list through the [Collection Lifecycle](#collection-lifecycle). Core’s pointer setters change `protectedTermsFile` and carry over the old list. [Project Terms Update](#project-terms-update) reads stored terms, paths, warnings and the effective union before a write, and lets the CLI print that view before it writes. It applies add, remove or set through the shared [List Edit Merge](#list-edit-merge). Preferred-terminology upsert and removal match discouraged terms without regard to case; a validation error carries its row details and leaves the file untouched.

Explained in context: [`core-library.md`](core-library.md#project-terms), [`cli.md`](cli.md#protected-terms-scoping), [`api.md`](api.md#error-mapping)

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

The errors core raises on purpose. Each subclass of `LingoTrackerError` (`libs/core/src/lib/errors/lingo-tracker-error.ts`) declares a `kind` for adapter mapping, a stable `code` (for example `RESOURCE_NOT_FOUND`), and any typed payload fields (for example `key`). The API maps `kind` to HTTP status and retains special bodies for bundle, terminology, folder validation, and translation errors. The CLI prints the message and keeps its config and cancellation handling. Core converts operational failures at its boundary to typed errors; `CoreOperationError` keeps the CLI message and `String(error)` text of a former plain error while the API keeps its generic 500 body without a message. `ResourceFolder` keeps three programmer-error assertions as plain `Error`. An `InvalidConfigError` still carries a deliberate, client-visible message. On the other side of the wire, the Tracker turns each failed answer back into one [API Error](#api-error).

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

The roll-up of a set of locale [translation statuses](#translation-status): the number of locales in each status (`StatusCounts`) and the worst status. The pure module `libs/domain/src/lib/translation-status-summary.ts` holds the rules. `countByStatus(statuses)` counts the statuses and ignores a locale with no status. `worstStatus(counts)` applies `STATUS_PRECEDENCE`, which is worst first: `stale` > `new` > `translated` > `verified`. Every roll-up in the Tracker UI uses this module: the rollup ring, the screen-reader breakdown, the locale column, the status filter counts, and sort by status. The Tracker counts each locale's display status (`displayStatus`): the stored status, or `new` for a locale that needs work and has no metadata. The glyphs, label tokens and display order are presentation. They are in one Tracker table, `shared/translation-status/translation-status-presentation.ts`, which the rows and the translation editor's status labels both use.

Explained in context: [`frontend.md`](frontend.md#translation-status-summary)

---

### Translator

The one way core machine-translates text for a [collection](#collection). In code, `openTranslator(collection, { provider?, protectedTerms? })` in `libs/core/src/lib/translation/translator.ts` returns a `Translator`: `translate(entries, locales) → { values, skipped }`, and `problems` (a named protected-terms file that does not exist). Opening it checks that the collection's translation config is enabled (`AutoTranslationDisabledError`) and, unless a provider is injected, reads the API key (`TranslationError` `MISSING_API_KEY`) and builds the configured provider. For a whole-locale translation, core first runs `assertCanTranslateLocale`: auto-translation must be enabled and the target must be a configured, non-base locale. It reads the collection's [Project Terms](#project-terms) once for the protected terms, unless they are passed (`ProtectedTermsFileError` for a malformed file; a named file that does not exist is in `Translator.problems`, which its callers pass on as warnings). `translate` makes one provider call per locale and ignores the base locale. It never sends complex [ICU](#icu-format). It protects simple placeholders and skips a translation that lost a marker. It skips a translation that dropped a [protected term](#protected-term) present in the source. It returns every value normalized to ICU. Each skip carries a reason: `complex-icu`, `placeholder-mismatch` or `protected-term`. [Locale seeding](#locale-seeding), `translateExistingResource` and `translateLocale` all translate through it; they only choose what needs work (the [staleness rule](#staleness-rule)) and store the values. The provider is the seam: `GoogleTranslateV2Provider` in production, `InMemoryTranslationProvider` (a deterministic transform that records its calls, internal to core) in core's specs. Google requests time out after 30 seconds and fail with a retryable `TranslationError` (`TIMEOUT`); a whole-locale run records that batch in `failures` and continues. An invalid timeout option raises `INVALID_REQUEST_TIMEOUT` when the provider is constructed. Before `translateLocale` stores a provider result, it reopens the resource folder and compares the current base checksum and target locale checksum and status with those read before translation. A changed or removed entry, or a target that no longer needs translation, goes into `skippedKeys` and is not overwritten.

Explained in context: [`core-library.md`](core-library.md#auto-translation-pipeline)

---

## V

### Validate Run

One validation of the opened [collections](#collection) for CI. In code, `runValidate(collections, options)` in `libs/core/src/lib/validate/run-validate.ts` resolves target and skipped locales, reads each collection's [Project Terms](#project-terms), runs status, ICU, placeholder, and preferred-terminology checks through `validateResources`, and returns the validation result, its summary, and printable warnings. A missing collection set, no target locale, or every target locale skipped returns an in-band failure; a broken preferred-terminology file fails validation. The rule file belongs to the project, so the run uses the first collection whose read has rules.

Explained in context: [`core-library.md`](core-library.md#validation-for-cicd), [`cli.md`](cli.md)
