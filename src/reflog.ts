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

function matchesFilters(
  parsed: ParsedLine,
  date: string | undefined,
  authorEmail: string | undefined,
): boolean {
  if (date && !parsed.timestamp.startsWith(date)) return false;

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

export function parseReflogOutput(
  raw: string,
  repoPath: string,
  date?: string,
  authorEmail?: string,
): RawReflogEntry[] {
  const entries: RawReflogEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    if (!matchesFilters(parsed, date, authorEmail)) continue;
    entries.push({
      hash: parsed.hash,
      subject: parsed.subject,
      timestamp: parsed.timestamp,
      repoPath,
    });
  }
  return entries;
}
