import { spawnSync } from 'node:child_process';
import { gitBin } from './platform';
import type { RawReflogEntry } from './events';

// %gd with --date=iso yields "HEAD@{2026-04-07 14:58:32 +0200}" — the actual
// event timestamp, not the commit author date. This is what we want for ordering.
const FORMAT = '%H|%gd|%gs|%an|%ae';
const MIN_FIELDS = 5;

export function readReflog(
  repoPath: string,
  date: string,
  authorEmail: string,
): RawReflogEntry[] {
  const result = spawnSync(
    gitBin,
    [
      'log',
      '-g',
      `--format=${FORMAT}`,
      '--date=iso',
      // --author and --after/--before are intentionally omitted: both use the
      // commit author date, which is wrong for CHECKOUT/MERGE/REBASE events.
      // Date and author filtering is done in parseReflogOutput instead.
      'HEAD',
    ],
    {
      cwd: repoPath,
      encoding: 'utf8',
      timeout: 10_000,
    },
  );

  if (result.status !== 0 || !result.stdout) {
    if (result.stderr && result.status !== 0) {
      const stderr = String(result.stderr).trim();
      // Empty repos (no HEAD yet) are not an error — just skip quietly.
      const isEmptyRepo = /unknown revision|ambiguous argument 'HEAD'/.test(stderr);
      if (!isEmptyRepo) {
        console.error(`git-time-tracker: ${repoPath}: ${stderr}`);
      }
    }
    return [];
  }

  return parseReflogOutput(result.stdout, repoPath, date, authorEmail);
}

interface ParsedLine {
  hash: string;
  subject: string;
  timestamp: string;
  authorEmail: string;
}

/**
 * Splits one formatted reflog line. The %gs field may contain pipes, so we
 * anchor to the first two and last two fields and rejoin what's in between.
 * Format: %H | %gd | %gs | %an | %ae  (5 fields, but %gs may embed extra `|`)
 */
function parseLine(line: string): ParsedLine | null {
  const parts = line.split('|');
  if (parts.length < MIN_FIELDS) return null;

  const hash = parts[0];
  const selector = parts[1];
  const authorEmail = parts[parts.length - 1];
  const subject = parts.slice(2, -2).join('|');

  const tsMatch = /\{(.+)\}/.exec(selector);
  if (!tsMatch) return null;

  return { hash, subject, timestamp: tsMatch[1], authorEmail };
}

function matchesAuthor(parsed: ParsedLine, authorEmail: string | undefined): boolean {
  // Commit events must match the configured author. Non-commit events
  // (checkout/merge/rebase) are always the current user's own actions — the
  // local reflog records every HEAD movement this user made regardless of
  // the commit's author — so the author check is skipped for those.
  //
  // Fail-closed: `authorEmail === undefined` means "no filter" (test path);
  // an empty string is treated as an un-matchable author so an accidentally-
  // lost email drops all commits rather than leaking other authors'. The
  // production path is guarded further upstream in index.ts so this branch
  // is defence-in-depth.
  const isCommitEvent = /^commit[:\s(]/.test(parsed.subject);
  if (isCommitEvent && authorEmail !== undefined && parsed.authorEmail !== authorEmail) {
    return false;
  }
  return true;
}

function isCheckoutSubject(subject: string): boolean {
  return /^checkout: moving from /.test(subject);
}

function toEntry(parsed: ParsedLine, repoPath: string, isSeed = false): RawReflogEntry {
  return {
    hash: parsed.hash,
    subject: parsed.subject,
    timestamp: parsed.timestamp,
    repoPath,
    ...(isSeed ? { isSeed: true } : {}),
  };
}

/**
 * Walks the reflog (which `git log -g` returns newest-first) and emits:
 *   - every entry whose timestamp falls within the requested date, and
 *   - one seed entry: the most recent `checkout: moving from …` *before* the
 *     window, used by `annotateCommitBranches` to know what branch HEAD was
 *     on when the day began. Without it, commits made before any in-window
 *     checkout (very common — e.g. WIP after a rebase the day before) can't
 *     be attributed to a branch and their detail column loses the suffix.
 *
 * The seed is *only* a `checkout: moving from …` line — pull/rebase/merge
 * subjects are skipped so we land on something that genuinely sets the
 * tracked branch. CHECKOUT_DETACHED is included intentionally: if the user
 * was on detached HEAD entering the day, we want to clear branch state, not
 * inherit a stale one.
 */
export function parseReflogOutput(
  raw: string,
  repoPath: string,
  date?: string,
  authorEmail?: string,
): RawReflogEntry[] {
  const entries: RawReflogEntry[] = [];
  let enteredWindow = !date;

  for (const line of raw.split('\n')) {
    if (!line) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;

    const inWindow = !date || parsed.timestamp.startsWith(date);

    if (inWindow) {
      enteredWindow = true;
      if (!matchesAuthor(parsed, authorEmail)) continue;
      entries.push(toEntry(parsed, repoPath));
      continue;
    }

    // Out of window. While we haven't reached the window yet (entries newer
    // than the requested date), keep walking. Once we've passed through the
    // window, the next checkout we find is our seed.
    if (!enteredWindow) continue;
    if (isCheckoutSubject(parsed.subject)) {
      entries.push(toEntry(parsed, repoPath, true));
      break;
    }
  }

  return entries;
}
