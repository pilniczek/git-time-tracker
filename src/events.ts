import * as path from 'node:path';

/**
 * Converts git's %gd timestamp format to strict ISO 8601 so that
 * new Date() parses it correctly across all runtimes.
 * Input:  "2026-04-07 14:58:32 +0200"
 * Output: "2026-04-07T14:58:32+02:00"
 */
export function normalizeTimestamp(ts: string): string {
  return ts.replace(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/,
    '$1T$2$3:$4',
  );
}

export type EventType =
  | 'COMMIT'
  | 'COMMIT_AMEND'
  | 'COMMIT_INITIAL'
  | 'COMMIT_MERGE'
  | 'CHECKOUT'
  | 'CHECKOUT_DETACHED'
  | 'MERGE'
  | 'REBASE';

export const COMMIT_TYPES: ReadonlySet<EventType> = new Set([
  'COMMIT',
  'COMMIT_AMEND',
  'COMMIT_INITIAL',
  'COMMIT_MERGE',
]);

export function isCommitType(type: EventType): boolean {
  return COMMIT_TYPES.has(type);
}

export interface NormalizedEvent {
  type: EventType;
  timestamp: Date;
  repoName: string;
  repoPath: string;
  hash: string;
  message?: string;
  toBranch?: string;
  sourceBranch?: string;
  branch?: string;
}

export interface RawReflogEntry {
  hash: string;
  subject: string;
  timestamp: string;
  repoPath: string;
}

interface Pattern {
  regex: RegExp;
  type: EventType;
  extract: (match: RegExpMatchArray) => Partial<NormalizedEvent>;
}

const PATTERNS: Pattern[] = [
  {
    regex: /^commit \(amend\): (.+)$/,
    type: 'COMMIT_AMEND',
    extract: (m) => ({ message: m[1] }),
  },
  {
    regex: /^commit \(initial\): (.+)$/,
    type: 'COMMIT_INITIAL',
    extract: (m) => ({ message: m[1] }),
  },
  {
    regex: /^commit \(merge\): (.+)$/,
    type: 'COMMIT_MERGE',
    extract: (m) => ({ message: m[1] }),
  },
  {
    regex: /^commit: (.+)$/,
    type: 'COMMIT',
    extract: (m) => ({ message: m[1] }),
  },
  {
    // Detached HEAD: target is a raw commit SHA, not a branch name.
    regex: /^checkout: moving from (.+) to ([0-9a-f]{40})$/,
    type: 'CHECKOUT_DETACHED',
    extract: (m) => ({ toBranch: m[2] }),
  },
  {
    regex: /^checkout: moving from (.+) to (.+)$/,
    type: 'CHECKOUT',
    extract: (m) => ({ toBranch: m[2] }),
  },
  {
    regex: /^merge (.+?): (.+)$/i,
    type: 'MERGE',
    extract: (m) => ({ sourceBranch: m[1], message: m[2] }),
  },
  {
    regex: /^rebase -i \(finish\): returning to refs\/heads\/(.+)$/,
    type: 'REBASE',
    extract: (m) => ({ branch: m[1] }),
  },
];

export function parseEvent(entry: RawReflogEntry): NormalizedEvent | null {
  for (const { regex, type, extract } of PATTERNS) {
    const match = entry.subject.match(regex);
    if (match) {
      return {
        type,
        timestamp: new Date(normalizeTimestamp(entry.timestamp)),
        repoName: path.basename(entry.repoPath),
        repoPath: entry.repoPath,
        hash: entry.hash,
        ...extract(match),
      };
    }
  }
  return null;
}

export function parseEvents(entries: RawReflogEntry[]): NormalizedEvent[] {
  return entries
    .map(parseEvent)
    .filter((e): e is NormalizedEvent => e !== null);
}
