import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { isCommitType, type NormalizedEvent } from './events';
import { gitBin } from './platform';

export type TimelineEntry = NormalizedEvent;

export function buildTimeline(events: NormalizedEvent[]): TimelineEntry[] {
  return [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

export function isWipMessage(msg: string | undefined): boolean {
  return /^wip$/i.test((msg ?? '').trim());
}

function firstNonEmptyLine(output: string): string | undefined {
  return output.split('\n').find((l) => l.trim())?.trim();
}

function runGit(repoPath: string, args: string[]): string | undefined {
  const r = spawnSync(gitBin, args, { cwd: repoPath, encoding: 'utf8', timeout: 5_000 });
  return r.status === 0 ? r.stdout : undefined;
}

function lookupBranchForHash(repoPath: string, hash: string): string | undefined {
  // Branches whose tip is this commit — covers the current and amend-head cases.
  const pointsAt = runGit(repoPath, [
    'for-each-ref',
    `--points-at=${hash}`,
    '--format=%(refname:short)',
    'refs/heads/',
  ]);
  const tip = pointsAt && firstNonEmptyLine(pointsAt);
  if (tip) return tip;

  // Pre-amend hashes aren't tips; fall back to any branch containing the commit.
  const contains = runGit(repoPath, [
    'branch',
    '--contains',
    hash,
    '--format=%(refname:short)',
  ]);
  return contains ? firstNonEmptyLine(contains) : undefined;
}

/**
 * Walks the timeline chronologically to resolve the branch each commit was made on.
 * CHECKOUT events update the per-repo "current branch"; commits inherit it.
 * For WIP commits with no prior checkout observed, we shell out as a fallback.
 */
export function annotateCommitBranches(entries: TimelineEntry[]): TimelineEntry[] {
  const currentBranch = new Map<string, string>();

  return entries.map((e) => {
    if (e.type === 'CHECKOUT' && e.toBranch) {
      currentBranch.set(e.repoPath, e.toBranch);
      return e;
    }
    if (e.type === 'CHECKOUT_DETACHED') {
      // In detached HEAD state, subsequent commits aren't on a named branch.
      // Clear the tracked branch so WIP lookups fall back to the hash-based
      // resolver instead of inheriting a stale branch name.
      currentBranch.delete(e.repoPath);
      return e;
    }
    if (!isCommitType(e.type)) return e;

    let branch = currentBranch.get(e.repoPath);
    if (!branch && isWipMessage(e.message)) {
      branch = lookupBranchForHash(e.repoPath, e.hash);
      if (branch) currentBranch.set(e.repoPath, branch);
    }
    return branch ? { ...e, branch } : e;
  });
}

/**
 * Computes the display name for each repo path according to these rules:
 *  - Single root   → just the repo folder name  (e.g. "my-app")
 *  - Multiple roots, no collision → "root-last-folder/repo"  (e.g. "Projects_win/my-app")
 *  - Multiple roots, collision    → full absolute path
 *
 * The prefix is always path.basename(root) — the last segment of the root the
 * repo was discovered under — not the repo's immediate parent directory.
 * This means repos nested under sub-folders within a root (e.g. root/DISE/app)
 * still display as "root/app", not "DISE/app".
 */
export function buildRepoDisplayNames(
  repoPaths: string[],
  roots: string[],
): Map<string, string> {
  const map = new Map<string, string>();

  if (roots.length <= 1) {
    for (const p of repoPaths) {
      map.set(p, path.basename(p));
    }
    return map;
  }

  // Normalize separators for cross-platform prefix matching.
  const norm = (p: string) => p.replace(/\\/g, '/');

  const rootOf = (repoPath: string): string | undefined => {
    const normalRepo = norm(repoPath);
    return roots.find((root) => normalRepo.startsWith(norm(root) + '/'));
  };

  const shortName = (p: string): string => {
    const root = rootOf(p);
    const prefix = root ? path.basename(root) : path.basename(path.dirname(p));
    return `${prefix}/${path.basename(p)}`;
  };

  const counts = new Map<string, number>();
  for (const p of repoPaths) {
    const n = shortName(p);
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }

  for (const p of repoPaths) {
    const n = shortName(p);
    map.set(p, (counts.get(n) ?? 0) > 1 ? p : n);
  }

  return map;
}
