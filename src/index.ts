#!/usr/bin/env node
import minimist from 'minimist';
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import {
  CliArgsError,
  isSingleDay,
  loadConfig,
  saveRepos,
  writeConfigFile,
  type CliArgs,
  type Config,
} from './config';
import { discoverRepos } from './discovery';
import { rangeTitle, summarizeRange } from './formatter';
import { renderTimeline, resolveFormat } from './output';
import { buildTimelineForRange } from './pipeline';
import { openBrowser, configFilePath, displayPath } from './platform';
import { resolveReportPath, writeReport } from './report';
import { createServer } from './server';

const args = minimist(process.argv.slice(2), {
  string: ['date', 'from', 'to', 'dir', 'format', 'out'],
  boolean: ['ui', 'discover', 'init', 'color', 'help'],
  default: { color: true },
  alias: { h: 'help' },
}) as CliArgs;

// minimist returns numeric flags as strings when no `number` option is given;
// coerce port explicitly so the rest of the code always sees a number or undefined.
if (args.port !== undefined) {
  args.port = Number(args.port);
}

function printHelp(): void {
  console.log(`
Usage: git-time-tracker [options]

Options:
  --dir <path>    Add a root directory (repeatable, extends config file)
  --date <date>   Single date in YYYY-MM-DD format (default: today)
  --from <date>   Range start (inclusive); without --to, ends today
  --to <date>     Range end (inclusive); requires --from
  --out [path]    Write the result to a file instead of stdout.
                  Bare --out writes reports/<from>_<to>.<ext> (gitignored)
                  and defaults the format to markdown.
  --ui            Launch interactive UI in browser
  --port <n>      Port for web server (default: 3456)
  --format <fmt>  table | json | csv | markdown  (default: table)
  --no-color      Disable ANSI colours
  --discover      Scan roots[] for git repositories, write repos[] to config
  --init          Interactive setup wizard (includes --discover automatically)
  --help          Show this message
`);
}

async function runInit(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

  console.log('\nWelcome to git-time-tracker setup!\n');
  console.log('Enter the root directories that contain your git repositories.');
  console.log('Press Enter with an empty line when done.\n');

  const roots: string[] = [];

  while (true) {
    const input = (await ask(`Root directory ${roots.length + 1} (or Enter to finish): `)).trim();
    if (!input) break;
    if (!fs.existsSync(input)) {
      console.log(`  ! Directory not found: ${input}`);
      continue;
    }
    roots.push(input);
    console.log(`  + Added: ${displayPath(input)}`);
  }

  rl.close();

  if (roots.length === 0) {
    console.log('\nNo directories added. Exiting.');
    process.exit(1);
  }

  writeConfigFile(configFilePath, { roots });
  console.log(`\nConfig saved: ${configFilePath}`);
  console.log('\nRunning discovery...\n');
}

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/** Scans `roots[]` and stores the result. Exits when run standalone. */
function runDiscovery(config: Config): void {
  if (config.roots.length === 0) {
    fail('No roots configured. Run git-time-tracker --init first.');
  }
  console.log(`Scanning ${config.roots.length} root(s) for git repositories...`);
  const repos = discoverRepos(config.roots, config.maxDepth);
  saveRepos(repos, config);
  console.log(`\nFound ${repos.length} repositor${repos.length !== 1 ? 'ies' : 'y'}:`);
  repos.forEach((r) => console.log(`  ${displayPath(r)}`));
  if (args.init) {
    console.log('\nSetup complete. Run git-time-tracker to see your timeline.\n');
  }
  process.exit(0);
}

/**
 * Guards shared by both analysis paths (CLI and UI). Discovery and `--init`
 * skip these: they never touch a reflog.
 */
function requireAnalysableConfig(config: Config): void {
  if (config.repos.length === 0) {
    fail(
      'No repositories found in config.\n' +
        'Run git-time-tracker --init  (first time)\n' +
        '  or git-time-tracker --discover  (after adding new projects)',
    );
  }
  // Without an email we cannot distinguish the current user's commits from those
  // that merely passed through HEAD (pulls, fetches, resets), and the
  // commit-author filter in reflog.ts silently no-ops on an empty email.
  if (!config.authorEmail) {
    fail(
      'git-time-tracker needs a git user email to identify your changes.\n' +
        'Set one with:\n' +
        '  git config --global user.email "you@example.com"',
    );
  }
}

function runUi(config: Config): void {
  if (!isSingleDay(config.range)) {
    console.log(
      `Note: the UI browses one day at a time — opening on ${config.range.from}, ignoring --to.`,
    );
  }
  const server = createServer(config);
  server.listen(config.port, '127.0.0.1', () => {
    const url = `http://localhost:${config.port}`;
    console.log(`git-time-tracker UI → ${url}`);
    openBrowser(url);
  });
}

function runTimeline(config: Config): void {
  const { range } = config;
  const toFile = args.out !== undefined;
  const format = resolveFormat(args.format, args.out);
  // ANSI escapes would end up as literal bytes in a saved file.
  const useColor = args.color !== false && !toFile;

  const timeline = buildTimelineForRange(config, range);
  const output = renderTimeline(timeline, range, format, useColor);

  if (!toFile) {
    console.log(output);
    return;
  }

  const filePath = resolveReportPath(args.out ?? '', range, format);
  writeReport(filePath, output);
  console.log(
    `Wrote ${displayPath(filePath)}\n  ${rangeTitle(range)} — ${summarizeRange(timeline, range)}`,
  );
}

async function main(): Promise<void> {
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.init) {
    await runInit();
    args.discover = true;
  }

  const config = loadConfig(args);

  if (args.discover) {
    runDiscovery(config);
  }

  requireAnalysableConfig(config);

  if (args.ui) {
    runUi(config);
    return;
  }

  runTimeline(config);
}

main().catch((err: unknown) => {
  // Bad flags are the user's problem to fix, not a crash: one clear line, no stack.
  if (err instanceof CliArgsError) fail(err.message);
  console.error('Unexpected error:', err);
  process.exit(1);
});
