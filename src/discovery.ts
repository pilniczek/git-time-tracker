import * as fs from 'node:fs';
import * as path from 'node:path';

const BLACKLIST = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  'target',
  '.cache',
  '.next',
  '.nuxt',
  '__pycache__',
]);

function isGitRepo(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, '.git')).isDirectory();
  } catch {
    return false;
  }
}

function scanDir(
  dir: string,
  depth: number,
  maxDepth: number,
  results: Set<string>,
): void {
  if (depth > maxDepth) return;

  if (isGitRepo(dir)) {
    try {
      results.add(fs.realpathSync(dir));
    } catch {
      results.add(dir);
    }
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    if (BLACKLIST.has(entry.name)) continue;
    scanDir(path.join(dir, entry.name), depth + 1, maxDepth, results);
  }
}

export function discoverRepos(roots: string[], maxDepth = 5): string[] {
  const results = new Set<string>();
  for (const root of roots) {
    scanDir(root, 0, maxDepth, results);
  }
  return Array.from(results).sort();
}
