import { eachDay, isSingleDay, localDay, rangeDayCount, type DateRange } from './config';
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
const TIME_WIDTH = 8;
const REPO_WIDTH = 28;
const TYPE_WIDTH = 19;

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

/**
 * Footer for the whole output. The active-day tally is only meaningful once the
 * window spans more than one day, so a single date reads exactly as before.
 */
export function summarizeRange(entries: TimelineEntry[], range: DateRange): string {
  const base = summarize(entries.length, countRepos(entries));
  if (isSingleDay(range)) return base;
  const active = new Set(entries.map((e) => localDay(e.timestamp))).size;
  return `${base}, ${active} active day${active !== 1 ? 's' : ''} of ${rangeDayCount(range)}`;
}

export function rangeTitle(range: DateRange): string {
  return isSingleDay(range) ? range.from : `${range.from} .. ${range.to}`;
}

function weekday(day: string): string {
  // Noon UTC + an explicit UTC timeZone keeps the weekday correct on every
  // machine offset; a bare `new Date(day)` would drift a day west of UTC.
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  });
}

export interface DayGroup {
  date: string;
  entries: TimelineEntry[];
}

/**
 * Buckets entries into ascending days, including every day of `range` even when
 * it holds no events — an empty Tuesday is information in a timesheet. Days
 * outside the range are still emitted if an entry lands there (possible when
 * the repo's git offset differs from the machine's), so nothing is silently lost.
 */
export function groupByDay(entries: TimelineEntry[], range: DateRange): DayGroup[] {
  const buckets = new Map<string, TimelineEntry[]>();
  for (const day of eachDay(range)) buckets.set(day, []);
  for (const entry of entries) {
    const day = localDay(entry.timestamp);
    const bucket = buckets.get(day);
    if (bucket) bucket.push(entry);
    else buckets.set(day, [entry]);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, dayEntries]) => ({ date, entries: dayEntries }));
}

/**
 * Whether the output needs per-day headings and per-day footers. Driven by the
 * grouped data rather than by `isSingleDay(range)`, so a `--date` run that
 * happens to hold an entry from a neighbouring day still labels both days
 * instead of silently mixing them under one date.
 */
function perDaySections(groups: DayGroup[]): boolean {
  return groups.length > 1;
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

export const COLUMNS = ['Time', 'Repository', 'Type', 'Detail'] as const;

/** `2026-04-20 Mon` — the same day label in every human-readable format. */
export function dayHeading(day: string): string {
  return `${day} ${weekday(day)}`;
}

export const EMPTY_NOTICE = 'No events.';

export interface TimelineRow {
  type: EventType;
  time: string;
  repo: string;
  label: string;
  detail: string;
}

export interface TimelineSection {
  /** Absent when the document covers a single day, matching the CLI layout. */
  heading?: string;
  rows: TimelineRow[];
  /** Per-day footer; absent for the same reason as `heading`. */
  summary?: string;
}

/**
 * The structure every human-readable format renders. `formatTable` and
 * `formatMarkdown` are both pure renderers of this outline, so the two cannot
 * drift in wording, sectioning or ordering — only in syntax (box-drawing rules
 * and ANSI vs. headings and pipe tables).
 */
export interface TimelineDocument {
  title: string;
  columns: readonly string[];
  sections: TimelineSection[];
  emptyNotice: string;
  total: string;
}

export function buildDocument(entries: TimelineEntry[], range: DateRange): TimelineDocument {
  const groups = groupByDay(entries, range);
  const sectioned = perDaySections(groups);

  return {
    title: `Git Time Tracker — ${rangeTitle(range)}`,
    columns: COLUMNS,
    emptyNotice: EMPTY_NOTICE,
    total: summarizeRange(entries, range),
    sections: groups.map((group) => ({
      ...(sectioned ? { heading: dayHeading(group.date) } : {}),
      rows: group.entries.map((entry) => ({
        type: entry.type,
        time: formatTime(entry.timestamp),
        repo: entry.repoName,
        label: EVENT_LABEL[entry.type] ?? entry.type,
        detail: formatDetail(entry),
      })),
      ...(sectioned && group.entries.length > 0
        ? { summary: summarize(group.entries.length, countRepos(group.entries)) }
        : {}),
    })),
  };
}

/**
 * The fixed-width rendering of a document, from the `═══` rule down to the
 * total — everything except the title line. Shared so `markdown` can embed the
 * exact CLI layout instead of re-describing it in another syntax.
 */
function tableBodyLines(doc: TimelineDocument, useColor: boolean): string[] {
  const col = (text: string, code: string) =>
    useColor ? `${code}${text}${RESET}` : text;

  const [timeCol, repoCol, typeCol, detailCol] = doc.columns;
  const lines: string[] = [];
  lines.push('═'.repeat(TABLE_WIDTH));
  lines.push(
    ` ${pad(timeCol.toUpperCase(), TIME_WIDTH)} ${pad(repoCol.toUpperCase(), REPO_WIDTH)}` +
      ` ${pad(typeCol.toUpperCase(), TYPE_WIDTH)} ${detailCol.toUpperCase()}`,
  );
  lines.push('─'.repeat(TABLE_WIDTH));

  doc.sections.forEach((section, index) => {
    if (section.heading) {
      if (index > 0) lines.push('');
      const rule = `── ${section.heading} `;
      lines.push(col(rule + '─'.repeat(Math.max(0, TABLE_WIDTH - rule.length)), BOLD));
    }
    if (section.rows.length === 0) {
      lines.push(col(`  ${doc.emptyNotice}`, DIM));
      return;
    }
    for (const row of section.rows) {
      const label = col(pad(row.label, TYPE_WIDTH), EVENT_COLOR[row.type] ?? '');
      lines.push(` ${row.time}   ${pad(row.repo, REPO_WIDTH)} ${label} ${row.detail}`);
    }
    if (section.summary) lines.push(col(` ${section.summary}`, DIM));
  });

  lines.push('─'.repeat(TABLE_WIDTH));
  lines.push(col(` ${doc.total}`, DIM));

  return lines;
}

export function formatTable(
  entries: TimelineEntry[],
  range: DateRange,
  useColor = true,
): string {
  const doc = buildDocument(entries, range);
  const title = useColor ? `${BOLD}${doc.title}${RESET}` : doc.title;
  return [title, ...tableBodyLines(doc, useColor)].join('\n');
}

export function formatJson(entries: TimelineEntry[]): string {
  return JSON.stringify(
    entries.map((e) => ({ ...e, timestamp: e.timestamp.toISOString() })),
    null,
    2,
  );
}

export function formatCsv(entries: TimelineEntry[]): string {
  // `date` duplicates part of `time`, but having it as its own column is what
  // makes a multi-day export pivot per day in a spreadsheet.
  const header = 'date,time,repository,type,detail,hash';
  const rows = entries.map((e) => {
    const detail = formatDetail(e).replace(/,/g, ';');
    return `${localDay(e.timestamp)},${e.timestamp.toISOString()},${e.repoName},${e.type},${detail},${e.hash}`;
  });
  return [header, ...rows].join('\n');
}

/**
 * A fence long enough to survive the content: a commit message containing
 * ``` would otherwise close the block early. CommonMark allows any run of three
 * or more backticks, as long as the closing run is at least as long as the opening one.
 */
function fenceFor(content: string): string {
  const longestRun = Math.max(0, ...[...content.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(Math.max(3, longestRun + 1));
}

/**
 * The CLI layout verbatim, wrapped in a fenced block so it renders monospace and
 * keeps its column alignment. Only the title is lifted out into a `#` heading —
 * a GFM table would reflow the columns and lose the day rules.
 */
export function formatMarkdown(entries: TimelineEntry[], range: DateRange): string {
  const doc = buildDocument(entries, range);
  const body = tableBodyLines(doc, false).join('\n');
  const fence = fenceFor(body);
  return [`# ${doc.title}`, '', `${fence}text`, body, fence].join('\n');
}
