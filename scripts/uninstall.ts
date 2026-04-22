#!/usr/bin/env ts-node
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { configDirFor } from '../src/platform';
import pkg from '../package.json';

function printHelp(): void {
  console.log(`
Usage: ts-node scripts/uninstall.ts [--yes]

Removes the global \`npm link\` for ${pkg.name} and, optionally, its
config directory.

Options:
  --yes    Skip the confirmation prompt and remove the config directory
  --help   Show this message
`);
}

function parseFlags(argv: string[]): { yes: boolean } {
  let yes = false;
  for (const a of argv) {
    if (a === '--yes' || a === '-y') yes = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  return { yes };
}

function confirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

async function main(): Promise<void> {
  const { yes } = parseFlags(process.argv.slice(2));
  const configDir = configDirFor(pkg.name);

  console.log(`Uninstalling "${pkg.name}"\n`);

  console.log(`→ npm unlink -g ${pkg.name}`);
  const r = spawnSync('npm', ['unlink', '-g', pkg.name], { stdio: 'inherit' });
  if (r.error) {
    console.error(`Failed to run npm: ${r.error.message}`);
    process.exit(1);
  }
  console.log('');

  if (!fs.existsSync(configDir)) {
    console.log(`Config dir ${configDir} not found — nothing more to do.`);
    return;
  }

  const shouldRemove = yes || (await confirm(`Remove config dir ${configDir}? [y/N] `));
  if (shouldRemove) {
    fs.rmSync(configDir, { recursive: true, force: true });
    console.log(`Removed ${configDir}`);
  } else {
    console.log(`Kept ${configDir}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
