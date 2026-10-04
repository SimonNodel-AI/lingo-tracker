export const importHelpText = `
Examples:
  # Import XLIFF from translation service (most common workflow)
  $ lingo-tracker import --source translations-es.xlf --locale es

  # Import with dry-run to preview changes first
  $ lingo-tracker import --source translations-fr.xlf --locale fr --dry-run

  # Import JSON file (format auto-detected from .json extension)
  $ lingo-tracker import --source translated-de.json --locale de

  # Migrate from another translation system with rich metadata
  $ lingo-tracker import --source old-system.json --locale es \\
      --strategy migration --create-missing --update-comments --update-tags

  # Language expert verification workflow
  $ lingo-tracker import --source verified-ja.xlf --locale ja --strategy verification

  # Bulk update existing translations (preserves current status)
  $ lingo-tracker import --source updates-pt.json --locale pt --strategy update

  # Import to specific collection with verbose logging
  $ lingo-tracker import --source admin-ko.xlf --locale ko \\
      --collection admin --verbose

Import Strategies:
  translation-service  Professional translation import (default)
                       - Updates existing resources only (no creation)
                       - Sets status to 'translated'
                       - Best for workflow with translation agencies

  verification        Language expert review workflow
                       - Sets status to 'verified' for reviewed translations
                       - Used after native speaker review
                       - Indicates higher confidence level

  migration           Migrate from another translation system
                       - Allows creating missing resources (with --create-missing)
                       - Resolves Transloco-style references: {{t('key')}}
                       - Can update comments and tags
                       - Best for one-time migration

  update              Bulk update existing translations
                       - Preserves current translation status
                       - Updates values without changing metadata
                       - Best for automated batch updates

Notes:
  - Format is auto-detected from file extension (.xlf, .xliff, .json)
  - Use --dry-run to preview changes before committing
  - Summary report saved to {translationsFolder}/import-summary.md
  - Large files (>5MB) will show a warning
`;

export const validateHelpText = `
Examples:
  # Basic validation (strict mode - requires all translations verified)
  $ lingo-tracker validate

  # Relaxed mode - allow translated status with warnings
  $ lingo-tracker validate --allow-translated

  # Skip specific locales (e.g. newly-added locale still in progress)
  $ lingo-tracker validate --skip-locales fr
  $ lingo-tracker validate --skip-locales fr,de

  # Skip ICU compilation; other checks still apply
  $ lingo-tracker validate --skip-icu

  # Also warn about base-locale plurals that break when copied to ja/ko
  $ lingo-tracker validate --require-portable-plurals

  # Skip the placeholder-agreement check
  $ lingo-tracker validate --skip-placeholders

  # Skip the protected-term preservation check
  $ lingo-tracker validate --skip-protected-terms

  # Use in CI pipeline (exits with code 1 on validation failure)
  $ lingo-tracker validate || exit 1

Example Output (Success):
  ✅ Validation PASSED

  📊 Validation Statistics:
  ──────────────────────────────────────────────────
    Total Resources Validated: 450
    Unique Resource Keys: 150
    Locales Validated: 3
    Collections Validated: 1

  📈 Status Breakdown:
  ──────────────────────────────────────────────────
    ✅ Verified: 450
    ✏️  Translated: 0
    ⚠️  Stale: 0
    ❌ New: 0

  ──────────────────────────────────────────────────
  📋 Summary:
    Total Failures: 0
    Total Successes: 450

  ✅ Validation passed successfully!

Example Output (Failures):
  ❌ Validation FAILED

  📊 Validation Statistics:
  ──────────────────────────────────────────────────
    Total Resources Validated: 450
    Unique Resource Keys: 150
    Locales Validated: 3
    Collections Validated: 1

  📈 Status Breakdown:
  ──────────────────────────────────────────────────
    ✅ Verified: 420
    ✏️  Translated: 15
    ⚠️  Stale: 10
    ❌ New: 5

  ❌ Failures (30):
  ──────────────────────────────────────────────────
    Locale: es (10 failures)
      ❌ [main] common.buttons.submit (new)
      ⚠️  [main] dashboard.title (stale)
      ✏️  [main] settings.description (translated)
      ...

    Locale: fr (10 failures)
      ...

  ──────────────────────────────────────────────────
  📋 Summary:
    Total Failures: 30
    Total Successes: 420

  ❌ Validation failed. Please review the failures above.

CI Integration Examples:

  # GitHub Actions
  - name: Validate translations
    run: |
      npm install -g lingo-tracker
      lingo-tracker validate
      # Or with relaxed mode: lingo-tracker validate --allow-translated

  # GitLab CI
  validate-translations:
    stage: test
    script:
      - npm install -g lingo-tracker
      - lingo-tracker validate
    only:
      - main
      - merge_requests

  # CircleCI
  - run:
      name: Validate translations
      command: |
        npm install -g lingo-tracker
        lingo-tracker validate

  # Jenkins
  stage('Validate Translations') {
    steps {
      sh 'npm install -g lingo-tracker'
      sh 'lingo-tracker validate'
    }
  }

Validation Rules:
  ❌ new        Resource not yet translated → FAILURE
  ⚠️  stale      Translation out of sync with source → FAILURE
  ✏️  translated Has translation but not verified → FAILURE (default)
                                                  → WARNING (--allow-translated)
  ✅ verified   Translation reviewed and approved → SUCCESS
  ⚠️  terminology Base value uses a discouraged term → WARNING (never fails)

Exit Codes:
  0  All validations passed (all resources verified); preferred terminology
     warnings do not change the exit code
  1  Status, ICU, placeholder, or protected-term failures, or the
     preferred terminology file exists but cannot be loaded

Notes:
  - Compiles every stored value under its own locale; values that fail are failures
  - Plural categories are per-language, so a 'verified' value can still fail to compile
  - The base locale is compiled too: its value is copied into every translation slot
  - Use --skip-icu to skip compilation; other checks still apply, including
    --require-portable-plurals, which parses rather than compiles
  - Checks that every translation interpolates the same placeholders as its base
    value; a renamed one ('{name}' translated to '{nombre}') renders as empty
    text rather than raising, so no other check sees it. Use --skip-placeholders
    to turn this off
  - Checks translations for dropped or altered protected terms from the project
    and collection lists. Use --skip-protected-terms to turn this off
  - Scans each collection's base-locale values for discouraged terms from the
    preferred terminology file (.lingo-tracker-preferred-terminology.json, or
    preferredTerminologyFile in .lingo-tracker.json). Findings are warnings,
    reported once per key and rule; a broken file is a failure. No opt-out flag
  - --skip-locales excludes target locales only; the base locale is always
    compiled, since its value is copied into every translation slot
  - Validates ALL collections and ALL target locales (no filtering) by default
  - Use --skip-locales to exclude specific locales; skipped locales appear in the report
  - Unknown locale values in --skip-locales emit a warning and are ignored
  - Collects ALL failures before reporting (comprehensive check)
  - Perfect for pre-release quality gates in CI/CD pipelines
  - Use --allow-translated for staging environments
  - Strict mode (default) recommended for production releases
`;

export const preferredTerminologyHelpText = `
Examples:
  # List rules
  $ lingo-tracker preferred-terminology --list

  # Add a rule (the file is created if absent)
  $ lingo-tracker preferred-terminology --add "Expenditure" --preferred "Investment" --reason "Brand voice"

  # Update a rule: --add on an existing discouraged term replaces the whole rule,
  # so omitting --reason clears any previous reason
  $ lingo-tracker preferred-terminology --add "expenditure" --preferred "Spending"

  # Remove a rule
  $ lingo-tracker preferred-terminology --remove "Expenditure"

Rules live in .lingo-tracker-preferred-terminology.json beside .lingo-tracker.json,
or in the file named by "preferredTerminologyFile" in .lingo-tracker.json.
`;
