import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

interface TrackerEvent {
  type: string;
  timestamp: string;
  repoName: string;
  message?: string;
  toBranch?: string;
  branch?: string;
}

export interface LocalEvent {
  at: Date;
  repo: string;
  type: string;
  detail: string;
  ticket: string;
  ticketSource: 'commit' | 'branch' | 'none' | 'wip';
  isCommit: boolean;
  branch: string;
  followUp?: LocalEvent;
}

export interface Entry {
  date: string;
  start: string;
  sst: string;
  original: string;
  cs: string;
  hours: number;
}

export interface DayHours {
  start: string;
  lunch: { start: string; minutes: number };
}

export interface Config {
  dayBoundary?: string;
  default?: DayHours;
  days?: Partial<Record<Weekday, Partial<DayHours>>>;
}

type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface Interval {
  from: Date;
  to: Date;
}

interface Piece extends Interval {
  ticket: string;
  meeting: boolean;
  commits: LocalEvent[];
}

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const TRACKER_BIN = path.join(REPO_ROOT, 'dist/index.js');
const CONFIG_DIR =
  process.platform === 'win32'
    ? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'git-time-tracker')
    : path.join(os.homedir(), '.config', 'git-time-tracker');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const TICKET = /SST-\d+/;
const WIP = /\bWIP\b/i;
const QUARTER_MS = 15 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const MAX_BLOCK_HOURS = 4;
const LONG_GAP_MINUTES = 120;
const SQUASH_WINDOW_MS = 2 * 60 * 1000;
const MEETING_ORIGINAL = 'Meeting';
const DEFAULT_DAY_BOUNDARY = '05:00';
const DAY_MS = 24 * 60 * MINUTE_MS;
const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    args.set(argv[i].replace(/^--/, ''), argv[i + 1]);
  }
  return args;
}

function requireArg(args: Map<string, string>, name: string): string {
  const value = args.get(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function at(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, min);
}

function nextDate(date: string): string {
  const d = at(date, '00:00');
  return localDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
}

export function workDate(d: Date, boundary: string): string {
  const day = localDate(d);
  return localTime(d) < boundary ? localDate(new Date(at(day, '00:00').getTime() - DAY_MS / 2)) : day;
}

export function onWorkDay(date: string, time: string, boundary: string): Date {
  return time < boundary ? at(nextDate(date), time) : at(date, time);
}

function clock(d: Date, date: string): string {
  return localDate(d) === date ? localTime(d) : `${localTime(d)} (${localDate(d)})`;
}

function roundQuarter(d: Date): Date {
  return new Date(Math.round(d.getTime() / QUARTER_MS) * QUARTER_MS);
}

function minutes(i: Interval): number {
  return (i.to.getTime() - i.from.getTime()) / MINUTE_MS;
}

function overlapMinutes(a: Interval, b: Interval): number {
  const from = Math.max(a.from.getTime(), b.from.getTime());
  const to = Math.min(a.to.getTime(), b.to.getTime());
  return Math.max(0, to - from) / MINUTE_MS;
}

export function subtract(span: Interval, holes: Interval[]): Interval[] {
  return holes
    .filter((h) => overlapMinutes(span, h) > 0)
    .sort((a, b) => a.from.getTime() - b.from.getTime())
    .reduce<Interval[]>(
      (parts, hole) => {
        const last = parts.at(-1)!;
        const before = { from: last.from, to: new Date(Math.min(last.to.getTime(), hole.from.getTime())) };
        const after = {
          from: new Date(Math.min(Math.max(last.from.getTime(), hole.to.getTime()), last.to.getTime())),
          to: last.to,
        };
        return [...parts.slice(0, -1), before, after].filter((p) => minutes(p) > 0 || p.to === span.to);
      },
      [span],
    );
}

function readTrackerConfig(): Record<string, unknown> {
  if (!existsSync(CONFIG_FILE)) throw new Error(`${CONFIG_FILE} missing - run git-time-tracker --init first`);
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
}

function readConfig(): Config {
  const worklog = readTrackerConfig().worklog as Config | undefined;
  if (!worklog) {
    console.error(
      `config missing: no worklog section in ${CONFIG_FILE}\n` +
        'ask the user for their usual start time and lunch, then add them to that file:\n' +
        '"worklog": { "default": { "start": "08:00", "lunch": { "start": "12:00", "minutes": 30 } } }\n' +
        'or save them with: npm run worklog -- config --start 08:00 --lunch 12:00 --lunch-minutes 30',
    );
    process.exit(3);
  }
  return worklog;
}

export function dayOverride(args: Map<string, string>, config: Config, day: Weekday): Partial<DayHours> {
  const start = args.get('start');
  const lunchStart = args.get('lunch');
  const lunchMinutes = args.get('lunch-minutes');
  if (!start && !lunchStart && !lunchMinutes) throw new Error('--day needs --start, --lunch or --lunch-minutes');
  const base = config.default;
  const current = { ...base, ...config.days?.[day] };
  const lunchStartTime = lunchStart ?? current.lunch?.start;
  if ((lunchStart || lunchMinutes) && !lunchStartTime) throw new Error(`--day ${day} has no lunch start yet, add --lunch`);
  const lunch = lunchStartTime
    ? { start: lunchStartTime, minutes: Number(lunchMinutes ?? current.lunch?.minutes ?? 0) }
    : undefined;
  const merged = { start: start ?? current.start, lunch };
  const sameLunch = base && lunch?.start === base.lunch.start && lunch.minutes === base.lunch.minutes;
  return {
    ...(merged.start && merged.start !== base?.start ? { start: merged.start } : {}),
    ...(lunch && !sameLunch ? { lunch: lunch as DayHours['lunch'] } : {}),
  };
}

function configCommand(args: Map<string, string>): void {
  const day = args.get('day') as Weekday | undefined;
  if (day && !WEEKDAYS.includes(day)) throw new Error(`--day must be one of ${WEEKDAYS.join(', ')}`);
  const tracker = readTrackerConfig();
  const existing = tracker.worklog as Config | undefined;
  const boundary = args.get('day-boundary');
  const setsHours = ['start', 'lunch', 'lunch-minutes'].some((name) => args.has(name));
  if (!day && !setsHours && !boundary) throw new Error('nothing to set');
  const withBoundary: Config = { ...existing, ...(boundary ? { dayBoundary: boundary } : {}) };
  const worklog: Config = day
    ? { ...withBoundary, days: { ...existing?.days, [day]: dayOverride(args, existing ?? {}, day) } }
    : setsHours
      ? {
          ...withBoundary,
          default: {
            start: requireArg(args, 'start'),
            lunch: { start: requireArg(args, 'lunch'), minutes: Number(requireArg(args, 'lunch-minutes')) },
          },
        }
      : withBoundary;
  writeFileSync(CONFIG_FILE, `${JSON.stringify({ ...tracker, worklog }, null, 2)}\n`);
  console.log(`${CONFIG_FILE}\n${JSON.stringify(worklog)}`);
}

function readTracker(from: string, to: string): TrackerEvent[] {
  if (!existsSync(TRACKER_BIN)) throw new Error(`${TRACKER_BIN} missing - run npm run build in ${REPO_ROOT}`);
  const json = execFileSync('node', [TRACKER_BIN, '--from', from, '--to', to, '--format', 'json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(json);
}

export function toLocalEvent(event: TrackerEvent): LocalEvent {
  const isCommit = event.type.startsWith('COMMIT');
  const branch = event.branch ?? event.toBranch ?? '';
  const fromCommit = isCommit ? event.message?.match(TICKET)?.[0] : undefined;
  const fromBranch = branch.match(TICKET)?.[0];
  const ticket = fromCommit ?? fromBranch ?? 'n/a';
  const ticketSource = fromCommit ? 'commit' : fromBranch ? 'branch' : 'none';
  return {
    at: new Date(event.timestamp),
    repo: event.repoName,
    type: event.type,
    detail: event.message ?? event.toBranch ?? '',
    ticket,
    ticketSource,
    isCommit,
    branch,
  };
}

function isTemporary(e: LocalEvent): boolean {
  return /^TMP\b/i.test(e.detail);
}

function isReplay(e: LocalEvent, earlier: LocalEvent[]): boolean {
  return (
    e.type === 'COMMIT' &&
    !/^(fixup|amend|squash)!/.test(e.detail) &&
    !WIP.test(e.detail) &&
    earlier.some((o) => o.repo === e.repo && o.detail === e.detail)
  );
}

function isAmendBurst(e: LocalEvent, all: LocalEvent[]): boolean {
  return (
    e.type === 'COMMIT_AMEND' &&
    all.some(
      (o) =>
        o !== e &&
        o.repo === e.repo &&
        o.type === 'COMMIT_AMEND' &&
        Math.abs(o.at.getTime() - e.at.getTime()) <= SQUASH_WINDOW_MS,
    )
  );
}

export function splitSquash(commits: LocalEvent[]): { work: LocalEvent[]; squash: LocalEvent[] } {
  const sorted = [...commits].sort((a, b) => a.at.getTime() - b.at.getTime());
  const squash = sorted.filter(
    (e, i) => isTemporary(e) || isReplay(e, sorted.slice(0, i)) || isAmendBurst(e, sorted),
  );
  return { work: sorted.filter((e) => !squash.includes(e)), squash };
}

function parseDated(value: string | undefined): Map<string, string[]> {
  return (value ?? '')
    .split(',')
    .filter(Boolean)
    .reduce((acc, item) => {
      const [date, rest] = item.trim().split('=');
      return acc.set(date, [...(acc.get(date) ?? []), rest]);
    }, new Map<string, string[]>());
}

function byWorkDate(events: LocalEvent[], boundary: string): Map<string, LocalEvent[]> {
  return events.reduce((acc, e) => {
    const date = workDate(e.at, boundary);
    return acc.set(date, [...(acc.get(date) ?? []), e]);
  }, new Map<string, LocalEvent[]>());
}

export function parseRanges(date: string, ranges: string[], boundary: string): Interval[] {
  return ranges.map((range) => {
    const [start, end] = range.split('-');
    const from = onWorkDay(date, start, boundary);
    const to = onWorkDay(date, end, boundary);
    return { from, to: to < from ? new Date(to.getTime() + DAY_MS) : to };
  });
}

function carryWip(commits: LocalEvent[], wip: LocalEvent | undefined): LocalEvent[] {
  if (!wip) return commits;
  const firstDone = commits.findIndex((c) => !WIP.test(c.detail));
  return commits.map((c, i) =>
    i <= firstDone && c.ticket === 'n/a' ? { ...c, ticket: wip.ticket, ticketSource: 'wip' } : c,
  );
}

export function linkWipFollowUps(work: LocalEvent[]): LocalEvent[] {
  return work.map((e, i) => {
    if (!WIP.test(e.detail)) return e;
    const followUp = work
      .slice(i + 1)
      .find((o) => o.repo === e.repo && o.branch === e.branch && !WIP.test(o.detail));
    return followUp ? { ...e, followUp, ticket: followUp.ticket, ticketSource: followUp.ticketSource } : e;
  });
}

function mergePieces(pieces: Piece[]): Piece[] {
  return [...pieces]
    .sort((a, b) => a.from.getTime() - b.from.getTime())
    .reduce<Piece[]>((merged, piece) => {
      const prev = merged.at(-1);
      const joins =
        prev && !prev.meeting && !piece.meeting && prev.ticket === piece.ticket &&
        prev.to.getTime() === piece.from.getTime();
      return joins
        ? [...merged.slice(0, -1), { ...prev, to: piece.to, commits: [...prev.commits, ...piece.commits] }]
        : [...merged, piece];
    }, []);
}

function blockHours(piece: Piece, lunch: Interval): { start: Date; hours: number } {
  const span = { from: roundQuarter(piece.from), to: roundQuarter(piece.to) };
  return { start: span.from, hours: (minutes(span) - overlapMinutes(span, lunch)) / 60 };
}

function describeBlock(piece: Piece, lunch: Interval, date: string): string {
  const { start, hours } = blockHours(piece, lunch);
  const label = piece.meeting ? 'n/a meeting' : `${piece.ticket} | ${piece.commits.length} commits`;
  const action = hours > MAX_BLOCK_HOURS ? ' | SPLIT' : hours === 0 ? ' | FOLD' : '';
  const header = `block ${clock(start, date)} | ${hours} h | ${label}${action}`;
  const lines = piece.commits.map(
    (e) => {
      const follow = e.followUp ? ` => ${localDate(e.followUp.at)} ${localTime(e.followUp.at)} ${e.followUp.detail}` : '';
      return `  ${clock(e.at, date)} ${e.repo} ${e.type} ${e.ticket}(${e.ticketSource}) ${e.detail}${follow}`;
    },
  );
  return [header, ...lines].join('\n');
}

export function hoursFor(config: Config, date: string, lunchOverride: string | undefined): DayHours {
  const day = WEEKDAYS[at(date, '00:00').getDay()];
  const weekday = config.days?.[day];
  const lunch = lunchOverride
    ? { start: lunchOverride.split('/')[0], minutes: Number(lunchOverride.split('/')[1]) }
    : (weekday?.lunch ?? config.default?.lunch);
  const start = weekday?.start ?? config.default?.start;
  if (!start || !lunch) throw new Error(`no hours for ${day}: add worklog.default or worklog.days.${day} in ${CONFIG_FILE}`);
  return { start, lunch };
}

export function planDay(
  date: string,
  commits: LocalEvent[],
  config: DayHours,
  startOverride: string | undefined,
  meetings: Interval[],
  breaks: Interval[],
  wip: LocalEvent | undefined,
): string {
  const lunchFrom = at(date, config.lunch.start);
  const lunch = { from: lunchFrom, to: new Date(lunchFrom.getTime() + config.lunch.minutes * MINUTE_MS) };
  const configured = at(date, startOverride ?? config.start);
  const first = commits[0].at;
  const early = !startOverride && first < configured;
  const dayStart = first < configured ? first : configured;
  const asks: string[] = [];
  if (early) {
    asks.push(
      `ASK start: first commit ${localTime(first)} is before ${config.start} - ask when work started, ` +
        `rerun with --starts ${date}=HH:MM`,
    );
  }
  commits
    .filter((c) => breaks.some((b) => c.at > b.from && c.at < b.to))
    .forEach((c) =>
      asks.push(
        `ASK break: commit ${clock(c.at, date)} ${c.repo} ${c.detail} falls inside a break - ` +
          'ask for the correct break range and rerun',
      ),
    );
  const labelled = carryWip(commits, wip);
  labelled
    .filter((c) => WIP.test(c.detail) && !c.followUp)
    .forEach((c) =>
      asks.push(
        `ASK wip: ${localTime(c.at)} ${c.repo} ${c.branch} has no later non-WIP commit on its branch - ask what it was`,
      ),
    );
  const pieces = labelled.flatMap((commit, i) => {
    const stretch = { from: i === 0 ? dayStart : labelled[i - 1].at, to: commit.at };
    const holes = [...meetings, ...breaks];
    const parts = subtract(stretch, holes);
    const workMinutes = parts.reduce((sum, p) => sum + minutes(p) - overlapMinutes(p, lunch), 0);
    const answered = holes.some((m) => overlapMinutes(stretch, m) > 0);
    if (!answered && workMinutes > LONG_GAP_MINUTES) {
      asks.push(
        `ASK gap: ${clock(stretch.from, date)}-${clock(stretch.to, date)} has ${Math.round(workMinutes)} min ` +
          `without commits before ${commit.ticket} - ask whether it was a meeting or a break and when, ` +
          `rerun with --meetings ${date}=HH:MM-HH:MM or --breaks ${date}=HH:MM-HH:MM`,
      );
    }
    return parts.map((p, j) => ({
      ...p,
      ticket: commit.ticket,
      meeting: false,
      commits: j === parts.length - 1 ? [commit] : [],
    }));
  });
  const meetingPieces = meetings.map((m) => ({ ...m, ticket: 'n/a', meeting: true, commits: [] }));
  const blocks = mergePieces([...pieces, ...meetingPieces]).map((p) => describeBlock(p, lunch, date));
  const startNote = startOverride ? `${startOverride} (user)` : early ? `${localTime(first)} (first commit)` : `${config.start} (config)`;
  const wipNote = wip ? ` | continues WIP ${localDate(wip.at)} ${localTime(wip.at)} ${wip.ticket}: ${wip.detail}` : '';
  const header =
    `### ${date} | start ${startNote} | lunch ${localTime(lunch.from)}-${localTime(lunch.to)} | ` +
    `ends ${clock(commits.at(-1)!.at, date)}${wipNote}`;
  return [header, ...blocks, ...asks].join('\n');
}

function sessionsCommand(args: Map<string, string>): void {
  const config = readConfig();
  const from = requireArg(args, 'from');
  const to = args.get('to') ?? from;
  const starts = parseDated(args.get('starts'));
  const meetings = parseDated(args.get('meetings'));
  const breaks = parseDated(args.get('breaks'));
  const lunches = parseDated(args.get('lunches'));
  const boundary = config.dayBoundary ?? DEFAULT_DAY_BOUNDARY;
  const inRange = (e: LocalEvent) => workDate(e.at, boundary) >= from && workDate(e.at, boundary) <= to;
  const events = readTracker(from, localDate(new Date())).map(toLocalEvent).filter((e) => e.isCommit);
  const { work, squash } = splitSquash(events);
  const days = [...byWorkDate(linkWipFollowUps(work).filter(inRange), boundary)];
  const plans = days.map(([date, commits], i) => {
    const previousLast = days[i - 1]?.[1].at(-1);
    const wip = previousLast && WIP.test(previousLast.detail) ? previousLast : undefined;
    const hours = hoursFor(config, date, lunches.get(date)?.[0]);
    return planDay(
      date,
      commits,
      hours,
      starts.get(date)?.[0],
      parseRanges(date, meetings.get(date) ?? [], boundary),
      parseRanges(date, breaks.get(date) ?? [], boundary),
      wip,
    );
  });
  const excluded = squash.filter(inRange).map((e) => `${localDate(e.at)} ${localTime(e.at)} ${e.repo} ${e.type} ${e.detail}`);
  console.log([`day boundary ${boundary}`, ...plans, `### excluded as squash/replay (${excluded.length})`, ...excluded].join('\n\n'));
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function isMeeting(e: Entry): boolean {
  return e.sst === 'n/a' && e.original.trim() === MEETING_ORIGINAL;
}

export function validate(entries: Entry[]): string[] {
  const problems = entries.flatMap((e, i) => {
    const where = `${e.date} ${e.start} ${e.sst}`;
    const start = toMinutes(e.start);
    const own = [
      e.hours > MAX_BLOCK_HOURS ? `${where}: ${e.hours} h exceeds ${MAX_BLOCK_HOURS} h` : '',
      e.hours <= 0 || (e.hours * 4) % 1 !== 0 ? `${where}: duration must be a positive multiple of 0.25` : '',
      start % 15 !== 0 ? `${where}: start must be on a quarter hour` : '',
      !e.original.trim() || !e.cs.trim() ? `${where}: needs both original and cs descriptions` : '',
    ];
    const previous = entries[i - 1];
    const overlaps =
      previous && at(previous.date, previous.start).getTime() + previous.hours * 60 * MINUTE_MS > at(e.date, e.start).getTime();
    const unordered =
      previous && (previous.date > e.date || (previous.date === e.date && previous.start > e.start));
    const repeats =
      !isMeeting(e) &&
      entries.slice(0, i).some((other) => other.cs.trim() === e.cs.trim());
    return [
      ...own,
      repeats ? `${where}: description repeats an earlier entry` : '',
      overlaps ? `${where}: overlaps previous entry` : '',
      unordered ? `${where}: entries not sorted by date and start` : '',
    ];
  });
  return problems.filter(Boolean);
}

export function splitAtMidnight(e: Entry): Entry[] {
  const firstHours = (24 * 60 - toMinutes(e.start)) / 60;
  if (e.hours <= firstHours) return [e];
  return [
    { ...e, hours: firstHours, cs: `${e.cs} (část 1)` },
    { ...e, date: nextDate(e.date), start: '00:00', hours: e.hours - firstHours, cs: `${e.cs} (část 2)` },
  ];
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
}

function renderMarkdown(from: string, to: string, entries: Entry[], total: number): string {
  const rows = entries.map(
    (e) => `| ${e.date} | ${e.start} | ${e.sst} | ${cell(e.original)}<br><br>${cell(e.cs)} | ${e.hours} |`,
  );
  return [
    `# Worklog ${from} - ${to}`,
    '',
    '| date | time start | sst-id | description | duration (h) |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `Total: ${total} h`,
    '',
  ].join('\n');
}

function renderCommand(args: Map<string, string>): void {
  const from = requireArg(args, 'from');
  const to = args.get('to') ?? from;
  const entries: Entry[] = JSON.parse(readFileSync(requireArg(args, 'entries'), 'utf8'));
  const problems = validate(entries);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  const rows = entries.flatMap(splitAtMidnight);
  const total = rows.reduce((sum, e) => sum + e.hours, 0);
  const reports = path.join(REPO_ROOT, 'reports');
  mkdirSync(reports, { recursive: true });
  const name = from === to ? `worklog-${from}.md` : `worklog-${from}_${to}.md`;
  const file = path.join(reports, name);
  writeFileSync(file, renderMarkdown(from, to, rows, total));
  console.log(`${file}\n${rows.length} rows, total ${total} h`);
}

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  const commands: Record<string, (args: Map<string, string>) => void> = {
    config: configCommand,
    sessions: sessionsCommand,
    render: renderCommand,
  };
  const run = commands[command];
  if (!run) {
    console.error(
      'usage: worklog.mts config [--day mon..sun] [--start HH:MM] [--lunch HH:MM] [--lunch-minutes N] [--day-boundary HH:MM]\n' +
        '       worklog.mts sessions --from D [--to D] [--starts D=HH:MM,...] [--lunches D=HH:MM/N,...] [--meetings D=HH:MM-HH:MM,...] [--breaks D=HH:MM-HH:MM,...]\n' +
        '       worklog.mts render --from D [--to D] --entries file.json',
    );
    process.exit(2);
  }
  run(parseArgs(rest));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
