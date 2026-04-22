#!/usr/bin/env node
import minimist from 'minimist';
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import {
  loadConfig,
  saveRepos,
  writeConfigFile,
  type CliArgs,
} from './config';
import { discoverRepos } from './discovery';
import { formatTable, formatJson, formatCsv, formatMarkdown } from './formatter';
import { buildTimelineForDate } from './pipeline';
import { openBrowser, configFilePath, displayPath } from './platform';
import { createServer } from './server';

const args = minimist(process.argv.slice(2), {
  string: ['date', 'dir', 'format'],
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
  --date <date>   Date in YYYY-MM-DD format (default: today)
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
    if (config.roots.length === 0) {
      console.error('No roots configured. Run git-time-tracker --init first.');
      process.exit(1);
    }
    console.log(`Scanning ${config.roots.length} root(s) for git repositories...`);
    const repos = discoverRepos(config.roots, config.maxDepth);
    saveRepos(repos, config);
    console.log(`\nFound ${repos.length} repositor${repos.length !== 1 ? 'ies' : 'y'}:`);
    repos.forEach((r) => console.log(`  ${displayPath(r)}`));
    if (!args.init) {
      process.exit(0);
    }
    console.log('\nSetup complete. Run git-time-tracker to see your timeline.\n');
    process.exit(0);
  }

  if (config.repos.length === 0) {
    console.error(
      '\nNo repositories found in config.\n' +
        'Run git-time-tracker --init  (first time)\n' +
        '  or git-time-tracker --discover  (after adding new projects)\n',
    );
    process.exit(1);
  }

  // Hard requirement for analysis paths (CLI + UI): without an email we cannot
  // distinguish the current user's commits from those that merely passed
  // through HEAD (pulls, fetches, resets), and the commit-author filter in
  // reflog.ts silently no-ops on an empty email. Discovery and --init don't
  // touch reflogs and are allowed to run before the email is configured.
  if (!config.authorEmail) {
    console.error(
      '\ngit-time-tracker needs a git user email to identify your changes.\n' +
        'Set one with:\n' +
        '  git config --global user.email "you@example.com"\n',
    );
    process.exit(1);
  }

  if (args.ui) {
    const server = createServer(config);
    server.listen(config.port, '127.0.0.1', () => {
      const url = `http://localhost:${config.port}`;
      console.log(`git-time-tracker UI → ${url}`);
      openBrowser(url);
    });
    return;
  }

  // CLI mode
  const timeline = buildTimelineForDate(config, config.date);
  const useColor = args.color !== false;

  switch (args.format) {
    case 'json':
      console.log(formatJson(timeline));
      break;
    case 'csv':
      console.log(formatCsv(timeline));
      break;
    case 'markdown':
      console.log(formatMarkdown(timeline, config.date));
      break;
    default:
      console.log(formatTable(timeline, config.date, useColor));
  }
}

main().catch((err: unknown) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
