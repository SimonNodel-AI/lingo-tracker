import * as fs from 'fs';
import * as path from 'path';
import { openCollection, readCollection } from '@simoncodes-ca/core';
import type { LingoTrackerConfig } from '@simoncodes-ca/core';
import { type CommandResult, defineCommand } from '../runner/command-runner';
import { hasPipedStdin } from '../runner/terminal';
import { ConsoleFormatter, parseCommaSeparatedList } from '../utils';
import { resolveExtractor, type CandidateExtractor, type ExtractorMode } from './glossary-extractor';
import { matchGlossary, type FlatEntry } from './glossary-matcher';

export interface GlossaryCommandOptions {
  /** Inline text snippet to extract from. */
  text?: string;
  /** Path to a file whose contents are the input block. */
  input?: string;
  /** Output file path (defaults to a timestamped file in the cwd). */
  output?: string;
  /** Print the glossary JSON to stdout instead of a file. */
  stdout?: boolean;
  /** Limit matching to a single collection (default: all collections). */
  collection?: string;
  /** Comma-separated locales to include (default: all configured locales). */
  locales?: string;
  /** Include new/stale entries (default: only translated + verified). */
  includeAll?: boolean;
  /** Extraction strategy (default: ngram). */
  extractor?: ExtractorMode;
}

/**
 * Reads the input block from --text, --input <file>, or piped stdin (in that order
 * of precedence). Returns null and reports an error when no input is available.
 */
function resolveInputText(options: GlossaryCommandOptions, cwd: string): string | null {
  if (options.text && options.text.trim().length > 0) {
    return options.text;
  }

  if (options.input) {
    const inputPath = path.resolve(cwd, options.input);
    if (!fs.existsSync(inputPath)) {
      ConsoleFormatter.error(`Input file not found: ${inputPath}`);
      return null;
    }
    return fs.readFileSync(inputPath, 'utf8');
  }

  // Fall back to piped stdin when not attached to a terminal.
  if (hasPipedStdin()) {
    try {
      const piped = fs.readFileSync(0, 'utf8');
      if (piped.trim().length > 0) return piped;
    } catch {
      // No readable stdin — fall through to the error below.
    }
  }

  ConsoleFormatter.error('No input provided. Use --text "...", --input <file>, or pipe text via stdin.');
  return null;
}

/**
 * Loads entries from the requested collection(s) through the core Collection Reader,
 * mapping each stored resource to the matcher's `FlatEntry`. A folder that cannot be read
 * is reported as a warning and its entries are left out.
 * A named collection that does not exist throws CollectionNotFoundError (the runner exits 1).
 */
function loadEntries(options: GlossaryCommandOptions, config: LingoTrackerConfig, cwd: string): FlatEntry[] {
  const names = options.collection ? [options.collection] : Object.keys(config.collections ?? {});
  const targets = names.map((name) => openCollection(config, name, { cwd }));

  const entries: FlatEntry[] = [];
  for (const collection of targets) {
    const { resources, problems } = readCollection(collection);
    // stderr, so --stdout output stays valid JSON.
    for (const problem of problems) {
      console.warn(`⚠️  Collection '${collection.name}': skipped unreadable folder: ${problem.message}`);
    }
    for (const { fullKey, entry } of resources) {
      const translations = { ...entry.translations };
      delete translations[collection.baseLocale];
      const status: FlatEntry['status'] = {};
      for (const [locale, meta] of Object.entries(entry.metadata)) {
        if (meta?.status) status[locale] = meta.status;
      }
      entries.push({ key: fullKey, collection: collection.name, source: entry.source, translations, status });
    }
  }
  return entries;
}

function buildOutputPath(options: GlossaryCommandOptions, cwd: string): string {
  if (options.output) return path.resolve(cwd, options.output);
  // Keep milliseconds so two runs in the same second don't overwrite each other.
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.resolve(cwd, `lingo-tracker-glossary-${timestamp}.json`);
}

export const glossaryCommand = defineCommand<GlossaryCommandOptions>()({
  name: 'Glossary',
  // `--collection` is optional here: absent means every collection, so the runner opens nothing.
  collection: 'none',
  run: ({ config, cwd, answers }) => runGlossary(answers, config, cwd),
});

function runGlossary(options: GlossaryCommandOptions, config: LingoTrackerConfig, cwd: string): CommandResult {
  const block = resolveInputText(options, cwd);
  if (block === null) {
    return { exitCode: 1 };
  }

  const baseLocale = config.baseLocale || 'en';
  const requested = parseCommaSeparatedList(options.locales) ?? config.locales ?? [];
  const targetLocales = requested.filter((locale) => locale !== baseLocale);

  if (targetLocales.length === 0) {
    ConsoleFormatter.warning('No target locales to include (only the base locale is configured or requested).');
  }

  const entries = loadEntries(options, config, cwd);
  const extractor: CandidateExtractor = resolveExtractor(options.extractor ?? 'ngram');

  const candidates = extractor(block);
  const terms = matchGlossary(entries, candidates, {
    locales: targetLocales,
    includeAll: options.includeAll,
  });

  const glossary = {
    baseLocale,
    locales: targetLocales,
    source: { chars: block.length, candidates: candidates.length },
    matchCount: terms.length,
    terms,
  };

  const json = JSON.stringify(glossary, null, 2);

  if (options.stdout) {
    // Keep stdout clean for piping; status goes to stderr.
    process.stdout.write(`${json}\n`);
    console.error(`✅ ${terms.length} term(s) matched from ${candidates.length} candidate(s).`);
    return;
  }

  const outputPath = buildOutputPath(options, cwd);
  fs.writeFileSync(outputPath, json);

  if (terms.length === 0) {
    ConsoleFormatter.info(`No matching translations found. Wrote empty glossary to: ${outputPath}`);
  } else {
    ConsoleFormatter.success(`${terms.length} term(s) matched from ${candidates.length} candidate(s).`);
    ConsoleFormatter.keyValue('Glossary written to', outputPath);
  }
}
