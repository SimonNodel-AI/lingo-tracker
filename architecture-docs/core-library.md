# Core Library (`@simoncodes-ca/core`)

`@simoncodes-ca/core` is the Node.js business-logic layer of LingoTracker. It owns every operation that touches the filesystem, computes checksums, calls external APIs, or orchestrates multi-step pipelines. The library depends on `@simoncodes-ca/domain` for pure logic and types, but is never imported by the browser-facing Tracker UI. All three applications — CLI, API, and the Angular app's server-side operations — call into this library.

Return to [architecture README](README.md).

---

## Table of Contents

- [Module Map](#module-map)
- [Public Surface](#public-surface)
- [Config and Collection Resolution](#config-and-collection-resolution)
- [Error Model](#error-model)
- [Resource CRUD Flows](#resource-crud-flows)
  - [Collection-bound operations](#collection-bound-operations)
  - [Locale seeding](#locale-seeding)
  - [add-resource](#add-resource)
  - [edit-resource](#edit-resource)
  - [delete-resource](#delete-resource)
  - [move-resource](#move-resource)
- [Collection Reader](#collection-reader)
- [Normalization Pipeline](#normalization-pipeline)
- [Auto-Translation Pipeline](#auto-translation-pipeline)
  - [Provider abstraction](#provider-abstraction)
- [Import Pipeline](#import-pipeline)
- [Export Pipeline](#export-pipeline)
- [Bundle Generation](#bundle-generation)
- [Validation for CI/CD](#validation-for-cicd)

---

## Module Map

`@simoncodes-ca/core` is organized into two root-level groupings and one `lib/` subdirectory that holds the deeper sub-modules.

```
libs/core/src/
├── index.ts                      # Public barrel — named exports grouped by role (see Public Surface)
├── constants.ts                  # CONFIG_FILENAME, DEFAULT_CONFIG (public); resource/meta filenames (internal)
│
├── config/                       # Config types used at the root of the package
│   ├── lingo-tracker-config.ts   # LingoTrackerConfig interface
│   ├── lingo-tracker-collection.ts # Collection config (incl. protectedTermsFile pointer)
│   ├── bundle-definition.ts      # BundleDefinition, CollectionBundleDefinition, EntrySelectionRule
│   └── translation-config.ts     # TranslationConfig (provider name, API key env var)
│
├── resource/                     # Resource CRUD on an opened Collection — reads/writes resource_entries.json + tracker_meta.json
│   ├── add-resource.ts           # addResource(): create or overwrite a single entry
│   ├── edit-resource.ts          # editResource(): update value, comment, tags, or locale values; moveTo moves the entry
│   ├── locale-seeding.ts         # seedLocales(): what target locales get when a base value is written
│   ├── delete-resource.ts        # deleteResource(): remove one or more entries by key
│   ├── move-resource.ts          # moveResource(): rename/relocate entries (single or wildcard)
│   ├── checksum.ts               # calculateChecksum(): MD5 via node:crypto
│   ├── resource-entry.ts         # ResourceEntry, ResourceEntries interfaces
│   ├── resource-entry-metadata.ts # ResourceEntryMetadata interface
│   └── tracker-metadata.ts       # TrackerMetadata interface
│
├── collections-manager/          # Collection-level operations (create / delete / update in config)
│   ├── add-collection.ts         # addCollection()
│   ├── delete-collection-by-name.ts # deleteCollectionByName()
│   ├── set-protected-terms.ts    # setGlobal/CollectionProtectedTerms(): write the terms file; setGlobal/CollectionProtectedTermsFile(): move the pointer
│   └── update-collection.ts      # updateCollection() — async; diffs locale list and calls addLocaleToCollection / removeLocaleFromCollection
│
└── lib/                          # Deeper sub-modules
    ├── bundle/                   # Bundle generation pipeline
    │   ├── generate-bundle.ts    # generateBundle(): main entry point
    │   ├── resource-loader.ts    # loadCollectionResources(): one collection's values for one locale, via readCollection()
    │   ├── hierarchy-builder.ts  # buildHierarchy(): dot-keys → nested JSON object
    │   ├── pattern-matcher.ts    # matchesPattern(): glob-style key filtering
    │   ├── tag-filter.ts         # matchesTags(): AND/OR tag filter logic
    │   └── type-generation/      # TypeScript type file generation from bundle keys
    │
    ├── config/                   # Config file I/O and collection resolution
    │   ├── load-config.ts        # loadConfig(): the only reader of .lingo-tracker.json
    │   ├── open-collection.ts    # openCollection(): a collection's effective settings (Collection)
    │   ├── config-file-operations.ts # read/write/update .lingo-tracker.json (reads via loadConfig)
    │   └── protected-terms-file.ts   # Resolve, read, and write protected-terms JSON files (cached per path)
    │
    ├── export/                   # The Export run
    │   ├── run-export.ts         # runExport(): the Export run; exportTargetLocales()
    │   ├── export-common.ts      # loadResources(): one collection via readCollection(), flattened; filterResources(); validateBasePropertyName()
    │   ├── export-to-json.ts     # JSON exporter (internal to runExport)
    │   ├── export-to-xliff.ts    # XLIFF 1.2 exporter (internal to runExport)
    │   ├── export-summary.ts     # Markdown export summary (internal to runExport)
    │   └── types.ts              # ExportOptions, ExportResult, FilteredResource, etc.
    │
    ├── import/                   # The Import run; barrel exports only the public interface
    │   ├── import-resources.ts   # importResources(): the Import run over one collection
    │   ├── parse-json-import.ts  # parseJsonImport(): JSON adapter (flat / hierarchical / rich objects)
    │   ├── parse-xliff-import.ts # parseXliffImport(): XLIFF 1.2 adapter
    │   ├── import-session.ts     # ImportSession: settings + accumulated changes, warnings, errors, files
    │   ├── process-resource-group.ts # Applies one folder's resources (internal)
    │   ├── resource-grouping.ts  # groupResourcesByFolder(): batches resources by target path
    │   ├── determine-status.ts   # Which source status an import honours
    │   ├── apply-icu-auto-fix.ts # applyICUAutoFixToResources(): repairs malformed placeholders
    │   ├── normalize-transloco-syntax.ts # {{ x }} → {x} before storage
    │   ├── load-base-locale-values.ts    # Reads current base values for the auto-fix
    │   ├── import-statistics.ts  # Counts created / updated / skipped / failed
    │   ├── import-summary.ts     # generateImportSummary(): Markdown import summary
    │   ├── import-validation.ts  # Validates imported resources before write
    │   └── types.ts              # ImportRunOptions, ImportResult, ImportedResource, etc.
    │
    ├── validate/                 # CI/CD validation pipeline
    │   ├── validate-resources.ts # validateResources(): status check per collection, with its own locales
    │   ├── validate-icu.ts       # validateIcuValues(): compiles each value under its own locale
    │   └── generate-validation-summary.ts # Human-readable validation result summary
    │
    ├── normalize/                # Normalization pipeline
    │   ├── normalize.ts          # normalize(): main entry point
    │   ├── normalize-entry.ts    # normalizeEntry(): single-entry checksum + status repair
    │   ├── cleanup-empty-folders.ts # cleanupEmptyFolders(): removes empty directories
    │   ├── iterative-folder-walker.ts # walkFolders(): depth-ordered directory traversal
    │   └── folder-utils.ts       # Path helpers for the walker
    │
    ├── translation/              # Machine translation: the Translator and the operations that use it
    │   ├── translator.ts                 # openTranslator(): setup, ICU skip, placeholder + protected-term guards, ICU normalisation
    │   ├── translation-provider.ts       # TranslationProvider interface (the seam), TranslationError
    │   ├── translation-provider-factory.ts # createTranslationProvider(): the Google adapter's constructor site
    │   ├── google-translate-v2.provider.ts # GoogleTranslateV2Provider adapter
    │   ├── in-memory-translation-provider.ts # InMemoryTranslationProvider adapter (internal; core specs, no network)
    │   ├── translate-existing-resource.ts # translateExistingResource(): translate one entry's new/stale locales
    │   ├── translate-locale.ts           # translateLocale(): translate one locale of a collection in batches
    │   └── placeholder-protector.ts      # protectPlaceholders() / restorePlaceholders()
    │
    ├── resource/                 # One folder's files, and the read models built on them
    │   ├── resource-folder.ts    # openResourceFolder(): the Resource Folder (entries + metadata as a unit)
    │   ├── read-collection.ts    # readCollection(), readCollectionFolders(): the Collection Reader
    │   ├── load-resource-tree.ts # loadResourceTree(): the API's resource tree (built on readCollectionFolders)
    │   ├── search.ts             # searchTranslations() (disk), searchResourceTree() (in memory)
    │   ├── resource-mutation.ts  # ResourceMutation: what a write changed
    │   └── tree-fingerprint.ts   # computeTreeFingerprint(): stat-only change detection
    │
    ├── folder/                   # Folder-level filesystem operations
    │   ├── create-folder.ts      # createFolder(): mkdir with segment validation
    │   ├── delete-folder.ts      # deleteFolder(): recursive removal
    │   └── move-folder.ts        # moveFolder(): rename + resource re-key
    │
    ├── file-io/                  # Low-level JSON read/write helpers (internal; no barrel)
    │   ├── json-file-operations.ts  # readJsonFile(), writeJsonFile(), typed helpers
    │   └── directory-operations.ts  # ensureDirectoryExists()
    │
    └── errors/                   # Error messages and typed errors
        ├── error-messages.ts     # ErrorMessages: static error string builders (internal)
        └── lingo-tracker-error.ts # LingoTrackerError and its typed subclasses (see Error Model)
```

<!-- Module relationship graph within @simoncodes-ca/core -->

```mermaid
graph TD
    subgraph apps["Callers (CLI / API)"]
        CLI["cli"]
        API["api"]
    end

    subgraph core["@simoncodes-ca/core root modules"]
        RESOURCE["resource/\nadd · edit · delete · move"]
        COLLECTIONS["collections-manager/\nadd · delete · update"]
        CONFIG_ROOT["config/\nLingoTrackerConfig\nBundleDefinition\nTranslationConfig"]
    end

    subgraph lib["core/lib/ sub-modules"]
        BUNDLE["bundle/\ngenerateBundle"]
        EXPORT["export/\nrunExport"]
        IMPORT["import/\nparseJsonImport · parseXliffImport\nimportResources"]
        VALIDATE["validate/\nvalidateResources"]
        NORMALIZE["normalize/\nnormalize"]
        TRANSLATION["translation/\nopenTranslator\ntranslateExistingResource\ntranslateLocale"]
        FOLDER["folder/\ncreateFolder · deleteFolder\nmoveFolder"]
        FILEIO["file-io/\nreadJsonFile · writeJsonFile\nensureDirectoryExists"]
        CONFIG_LIB["config/\nloadConfig · openCollection\ncreateConfigFileOperations"]
        ERRORS["errors/\nErrorMessages"]
        RESOURCE_LIB["resource/\nresource-folder · read-collection\nresource-file-paths\nload-resource-tree · search"]
    end

    subgraph domain["@simoncodes-ca/domain (peer)"]
        DOMAIN["validateKey · resolveResourceKey\nsplitResolvedKey · translocoToICU\nicuToTransloco · classifyICUContent\napplyBaseChange · recordTranslation"]
    end

    CLI --> RESOURCE
    CLI --> COLLECTIONS
    CLI --> BUNDLE
    CLI --> IMPORT
    CLI --> EXPORT
    CLI --> VALIDATE
    CLI --> NORMALIZE

    API --> RESOURCE
    API --> COLLECTIONS
    API --> BUNDLE
    API --> IMPORT
    API --> EXPORT
    API --> VALIDATE
    API --> NORMALIZE

    RESOURCE --> FILEIO
    RESOURCE --> RESOURCE_LIB
    RESOURCE --> TRANSLATION
    RESOURCE --> DOMAIN

    BUNDLE --> FILEIO
    BUNDLE --> RESOURCE_LIB
    BUNDLE --> EXPORT
    BUNDLE --> DOMAIN

    IMPORT --> FILEIO
    IMPORT --> RESOURCE_LIB
    IMPORT --> NORMALIZE
    IMPORT --> DOMAIN

    EXPORT --> FILEIO
    EXPORT --> RESOURCE_LIB
    EXPORT --> DOMAIN

    VALIDATE --> EXPORT

    NORMALIZE --> FILEIO
    NORMALIZE --> DOMAIN

    TRANSLATION --> DOMAIN
    TRANSLATION --> RESOURCE_LIB

    FOLDER --> FILEIO
    FOLDER --> DOMAIN

    COLLECTIONS --> CONFIG_LIB
    COLLECTIONS --> FILEIO

    RESOURCE_LIB --> DOMAIN
    RESOURCE_LIB --> FILEIO

    CONFIG_LIB --> FILEIO
    FILEIO --> ERRORS

    style core fill:#d1ecf1,stroke:#17a2b8,color:#000
    style lib fill:#e8f4fd,stroke:#17a2b8,color:#000
    style domain fill:#d4edda,stroke:#28a745,color:#000
    style apps fill:#f8f9fa,stroke:#6c757d,color:#000
```

For the entity types (`ResourceEntry`, `TrackerMetadata`, `LocaleMetadata`) that these modules read and write, see [domain-and-data-model.md](domain-and-data-model.md).

---

## Public Surface

`libs/core/src/index.ts` is the [public surface](glossary.md#public-surface): 185 names, listed one by one and grouped by role. It exports only what the API or CLI uses, plus the types in those names' signatures. It does not re-export `domain` names; callers import `TranslationStatus`, `TokenCasing` and `ImportStrategy` from `@simoncodes-ca/domain`.

| Group | What it holds |
|---|---|
| Operations | The entry points the apps call. Resources: `addResource`, `editResource`, `deleteResource`, `moveResource`. Folders: `createFolder`, `deleteFolder`, `moveFolder`. Collections and locales: `addCollection`, `updateCollection`, `deleteCollectionByName`, `addLocaleToCollection`, `removeLocaleFromCollection`, `setGlobal/CollectionProtectedTerms[File]`. Bundles: `generateBundle`, `planBundle`, `add/update/deleteBundleDefinition`, `validateBundleKey`, `validateBundleDefinition`, `getBundleOutputPath`, `hasTypeDistConfigured`. Import: `importResources` and its adapters. Export: `runExport`, `exportTargetLocales`, the export argument checks. Also `normalize`, `translateLocale`, `translateExistingResource`, `validateResources`, `generateValidationSummary`, `describePreferredTermRule`. |
| Translator | Only the types in the translate operations' signatures: `OpenTranslatorOptions` (the optional `{ provider?, protectedTerms? }` of `addResource`, `editResource`, `translateExistingResource`, `translateLocale`) and the `TranslationProvider` seam (`TranslateRequest`, `TranslateResult`, `ProviderCapabilities`). `openTranslator`, the `Translator` types and `InMemoryTranslationProvider` stay internal to core (the translation barrel), because no app uses them. See [Auto-Translation Pipeline](#auto-translation-pipeline). |
| Collection & config | `loadConfig`, `openCollection`, `Collection`, `CONFIG_FILENAME`, `DEFAULT_CONFIG`, the config types (`LingoTrackerConfig`, `LingoTrackerCollection`, `TranslationConfig`, `BundleDefinition`, ...), and the protected-terms and preferred-terminology file readers and writers. |
| ResourceFolder | `openResourceFolder`, `ResourceFolder` and the types in its methods, `resolveResourcePaths`. |
| Collection Reader | `readCollection`, `StoredResource`, `CollectionRead`, `CollectionReadProblem`, `CollectionReadTarget`. See [Collection Reader](#collection-reader). |
| Read models | `loadResourceTree`, `extractSubtree`, `extractResourcesRecursively`, `searchTranslations`, `searchResourceTree`, `computeTreeFingerprint`, `treeFingerprintsMatch`, `reindexMutation` and their types. The API's [Collection Index](glossary.md#collection-index) is built from these. A `ResourceTreeEntry` and a `SearchResult` (which carries the entry's `source` and `metadata`) both fit the domain `buildResourceSummary` input, which the API uses to answer with a [Resource Summary](glossary.md#resource-summary). |
| Errors | `LingoTrackerError` and every typed subclass, `TranslationError`, `PreferredTerminologyValidationError`. See [Error Model](#error-model). |
| Types | Parameter and result types for the operations above (`AddResourceParams`, `GenerateBundleResult`, `ImportResult`, ...). |

Each sub-module with a barrel (`resource/`, `collections-manager/`, and `lib/bundle`, `config`, `errors`, `folder`, `import`, `normalize`, `resource`, `translation`, `validate`) lists its own public names the same way, and the root barrel re-exports from it. `lib/export/` has no barrel, so the root barrel imports its files directly. `lib/file-io/` is internal and has no barrel. Everything else is internal: `ErrorMessages`, `calculateChecksum`, the Translator, the provider classes and `createTranslationProvider`, the bundle helpers, the normalize walker, `SafeAny`, and the like. Core's specs import these by relative path. Test helpers live in `*.spec-helpers.ts` files, which `tsconfig.lib.json` excludes from the build: `setupMockFs` (`collections-manager/locale.spec-helpers.ts`) and the real-filesystem fixtures `useTempDir`, `testCollection`, `seedResources`, `writeFolderFiles` (`testing/temp-dir.spec-helpers.ts`). New reader specs use real temp directories rather than a mocked `fs`.

---

## Config and Collection Resolution

Core owns the config file and the rule that turns a collection's config entry into its effective settings. The adapters (CLI, API) call two functions in `lib/config/` once per command or request, then pass the results to the per-resource operations.

- **`loadConfig({ cwd? })`** is the only reader of `.lingo-tracker.json`. It returns the file as written, with no validation and no fallbacks. It throws `ConfigNotFoundError` when the file does not exist and `ConfigParseError` when the file is not a JSON object; other I/O errors pass through. The CLI passes its `INIT_CWD`-aware directory, the API passes `process.cwd()`, and `createConfigFileOperations().read()` (used by the config writers) reads through it too.
- **`openCollection(config, name, { cwd?, writable? })`** returns a `Collection`: `name`, the absolute `translationsFolder` (resolved against `cwd`), `baseLocale` (collection, else global, else `en`; an empty string counts as unset), `locales` (collection, else global, else `[]`), `targetLocales` (`locales` without `baseLocale`), `translationConfig` (collection, else global; not merged), normalized `tags`, `protectedTermsFiles` (the absolute paths of the global and collection protected-terms files, resolved but not read; see [Protected Terms Resolution](#protected-terms-resolution)), `readOnly`, and the raw entry as `config`. It throws `CollectionNotFoundError` for an unknown name and, when `writable` is set, `ReadOnlyCollectionError` for a read-only collection.

The fallback rule lives only in `openCollection`. The collection operations in `collections-manager/` (`addLocaleToCollection`, `removeLocaleFromCollection`, `updateCollection`) use it for their locale checks. The [Import run](glossary.md#import-run) and the [Export run](glossary.md#export-run) take `Collection` objects, so they read the base locale and locales from there and never read the config file. The resource and folder operations (`addResource`, `editResource`, `deleteResource`, `moveResource`, `translateExistingResource`, `createFolder`, `deleteFolder`, `moveFolder`) take the opened `Collection` as their first parameter too, so no caller passes a base locale, a locale list, a translation config, or a `cwd`. See [Collection-bound operations](#collection-bound-operations). The typed errors extend `LingoTrackerError`; see [Error Model](#error-model).

---

## Error Model

Core raises a [typed error](glossary.md#typed-errors) for every failure that an adapter must tell apart. Each class extends `LingoTrackerError` (`lib/errors/lingo-tracker-error.ts`), has a stable `code`, and keeps its payload in typed fields. The message text comes from `ErrorMessages` (`lib/errors/error-messages.ts`), so it did not change when the types were added. The CLI prints the message; the API maps the class to an HTTP status (see [api.md — Error Mapping](api.md#error-mapping)). Neither adapter reads the message to decide what happened.

| Class | `code` | Payload | Thrown by |
|---|---|---|---|
| `ConfigNotFoundError` | `CONFIG_NOT_FOUND` | `configPath` | `loadConfig` |
| `ConfigParseError` | `CONFIG_PARSE_FAILED` | `configPath`, `reason` | `loadConfig` |
| `ProtectedTermsFileError` | `INVALID_PROTECTED_TERMS_FILE` | `filePath` | `readProtectedTermsFile` and every reader built on it: the protected-terms commands, import/export callers, `resolveProtectedTermsForConfig`, and `openTranslator` (so `addResource` / `editResource` with auto-translation on, `translateExistingResource` and `translateLocale`, when there is work). The API answers 500 with the message. |
| `CollectionNotFoundError` | `COLLECTION_NOT_FOUND` | `collectionName` | `openCollection`, `deleteCollectionByName`, `updateCollection`, `setCollectionProtectedTerms`, `setCollectionProtectedTermsFile` |
| `CollectionAlreadyExistsError` | `COLLECTION_ALREADY_EXISTS` | `collectionName` | `addCollection`, `updateCollection` (rename) |
| `ReadOnlyCollectionError` | `COLLECTION_READ_ONLY` | `collectionName` | `openCollection` with `{ writable: true }` |
| `InvalidLocaleError` | `INVALID_LOCALE` | `locale` | `addLocaleToCollection`, `removeLocaleFromCollection` |
| `LocaleNotFoundError` | `LOCALE_NOT_FOUND` | `locale`, `collectionName` | `removeLocaleFromCollection`; `addResource` / `editResource` for a supplied translation in a locale the collection does not have |
| `LocaleAlreadyExistsError` | `LOCALE_ALREADY_EXISTS` | `locale`, `collectionName` | `addLocaleToCollection` |
| `BaseLocaleImmutableError` | `BASE_LOCALE_IMMUTABLE` | `locale` | `addLocaleToCollection`, `removeLocaleFromCollection` |
| `InvalidResourceKeyError` | `INVALID_RESOURCE_KEY` | `key` | `validateAndResolvePaths` (so `addResource`, `editResource` including its `moveTo`, `translateExistingResource`) |
| `ResourceNotFoundError` | `RESOURCE_NOT_FOUND` | `key` | `editResource`, `translateExistingResource` |
| `ResourceAlreadyExistsError` | `RESOURCE_ALREADY_EXISTS` | `key` | `editResource` with a `moveTo` whose folder already has the entry key |
| `InvalidFolderPathError` | `INVALID_FOLDER_PATH` | `part`, `segment` | `createFolder`, `deleteFolder`, `moveFolder` |
| `FolderNotFoundError` | `FOLDER_NOT_FOUND` | `folderPath` | `deleteFolder`, `moveFolder` (source missing or not a directory) |
| `FolderMoveIntoDescendantError` | `FOLDER_MOVE_INTO_DESCENDANT` | `sourceFolderPath`, `destinationFolderPath` | `moveFolder` (same collection) |
| `AutoTranslationDisabledError` | `AUTO_TRANSLATION_DISABLED` | `collectionName` | `openTranslator` (so `translateExistingResource`, and `translateLocale` when there is work) |
| `BundleNotFoundError` | `BUNDLE_NOT_FOUND` | `bundleName` | `updateBundleDefinition`, `deleteBundleDefinition` |
| `BundleAlreadyExistsError` | `BUNDLE_ALREADY_EXISTS` | `bundleName` | `addBundleDefinition`, `updateBundleDefinition` (rename) |
| `InvalidBundleDefinitionError` | `INVALID_BUNDLE_DEFINITION` | `errors[]` | bundle definition add / update |
| `TranslationError` | provider code (`MISSING_API_KEY`, `UNKNOWN_PROVIDER`, `INVALID_RESPONSE`, `RATE_LIMIT`, `INVALID_REQUEST`, …) | `retryable`, `providerErrorCode` | translation providers, `openTranslator` / `Translator.translate` (so every operation that auto-translates) |
| `PreferredTerminologyValidationError` | `INVALID_PREFERRED_TERMINOLOGY` | `errors[]` | `writePreferredTerminology` |

Rules:

- **Domain validators stay untyped.** `@simoncodes-ca/domain` has no error classes. `validateKey`, `validateTargetFolder`, and `validateLocale` throw a plain `Error`. Core wraps each call in one place and throws the typed error with the same message: `validateAndResolvePaths` for keys and target folders, and `assertValidLocale` (`collections-manager/assert-valid-locale.ts`) for locales.
- **Batch operations report per-item failures, not throw.** `deleteResource`, `moveResource`, and `moveFolder` put per-key failures into their result (`errors`) as strings. Bad input to the whole operation (a malformed folder path, a missing folder, a move into the folder's own descendant) is a typed error.
- **Unexpected failures stay `Error`.** File I/O errors, invariant breaks (for example `ResourceFolder`'s "Resource entry not found"), and parser errors for import files are not typed. An adapter treats them as "something went wrong" and shows the message.

---

## Resource CRUD Flows

Resource CRUD is implemented across four functions in `libs/core/src/resource/`, each bound to an opened `Collection`. Each function follows the same structural pattern: resolve the dot-delimited [resource key](glossary.md#resource-key) to a filesystem path, load the current JSON files, apply changes, recompute [checksums](glossary.md#checksum) and [translation status](glossary.md#translation-status), then write both files back. Both files are always written together by one call (`ResourceFolder.save()`); the writes are sequential, not atomic.

**All writes go through `ResourceFolder`.** `openResourceFolder(folderPath, { baseLocale })` in `lib/resource/resource-folder.ts` is the only owner of a [resource folder](glossary.md#resource-folder) (`resource_entries.json` + `tracker_meta.json`). Add, edit, delete, move, import, normalize, translate-locale, translate-existing-resource, and add/remove-locale all load the pair through it, change it with `setBase` / `setTranslation` / `setStatus` / `setDetails` / `setEntry` / `seedLocale` / `dropLocale` / `remove`, and persist with `save()` (which deletes both files when the folder becomes empty). `ResourceFolder` computes the checksums and applies the domain [staleness rule](glossary.md#staleness-rule) (`applyBaseChange`, `recordTranslation` in `libs/domain/src/lib/staleness.ts`), so no caller builds `{ checksum, baseChecksum, status }` by hand. Readers use it too: every whole-collection read goes through the [Collection Reader](#collection-reader), folder move/delete and cleanup open folders directly, and `resolveResourcePaths()` is the only function that maps a key to its folder.

**Writes return what changed.** Every write (add, edit, delete, move, translate-existing-resource, folder create/delete/move, add/remove-locale) returns `mutations: ResourceMutation[]` (`lib/resource/resource-mutation.ts`) next to its other results: an `upsert` with the stored entry as `ResourceFolder.treeEntry()` reads it, a `remove`, an `add-folder` / `remove-folder`, or a `reindex` when the change is too broad to describe. Each mutation carries the absolute translations folder it applies to. A move returns an `upsert` at the destination and a `remove` at the source for each moved key, and a folder move adds a `remove-folder` for the deleted source. The API's [Collection Index](glossary.md#collection-index) uses them to follow the disk without reading it again; the CLI ignores them. See [Resource Mutation](glossary.md#resource-mutation).

### Collection-bound operations

Every resource and folder operation takes an opened [Collection](glossary.md#collection-resolved) as its first parameter, like the Import run:

```ts
addResource(collection, { key, baseValue, comment?, tags?, targetFolder?, translations? })
editResource(collection, key, { baseValue?, comment?, tags?, translations?, moveTo? })
deleteResource(collection, { keys })
moveResource(collection, { source, destination, override?, destinationCollection? })
translateExistingResource(collection, key, { provider?, protectedTerms? }?)
translateLocale(collection, { targetLocale, onProgress?, provider?, protectedTerms? })
createFolder(collection, { folderName, parentPath? })
deleteFolder(collection, { folderPath })
moveFolder(collection, { sourceFolderPath, destinationFolderPath, override?, nestUnderDestination?, destinationCollection? })
```

`addResource` and `editResource` take the same optional `{ provider?, protectedTerms? }` as a last parameter, for [locale seeding](#locale-seeding). The base locale, the target locales, the translation config and the protected-terms files come only from the `Collection`; there is no `'en'` fallback and no `cwd` (the `translationsFolder` is absolute). A cross-collection move takes the destination as a second `Collection`.

**Key placement.** `addResource` stores `targetFolder.key` (`resolveResourceKey`, applied by `validateAndResolvePaths`). `editResource` takes the entry's full, existing key. Its `moveTo` is a destination folder (`''` is the collection root): the entry keeps its entry key (the last segment) and moves there, as a lossless copy, after the edit is saved. The destination must not already have that entry key (`ResourceAlreadyExistsError`). This is checked before anything is written, and again on a fresh read of the destination just before the move, because auto-translation may run in between; a collision found then throws with the edit already saved in the source folder. The destination is written before the source entry is removed.

### Locale seeding

[Locale seeding](glossary.md#locale-seeding) (`seedLocales` in `resource/locale-seeding.ts`) decides what each of `collection.targetLocales` gets when a base value is written:

1. A translation the caller supplied → the caller's value and status.
2. Else, when `collection.translationConfig` is enabled → the [Translator](#auto-translation-pipeline)'s value (status `translated`). Locale seeding checks `enabled` itself before it opens the Translator, so a disabled config never throws here.
3. Else, or when the Translator skipped the locale (complex ICU, a lost placeholder, or a dropped protected term) → a copy of the base value with status `new`. On edit, this applies only to a locale with no value or an untranslated copy of the old base; a locale that holds a real translation keeps it, marked `stale` by the staleness rule.

`addResource` applies it to every target locale. `editResource` applies it after a base value change, to the locales that need work by the [staleness rule](glossary.md#staleness-rule) (`needsTranslation` after `setBase`), with one limit: step 3 never overwrites a real translation. Only a missing locale, or one that held an untranslated copy of the old base, gets the copy; a real translation stays, marked `stale`. A supplied translation for a locale that is not in the collection throws `LocaleNotFoundError`; a value for the base locale is ignored.

### add-resource

**Entry point:** `addResource(collection, params)`

Steps:

1. **Resolve paths** — `validateAndResolvePaths()` calls `resolveResourceKey()` and `splitResolvedKey()` from `@simoncodes-ca/domain` to derive `folderPath`, `resourceEntriesPath`, `trackerMetaPath`, and `entryKey`.
2. **Ensure directory** — `ensureDirectoryExists()` creates the folder tree with `mkdirSync({ recursive: true })`.
3. **Load existing files** — `openResourceFolder()` loads both files (missing files are empty).
4. **Normalize base value** — `translocoToICU()` converts any Transloco `{{ varName }}` syntax in the incoming base value to ICU `{varName}` before storage.
5. **Resolve translations** — [locale seeding](#locale-seeding): supplied translations first, then auto-translation or a copy of the base as `new` for every other target locale. All values are resolved before anything is written, so a provider failure writes nothing.
6. **Replace the entry** — `setEntry` / `setBase` / `setDetails` / `setTranslation` on the `ResourceFolder`. A translation equal to the base value is stored as `new`.
7. **Write files** — `folder.save()` writes both `resource_entries.json` and `tracker_meta.json`.

### edit-resource

**Entry point:** `editResource(collection, key, changes)`

Steps:

1. **Resolve paths and load** — same as add-resource. `key` is the entry's full key. A `moveTo` is resolved and checked for a collision before anything changes.
2. **Throws if not found** — exits immediately if either JSON file or the specific entry key is absent.
3. **Update base value** (if changed) — `translocoToICU()` normalizes the incoming value; `folder.setBase()` recomputes the base checksum and applies the [staleness rule](glossary.md#staleness-rule) to every non-base locale.
4. **Update comment/tags** — simple field overwrites with change detection to avoid unnecessary writes.
5. **Update locale values** — for each locale in `changes.translations`, normalizes with `translocoToICU()`, recomputes checksum via `calculateChecksum()`, and updates `status` (defaults to `'translated'` if not provided).
6. **Persist initial changes** — `folder.save()` before attempting auto-translation, so the base value change is durable even if the translation API call fails.
7. **Seed on base change** — if the base value changed, [locale seeding](#locale-seeding) runs for the locales that need work and were not supplied; results are written by a second `folder.save()`.
8. **Move** — with a `moveTo` naming another folder, the entry is copied as stored to the destination and removed from the source. The result's `resolvedKey` is the destination key, and `mutations` are an `upsert` there and a `remove` at the source.

### delete-resource

**Entry point:** `deleteResource(collection, { keys })`

Steps:

1. **Validate each key** — `validateKey()` from `@simoncodes-ca/domain`.
2. **Resolve paths** — `resolveResourcePaths()`.
3. **Remove** — `folder.remove(entryKey)` removes the entry and its metadata.
4. **Save** — `folder.save()` rewrites both files, or deletes both when the folder has no entries left.
5. **Batch errors** — errors per key are collected and returned; the operation does not stop on first failure.

### move-resource

**Entry point:** `moveResource(collection, { source, destination, override, destinationCollection })`

Two modes:

- **Single key move** (`moveSingleResource`) — validates source and destination keys, checks for collision at destination (returns warning unless `override` is set), copies the entry and its metadata to the destination with `setEntry()` (lossless: values, comment, tags, checksums, and statuses such as `verified` and `stale` are kept; no auto-translation), then calls `deleteResource()` at the source. `moveFolder()` moves each resource this way.
- **Wildcard pattern move** (`moveResourcesByPattern`) — patterns ending with `*` are expanded by `walkFolders()` to enumerate all keys under the prefix, then each key is moved individually using `moveSingleResource()`.

---

## Collection Reader

**Entry point:** `readCollection(collection)` in `lib/resource/read-collection.ts`

The [Collection Reader](glossary.md#collection-reader) is the read side of the [Resource Folder](glossary.md#resource-folder). It walks a collection's `translationsFolder` and opens each folder with `openResourceFolder(folderPath, { baseLocale: collection.baseLocale })`. It returns `{ resources: StoredResource[], problems: CollectionReadProblem[] }`. It takes a `Collection`, or any object with `translationsFolder`, `baseLocale` and `tags` (`CollectionReadTarget`).

A `StoredResource` holds:

- the address: `fullKey` (`apps.common.buttons.ok`), `folderPath` (`apps.common.buttons`, `''` at the root) and `entryKey` (`ok`);
- `entry`: the `ResourceTreeEntry` that `ResourceFolder.treeEntry()` returns. It has `source`, `translations`, `metadata` per locale, `comment` and `tags`. `translations` holds every locale property stored besides `source`: normally the target locales, but a hand-written base-locale key is kept as stored. A `tags` value that is not an array reads as no tags;
- `effectiveTags`: the collection tags united with the entry tags ([Tags](glossary.md#tags)). The reader is the one place this union is made: export filtering, bundle selection rules and type generation read `effectiveTags` and do not compute it again.

`readCollectionFolders(collection, { startPath, maxDepth })` is the same walk, one folder at a time and lazily. `loadResourceTree` builds the tree from it, and `searchTranslations` uses it so that it can stop at `maxResults`.

The reader applies these rules for every caller:

| Case | Rule |
|---|---|
| Base locale | Each folder is opened with the collection's base locale. |
| Hidden folder (name starts with `.`) | Skipped. A key segment cannot start with `.`. |
| Missing `translationsFolder` | An empty collection. It is not a problem for the reader. `runExport` adds a `translations folder not found` warning, so a mistyped folder is visible. |
| Folder that exists but cannot be listed (permission denied, or the `translationsFolder` is a file) | Returned as a `CollectionReadProblem`. `walkFolders` reports it through its `onUnlistable` callback. `loadResourceTree` throws when its start folder is a file. |
| Entry without a `tracker_meta.json` record, or folder without the file | Read with `metadata: {}`. Each locale then has no status, and callers treat that as `new`. This is the domain rule (`needsTranslation(undefined)` is true) applied the same way everywhere: `translateLocale` now also machine-translates such entries, which `loadResourceTree` used to leave out. |
| Malformed folder: a file is not valid JSON, or an entry is not an object | None of the folder's entries are read. The folder is returned as a `CollectionReadProblem` (`folderPath`, `absolutePath`, and a `message` that names the file). The walk continues. |

The caller decides what a problem means:

| Caller | What it does with a problem |
|---|---|
| `validateResources` | Lists it in `unreadableFolders`, and validation fails. |
| `runExport` | Lists it under `malformedFiles` in the result and the summary. The other resources are exported. |
| Bundle and type generation (`loadCollectionResources`) | Adds a warning to the bundle result, once for each collection. Type generation logs it. |
| `glossary` (CLI) | Writes a warning to stderr. |
| `loadResourceTree`, `searchTranslations` | Log it. The tree keeps the folder, with no resources. |
| `translateLocale` | Does not translate the folder's resources and adds one line to `warnings` in the result (`Folder '<path>' was not translated: <message>`). The CLI prints the warnings after the summary; the API translation job logs them with `Logger.warn`. |

---

## Normalization Pipeline

**Entry point:** `normalize(params)` in `lib/normalize/normalize.ts`

[Normalization](glossary.md#normalization) is a repair and synchronization pass over the entire `translationsFolder`. It is designed to be idempotent and non-destructive — it never removes existing translation values.

Steps:

1. **Walk folders** — `walkFolders()` in `iterative-folder-walker.ts` traverses the directory tree iteratively (not recursively), grouping folders by depth level. Folders at the same depth are processed concurrently (`Promise.all`), but since all I/O inside is synchronous (`fs.readFileSync` / `fs.writeFileSync`), there is no interleaving risk.
2. **Load files per folder** — `loadResourceFiles()` reads `resource_entries.json` and `tracker_meta.json`, skipping folders with invalid JSON and emitting a console warning.
3. **Normalize each entry** — `normalizeEntry()` in `normalize-entry.ts` performs per-entry normalization:
   - Recomputes the base locale checksum and updates `tracker_meta.json` if it changed.
   - For each configured locale: adds a placeholder entry (base value copied, status `new`) if the locale is missing entirely; recomputes the translation checksum; updates status to `stale` if the stored `baseChecksum` no longer matches the current base checksum; converts any Transloco `{{ varName }}` syntax in stored values to ICU via `translocoToICU()` (tracked as `valuesConverted`).
4. **Persist changes** — if any entry in a folder changed, both JSON files are rewritten. If the files did not exist (orphaned folder), they are created.
5. **Dry-run mode** — when `dryRun: true`, all file writes are skipped and counters still reflect what *would* change.
6. **Cleanup empty folders** — after all folders are processed, `cleanupEmptyFolders()` removes any directories that no longer contain `resource_entries.json`.

Returns a `NormalizeResult` with counts: `entriesProcessed`, `localesAdded`, `valuesConverted`, `filesCreated`, `filesUpdated`, `foldersRemoved`.

---

## Auto-Translation Pipeline

**Entry point:** `openTranslator(collection, { provider?, protectedTerms? })` in `lib/translation/translator.ts`, which returns a `Translator` with one method, `translate(entries, locales) → { values, skipped }`.

The [Translator](glossary.md#translator) is the only way core machine-translates text. Its three callers only choose what needs work, by the [staleness rule](glossary.md#staleness-rule), and store what comes back:

| Caller | Entries → locales | Stores |
|---|---|---|
| [Locale seeding](#locale-seeding) (`addResource`, `editResource` on a base value change) | the base value → the target locales that need work and were not supplied | values as `translated`; a skipped locale gets a copy of the base as `new`, except on edit where it holds a real translation (kept, `stale`) |
| `translateExistingResource(collection, key)` | the entry → its target locales with `needsTranslation` | values as `translated`; skipped locales stay as they are |
| `translateLocale(collection, { targetLocale })` | every entry with `needsTranslation` for the locale (read with the [Collection Reader](#collection-reader)), in batches of `batchSize` with `delayMs` between them → `[targetLocale]` | values as `translated`, one save per folder per batch; skipped keys in `skippedKeys`; folders the reader could not read in `warnings` |

<!-- Auto-translation pipeline flowchart -->

```mermaid
flowchart TD
    OPEN(["openTranslator(collection, { provider? })"]) --> ENABLED{"translationConfig.enabled?"}
    ENABLED -- No --> DISABLED([Throw AutoTranslationDisabledError])
    ENABLED -- Yes --> INJECTED{"provider injected?"}
    READY -.- TERMSREAD["protectedTerms option, else readProtectedTermsInForce(collection)\n(ProtectedTermsFileError when a file is malformed)"]
    INJECTED -- Yes --> READY
    INJECTED -- No --> KEY{"process.env[apiKeyEnv] set?"}
    KEY -- No --> THROW_KEY([Throw TranslationError\nMISSING_API_KEY])
    KEY -- Yes --> FACTORY["createTranslationProvider(provider, apiKey)\n→ GoogleTranslateV2Provider"]
    FACTORY --> READY

    READY(["translate(entries, locales)"]) --> CLASSIFY

    CLASSIFY["Once per entry: classifyICUContent(source)"]
    CLASSIFY --> IS_COMPLEX{"complex-icu?"}
    IS_COMPLEX -- Yes --> SKIP_ICU(["skipped: complex-icu\n(never sent)"])
    IS_COMPLEX -- No --> PROTECT["simple placeholders → protectPlaceholders()\n<span class='notranslate'>__PHn__</span>"]

    PROTECT --> CALL["Per locale (in parallel), base locale ignored:\none provider.translate() call with every sendable entry"]
    CALL --> RESTORE{"restorePlaceholders():\nevery marker exactly once?"}
    RESTORE -- No --> SKIP_PH(["skipped: placeholder-mismatch"])
    RESTORE -- Yes --> NORMALISE["translocoToICU(value)"]
    NORMALISE --> TERMS{"findProtectedTermViolations(\nsource, value, protectedTerms)"}
    TERMS -- "terms dropped" --> SKIP_TERM(["skipped: protected-term\n(terms listed)"])
    TERMS -- none --> VALUE(["values: { key, locale, value }"])

    style DISABLED fill:#f8d7da,stroke:#dc3545,color:#000
    style THROW_KEY fill:#f8d7da,stroke:#dc3545,color:#000
    style SKIP_ICU fill:#fff3cd,stroke:#ffc107,color:#000
    style SKIP_PH fill:#fff3cd,stroke:#ffc107,color:#000
    style SKIP_TERM fill:#fff3cd,stroke:#ffc107,color:#000
    style VALUE fill:#d4edda,stroke:#28a745,color:#000
```

**What the Translator owns.** Setup (the enabled check, the API key, the provider), the ICU skip, the placeholder guard, the protected-term guard, and normalisation. Each happens in one place, for every caller. There is one code path: a single text is a batch of one. A provider failure (`TranslationError`) propagates; locale seeding passes it on, and `translateLocale` marks the batch as failed and goes on with the next one.

**Skip reasons.** `SkippedTranslation.reason` is `complex-icu`, `placeholder-mismatch` or `protected-term` (with the dropped `terms`). A translation that drops a protected term would be rejected by import, so it is not stored. The callers report skipped locales (`skippedLocales`) or keys (`skippedKeys`) without the reason.

**When the Translator is opened.** Only when there is work, so "nothing to translate" never needs an API key or a readable terms file. `translateExistingResource` checks `translationConfig.enabled` first (`AutoTranslationDisabledError`, 422 in the API), reads the entry, and opens the Translator only when a locale needs work. `translateLocale` opens it only when at least one resource needs work. Locale seeding opens it only when the config is enabled and a locale needs work. Opening reads the protected terms once (unless the `protectedTerms` option is passed), so with auto-translation on, `addResource`, `editResource` (on a base value change), `translateExistingResource` and `translateLocale` fail with `ProtectedTermsFileError` when a terms file is malformed.

**The provider seam.** The `provider` option replaces the configured provider, and the `protectedTerms` option replaces the terms files. `InMemoryTranslationProvider` (`in-memory-translation-provider.ts`) is the second adapter, internal to core: it translates each text with a function (default `[locale] text`) and records every call in `calls`, so specs can assert batching. It imports nothing from vitest. The core specs for the Translator, add, edit, translate-existing and translate-locale use it with real temp directories; none of them mocks a core module.

### Provider abstraction

The `TranslationProvider` interface in `translation-provider.ts` defines the contract that all translation backends must satisfy:

```typescript
interface TranslationProvider {
  translate(requests: TranslateRequest[]): Promise<TranslateResult[]>;
  getCapabilities(): ProviderCapabilities;
}
```

`createTranslationProvider(providerName, apiKey)` in `translation-provider-factory.ts` is the single switch-point that maps a configured provider name to a concrete implementation; `openTranslator` calls it when no provider is injected. Today only `'google-translate'` is supported, instantiating `GoogleTranslateV2Provider`. Adding a new provider (e.g. DeepL) requires:

1. Implementing `TranslationProvider`.
2. Adding one `case` branch in `createTranslationProvider()`.
3. Updating `TranslationConfig` to accept the new provider name.

**Why a single factory instead of a plugin registry?** LingoTracker has one configurable provider (the in-memory one is only injected). A plugin-registry pattern (dynamic module loading, registration maps) would add indirection and surface area for no concrete benefit. The factory switch is O(1), statically typed, and the full provider list is visible at a glance. If a second provider ships, the factory grows by four lines. This is "extensible without over-engineering" — the abstraction boundary (`TranslationProvider`) is clean; the wiring (`createTranslationProvider`) is simple until it needs to be otherwise.

The [ICU format](glossary.md#icu-format) classification determines safety: `plain` and `simple-placeholders` strings are sent (with placeholder protection for the latter); `complex-icu` strings (containing `plural`, `select`, or `selectordinal`) are skipped entirely because machine translation cannot reliably preserve nested ICU syntax.

---

## Import Pipeline

**Entry points:** `parseJsonImport(filePath)` / `parseXliffImport(filePath)` (format adapters) and `importResources(collection, resources, options)` (the [Import run](glossary.md#import-run)), in `lib/import/`.

An import has two parts. A **format adapter** reads one file and returns `ImportedResource[]` (`key`, `value`, optional `baseValue`, `comment`, `tags`, `status`). `parseJsonImport` detects a flat (`{"common.ok": "OK"}`) or hierarchical (`{common: {ok: "OK"}}`) structure with `detectJsonStructure()` and accepts rich objects; `parseXliffImport` (async) turns each trans-unit with a target into a resource. Adapters throw when the file is missing or malformed, and they know nothing about collections.

`importResources(collection, resources, options)` then applies the resources to one locale of the collection. It is synchronous, and the only entry point for the steps below. The CLI does `detectImportFormat` → adapter → `importResources` → `generateImportSummary`.

1. **Open the session** — `openImportSession(collection, options)` applies the strategy defaults for `createMissing`, `updateComments`, and `updateTags` (explicit options win) and refuses an import into `collection.baseLocale` unless the strategy is `migration`. The `ImportSession` holds the resolved options and collects `changes`, `warnings`, `errors`, `filesModified`, and the ICU fix records; each later step appends to it.
2. **Resolve references** (`migration` only) — `resolveAllReferences()` from `@simoncodes-ca/domain` inlines Transloco key references (`{{t('key')}}`, `{{key}}`) between the imported values. Missing and circular references stay literal and add a warning.
3. **Normalize syntax** — `normalizeTranslocoSyntaxInResources()` converts Transloco `{{ varName }}` to ICU `{varName}`.
4. **ICU auto-fix** — `applyICUAutoFixToResources()` repairs placeholders that differ from the stored base value (for example, a translated placeholder name), using `icuAutoFixer` from `@simoncodes-ca/domain`. Fixes and failures are recorded separately in the result.
5. **Validate** — `validateImportResources()` fails invalid keys and hierarchical conflicts, skips empty values, and warns on duplicate and very long keys, before any write.
6. **Group by folder** — `groupResourcesByFolder()` batches resources by their [resource folder](glossary.md#resource-folder), so each folder is read and written once.
7. **Process each group** — `processResourceGroup(session, group)` opens the folder with `openResourceFolder()` and applies each resource according to the [import strategy](glossary.md#import-strategy). A missing resource is skipped unless `createMissing` is set; a target-locale creation needs a `baseValue`. A base-locale import writes base values, and `ResourceFolder.setBase()` applies the [staleness rule](glossary.md#staleness-rule); on those imports every written value is checked against the preferred terminology (advisory warnings). A target-locale import warns on a `baseValue` mismatch, then runs `findProtectedTermViolations(storedSource, incomingValue, terms)`: a term that appears in the stored source and is missing from the incoming translation fails that entry with `Protected term(s) altered: …`, and the rest of the group is unaffected. Otherwise `resolveImportStatus()` (domain) decides the status. The folder is saved once, only when it changed and never in a dry run.
8. **Build the result** — `sessionResult()` derives the counts and status transitions from the session's changes and returns the `ImportResult`.

The caller passes `options.protectedTerms` and `options.preferredTerminology` (read from disk by the adapter layer), so the run itself reads no config. `generateImportSummary(result, { ...options, format, source })` renders the Markdown summary; the format and file path come from the caller because the run does not know where the resources came from.

Import strategies control how the merge behaves:

| Strategy | `createMissing` default | `updateComments` default | Base locale allowed |
|---|---|---|---|
| `translation-service` | false | false | No |
| `verification` | false | false | No |
| `migration` | true | true | Yes |
| `update` | false | false | No |

For the full sequence diagram of an import operation, see [user-flows.md — Import / Export Flow](user-flows.md#2-import--export-flow).

---

## Export Pipeline

**Entry point:** `runExport(collections, options)` in `lib/export/run-export.ts` (the [Export run](glossary.md#export-run)).

Export writes the resources of one or more collections to one file per target locale. `runExport` is the only entry point; the JSON and XLIFF exporters, the resource filter, and the summary are its internals. The CLI keeps the prompts, the output-directory and `--base-property-name` checks, the console rendering, and the write of the summary file (or, in a dry run, printing it).

1. **Choose the locales** — `exportTargetLocales(collections, options.locales)` lists every collection's target locales (a `Collection`'s `targetLocales`: its locales without its base locale) in order of first appearance, narrowed to the requested ones. The CLI calls it too, to print the plan before the run. The collections must share one base locale, because an export file has one source language; otherwise `runExport` throws.
2. **Load resources** — `loadResources(collection, protectedTerms)` in `export-common.ts` reads each collection through the [Collection Reader](#collection-reader). It flattens each `StoredResource` into a `LoadedResource` with `source`, `translations`, `status`, `tags`, `collectionTags`, `collectionProtectedTerms`, and `comment`. An entry without metadata is exported as `new`. A folder that cannot be read goes into `malformedFiles`.
3. **Filter per locale** — for each locale, only the collections that have that locale as a target contribute. `filterResources()` keeps the resources whose status (missing counts as `new`) matches `options.status` and whose effective tags (`effectiveTags(collectionTags, resourceTags)` from `libs/domain/src/lib/effective-tags.ts`) match `options.tags`. A locale with no match is skipped, and `onProgress` reports it.
4. **Annotate protected terms** — `filterResources()` calls `findProtectedTerms(source, effectiveProtectedTerms(global, collection))` on each row and stores the matches on `FilteredResource.protectedTermsFound`. The caller reads the term lists from disk and passes them as `options.protectedTerms` (`global`, and `collections` by name), so the run reads no config. `augmentProtectedTerms: false` (the `--no-protect-notes` flag) leaves the field `undefined`.
5. **Serialize** — the JSON exporter writes a flat or hierarchical file (hierarchical key conflicts are reported separately); the XLIFF exporter writes an XLIFF 1.2 document with `<trans-unit>` elements and `<note>` elements for comments. `protectedTermsFound` becomes a `doNotTranslate` array in rich JSON and a `Do not translate: …` note in XLIFF. An exporter that throws fails only its locale; the run continues.
6. **Report** — `ExportRunResult` is the totals over all locales (`ExportResult`: files, resource count, warnings, errors, hierarchical conflicts), one `localeResults` entry per locale (`exported`, `skipped`, or `failed`, with the exception message when an exporter threw), and the Markdown `summary`.

For the full sequence diagram, see [user-flows.md — Import / Export Flow](user-flows.md#2-import--export-flow).

---

## Protected Terms Resolution

**Entry points:** `lib/config/protected-terms-file.ts`

Core owns the resolution of protected terms, because they live in standalone JSON files rather than in `.lingo-tracker.json`.

Domain owns the pure logic: `normalizeProtectedTerms()`, `effectiveProtectedTerms()`, `findProtectedTerms()`, and `findProtectedTermViolations()`. Domain reads no files.

Resolution rules:

| Scope | Pointer | Default when absent |
|---|---|---|
| Global | `config.protectedTermsFile` | `.lingo-tracker-protected-terms.json` beside the config |
| Collection | `collection.protectedTermsFile` | None — the collection contributes no terms |

Core resolves both settings against the directory that holds `.lingo-tracker.json`. It uses an absolute path as it stands.

`readEffectiveProtectedTerms(config, collection, cwd)` returns the combined list. `resolveProtectedTermsForConfig(config, cwd)` reads every scope in one pass, which suits read-only consumers such as the API.

`openCollection` resolves the two paths, without reading them, into `Collection.protectedTermsFiles`: `global` (the pointer, else the default file), `globalExplicit` (whether the config names it), and `collection` (only when the collection names a file). `readProtectedTermsInForce(collection)` reads them through the cache and returns the same list as `readEffectiveProtectedTerms(config, raw, cwd)`. Opening a collection therefore reads no files, and a malformed terms file fails only the operations that use the terms. Today that is the [Translator](#auto-translation-pipeline), which reads them once when it is opened. Import and export still take `protectedTerms` from their caller.

Core caches reads in a module-level `Map` keyed by absolute path. It hands back a copy of each entry, so a caller that mutates the result leaves the cache intact. `writeProtectedTermsFile()` refreshes the entry it wrote, and `clearProtectedTermsFileCache()` drops every entry.

The two failure modes differ on purpose. An **absent** file reads as an empty list, and this is the normal state before the first term is added. Core warns only when the path came from an explicit setting, and only once per path (the Translator reads the files on every operation that auto-translates).

**Malformed** content throws `ProtectedTermsFileError` (`INVALID_PROTECTED_TERMS_FILE`, with `filePath`). That covers invalid JSON, a payload that is not an array, and an element that is not a string. An empty list here would protect nothing, and altered brand names would reach the resources through import or auto-translation with nobody seeing it.

Writes normalize the list, sort it alphabetically, and end the file with a newline. Adding a term therefore produces a one-line diff.

The pointer-setting functions call `assertWritableProtectedTermsPath()` *before* they mutate the config. A bad path therefore fails first, and the config keeps pointing at a file that can exist.

---

## Bundle Generation

**Entry point:** `generateBundle(params)` in `lib/bundle/generate-bundle.ts`

[Bundle](glossary.md#bundle) generation aggregates resources from one or more collections into a single locale JSON file per configured locale, converting [ICU format](glossary.md#icu-format) to Transloco syntax in the process.

Key steps:

1. **Resolve configuration** — token casing, ICU-to-Transloco transformation flag, and target locales are resolved via a three-level priority chain: CLI override → bundle config → global config → default.
2. **Load resources** — each collection is opened with `openCollection(config, name)`. `loadCollectionResources(collection, locale, cache, warnings)` reads it through the [Collection Reader](#collection-reader) once per run (the cache holds each collection's read). It returns one `{ key, value, tags }` for each entry that has a value for the locale, with the reader's effective tags. The value is `source` when the locale is the collection's own base locale, and the stored translation otherwise. An entry with no value for the locale is left out. A folder that cannot be read becomes a warning. The base data of a run — the debug-keys bundle, and the plan's key set, conflicts and types count — passes `COLLECTION_BASE_LOCALE` instead of a locale, so each collection gives its own base values even when it overrides the global base locale.
3. **Filter entries** — `EntrySelectionRule` objects in the `BundleDefinition` combine pattern matching (`matchesPattern()`) and tag filtering (`matchesTags()`) to include only the relevant subset of resources. Collections set to `'All'` skip filtering.
4. **ICU conversion** — when `transformICUToTransloco` is `true` (the default), `icuToTransloco()` from `@simoncodes-ca/domain` is called on each value. Values with malformed ICU syntax are passed through with a warning.
5. **Build hierarchy** — `buildHierarchy()` converts the flat `{dotKey: value}` map into a nested object matching the Angular Transloco expected structure.
6. **Write output** — `writeBundleFile()` creates the output directory if needed and writes the JSON file at the path defined by `bundleDefinition.dist` + `bundleDefinition.bundleName.replace('{locale}', locale)`.
7. **Type generation** — if `bundleDefinition.typeDist` is configured, `generateBundleTypes()` emits a TypeScript constant file with the translation key tree for use in Angular templates.

For a deep-dive into `BundleDefinition` configuration and the type generation sub-pipeline, see [bundle-generation.md](bundle-generation.md) *(phase 5, coming soon)*.

---

## Validation for CI/CD

**Entry point:** `validateResources(collections, options)` in `lib/validate/validate-resources.ts`

The validation pipeline is designed for headless CI/CD use. It takes the opened collections (`openCollection`) and validates them one by one. It reads each collection through the [Collection Reader](#collection-reader). Then it checks every resource in each of that collection's target locales (its `targetLocales` minus `options.skippedLocales`) against its stored [translation status](glossary.md#translation-status). Nothing is deduplicated across collections: a key in two collections is validated in both. The ICU pass compiles each collection's base values under that collection's base locale. The placeholder pass compares translations with that collection's base value. Terminology findings are reported under the collection's base locale.

Categorization rules:

| Status | Default result | With `allowTranslated: true` |
|---|---|---|
| `new` | Failure | Failure |
| `stale` | Failure | Failure |
| `translated` | Failure | Warning |
| `verified` | Success | Success |

The function never stops at the first failure — it validates all resources and returns a complete `ResourceValidationResult` so the team has full visibility. The result includes:

- `passed: boolean` — `true` only when there are no status failures, no unreadable folders, no ICU or placeholder failures, and the terminology file loaded
- `failures`, `warnings`, `successes` — `ResourceValidationDetail[]` objects with `key`, `locale`, `collection`, and `status`
- `unreadableFolders` — folders the reader could not read (`collection`, `folderPath`, `message`); their resources were not validated
- `statusCounts` — aggregate counts per status type
- `totalResourcesValidated`, `totalUniqueKeys` (resources checked; a key in two collections counts twice), `localesValidated` (distinct locales across collections), `collectionsValidated`

`generateValidationSummary()` in `generate-validation-summary.ts` converts this result into a human-readable string for CLI output.

The CLI's `validate` command exits with a non-zero code when `passed` is `false`, making it suitable for use as a blocking step in CI pipelines. The `--allow-translated` flag maps directly to `options.allowTranslated`.

`ValidationOptions.skippedLocales` removes locales from every collection's target locales. `generateValidationSummary()` also prints them as a `Skipped Locales: <list> (<count>)` line between "Locales Validated" and "Collections Validated". The other options are `icu` (`{ compileValues, requirePortablePlurals }`), `placeholders` (a boolean) and `terminology` (`{ rules, loadError }`). None of them names a locale: the locales come from the collections.

For the [staleness](glossary.md#staleness) detection mechanism that produces `stale` status entries in the first place, see [domain-and-data-model.md — Checksum-Driven Staleness Detection](domain-and-data-model.md#checksum-driven-staleness-detection).

For the CLI command signatures and flags that call into this library, see [cli.md](cli.md) *(phase 4, coming soon)*. For the API endpoints that expose these operations over HTTP, see [api.md](api.md) *(phase 4, coming soon)*.
