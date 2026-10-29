# LingoTracker

Translation management that lives in your repository.

LingoTracker manages translations for teams that keep strings in Git and review changes in pull requests. It stores source strings and translations as JSON, tracks translation status, and generates the per-locale JSON bundles and optional TypeScript key constants your application loads. It is built for [Transloco](https://github.com/jsverse/transloco). Other libraries can consume the nested JSON bundles when their placeholder syntax matches, with ICU-to-Transloco conversion turned off if needed.

One npm package gives you three ways in: a CLI, a local web UI with a REST API, and an installable skill for AI coding assistants. There is no hosted service and no account.

**Status:** pre-1.0. The CLI and API are stable and the tool is being validated in an enterprise Angular application. The 1.0 milestone is documentation; see the [roadmap](ROADMAP.md).

## Why use it

**Translations have a status.** Every translation is `new`, `translated`, `stale` or `verified`. When a source string changes, checksums mark every existing translation `stale`; untranslated copies stay `new`. Run `validate` in CI and nothing incomplete or unreviewed ships.

**Storage is reviewable.** Resources live in folders derived from their dot-delimited keys. Each folder holds one file for values and one for metadata, so a pull request shows exactly which strings and statuses changed.

**Bundles and typed keys are generated.** `lingo-tracker bundle` assembles one JSON file per locale from any mix of collections, key patterns and tags, and can emit a TypeScript constant tree so a mistyped key fails to compile.

**`validate` is a release gate.** It fails CI when a translation is missing, stale or unreviewed. It also compiles every value as an ICU message under its own locale, so a plural that is valid in English but invalid in Japanese is caught before it renders as an empty string.

**Vendor round trips are built in.** Export `new` and `stale` strings as XLIFF 1.2 or JSON. Import strategies set the resulting status. Import repairs placeholder names translators changed and rejects translations that altered a protected term.

**Terminology stays consistent.** Protected terms survive translation unchanged. Preferred terminology flags discouraged wording in source text. The glossary command gives help-content translators the terms your UI already uses.

**Machine translation covers the simple cases.** When auto-translation is enabled and a Google Cloud Translation key is configured, new strings are translated as you add them. Placeholders are protected, complex ICU messages are left for people, and the result is marked `translated`, never `verified`.

**A local web UI.** Browse a folder tree, search keys and values, filter by status, edit with similar-string suggestions, and run exports, imports and bundle generation with a live preview.

**AI assistants can do the chores.** `lingo-tracker install-skill` writes a skill tailored to your collections and bundles, so Claude Code or a similar tool can find hardcoded strings, reuse existing keys, add resources and update components.

## Quick start

Requires Node.js 24.15 or later within the 24 line, or Node.js 26 or later.

```bash
pnpm add -D @simoncodes-ca/lingo-tracker     # or npm install --save-dev / yarn add -D

# Create .lingo-tracker.json
npx lingo-tracker init \
  --collection-name main --translations-folder src/i18n \
  --base-locale en --locales en fr-ca es \
  --setup-bundle true --bundle-dist ./src/assets/i18n \
  --type-dist-file ./src/generated/translation-tokens.ts

# Add a string, translate it, and generate the runtime files
npx lingo-tracker add-resource --key common.buttons.save --value "Save" --comment "Button on edit forms"
npx lingo-tracker edit-resource --key common.buttons.save --locale fr-ca --locale-value "Enregistrer"
npx lingo-tracker bundle

# Open the web UI at http://localhost:3030
npx lingo-tracker-app
```

Before a release, run `npx lingo-tracker validate`. In this example it exits with code 1, because the French translation is not yet verified and the Spanish one is still the English text.

The [Getting Started guide](https://simoncodes-ca.github.io/lingo-tracker/docs/getting-started) explains each step and what the files look like.

## What it does not do

- It does not host translations or coordinate translators. Hand-off happens through exported files.
- It has no user accounts or history beyond what Git gives you.
- Machine translation supports Google Cloud Translation v2 only and skips plural, select and formatted ICU messages.
- The web UI runs locally without authentication. It is for one developer's machine, not a shared server.

## Documentation

The full documentation is at [simoncodes-ca.github.io/lingo-tracker](https://simoncodes-ca.github.io/lingo-tracker/).

| Page | Covers |
|---|---|
| [Getting Started](docs/getting-started.md) | Install, init, first resource, first bundle |
| [Concepts](docs/concepts.md) | Keys, folders, the two files, statuses and checksums |
| [Configuration](docs/configuration.md) | Every field of `.lingo-tracker.json` |
| [CLI Reference](docs/cli.md) | Every command, flag and exit code |
| [API Reference](docs/api.md) | Every endpoint of `lingo-tracker-app` |
| [Tracker UI](docs/tracker-ui.md) | The web application |
| [Guides](docs/guides/) | Bundling, translation workflow, CI/CD, migration, normalize, AI assistant |
| [Features](docs/features/) | Validate, export, import, type generation, terminology, glossary |

For contributors, [architecture-docs](architecture-docs/README.md) describes the monorepo, data model and application layers.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests and the commit convention.

## License

[MIT](LICENSE)
