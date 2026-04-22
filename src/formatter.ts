import { isCommitType, type EventType } from './events';
import { isWipMessage, type TimelineEntry } from './timeline';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const BLUE = '\x1b[34m';

const EVENT_COLOR: Record<EventType, string> = {
  COMMIT: GREEN,
  COMMIT_AMEND: YELLOW,
  COMMIT_INITIAL: GREEN,
  COMMIT_MERGE: MAGENTA,
  CHECKOUT: CYAN,
  CHECKOUT_DETACHED: CYAN,
  MERGE: MAGENTA,
  REBASE: BLUE,
};

export const EVENT_LABEL: Record<EventType, string> = {
  COMMIT: 'COMMIT',
  COMMIT_AMEND: 'COMMIT (amend)',
  COMMIT_INITIAL: 'COMMIT (initial)',
  COMMIT_MERGE: 'COMMIT (merge)',
  CHECKOUT: 'CHECKOUT',
  CHECKOUT_DETACHED: 'CHECKOUT (detached)',
  MERGE: 'MERGE',
  REBASE: 'REBASE',
};

const SHORT_HASH_LEN = 7;
const TABLE_WIDTH = 87;

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s.padEnd(len);
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function countRepos(entries: TimelineEntry[]): number {
  return new Set(entries.map((e) => e.repoPath)).size;
}

export function summarize(eventCount: number, repoCount: number): string {
  return `${eventCount} event${eventCount !== 1 ? 's' : ''} across ${repoCount} repositor${repoCount !== 1 ? 'ies' : 'y'}`;
}

export function formatDetail(entry: TimelineEntry): string {
  if (isCommitType(entry.type)) {
    const msg = entry.message ?? '';
    if (isWipMessage(msg) && entry.branch) return `${msg} (${entry.branch})`;
    return msg;
  }
  switch (entry.type) {
    case 'CHECKOUT':
      return entry.toBranch ?? '';
    case 'CHECKOUT_DETACHED':
      return entry.toBranch ? entry.toBranch.slice(0, SHORT_HASH_LEN) : '';
    case 'MERGE':
      return `${entry.sourceBranch}: ${entry.message ?? ''}`;
    case 'REBASE':
      return entry.branch ?? '';
  }
  return '';
}

export function formatTable(
  entries: TimelineEntry[],
  date: string,
  useColor = true,
): string {
  const col = (text: string, code: string) =>
    useColor ? `${code}${text}${RESET}` : text;

  const lines: string[] = [];
  lines.push(col(`Git Time Tracker — ${date}`, BOLD));
  lines.push('═'.repeat(TABLE_WIDTH));
  lines.push(` ${pad('TIME', 8)} ${pad('REPOSITORY', 28)} ${pad('TYPE', 19)} DETAIL`);
  lines.push('─'.repeat(TABLE_WIDTH));

  if (entries.length === 0) {
    lines.push(col(`  No events found for ${date}.`, DIM));
  } else {
    for (const entry of entries) {
      const time = formatTime(entry.timestamp);
      const repo = pad(entry.repoName, 28);
      const label = pad(EVENT_LABEL[entry.type] ?? entry.type, 19);
      const detail = formatDetail(entry);
      const coloredLabel = col(label, EVENT_COLOR[entry.type] ?? '');
      lines.push(` ${time}   ${repo} ${coloredLabel} ${detail}`);
    }
  }

  lines.push('─'.repeat(TABLE_WIDTH));
  lines.push(col(` ${summarize(entries.length, countRepos(entries))}`, DIM));

  return lines.join('\n');
}

export function formatJson(entries: TimelineEntry[]): string {
  return JSON.stringify(
    entries.map((e) => ({ ...e, timestamp: e.timestamp.toISOString() })),
    null,
    2,
  );
}

export function formatCsv(entries: TimelineEntry[]): string {
  const header = 'time,repository,type,detail,hash';
  const rows = entries.map((e) => {
    const detail = formatDetail(e).replace(/,/g, ';');
    return `${e.timestamp.toISOString()},${e.repoName},${e.type},${detail},${e.hash}`;
  });
  return [header, ...rows].join('\n');
}

export function formatMarkdown(entries: TimelineEntry[], date: string): string {
  const mdEscape = (s: string) => s.replace(/\|/g, '\\|');

  const lines: string[] = [];
  lines.push(`# Git Time Tracker — ${date}`);
  lines.push('');
  lines.push('| Time  | Repository | Type | Detail |');
  lines.push('|-------|------------|------|--------|');

  if (entries.length === 0) {
    lines.push(`| — | — | — | No events found for ${date}. |`);
  } else {
    for (const entry of entries) {
      const time = formatTime(entry.timestamp);
      const label = EVENT_LABEL[entry.type] ?? entry.type;
      const detail = mdEscape(formatDetail(entry));
      lines.push(`| ${time} | ${mdEscape(entry.repoName)} | ${label} | ${detail} |`);
    }
  }

  lines.push('');
  lines.push(`_${summarize(entries.length, countRepos(entries))}_`);

  return lines.join('\n');
}
