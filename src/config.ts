import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { configFilePath } from './platform';

export interface ConfigFile {
  roots: string[];
  repos?: string[];
  maxDepth?: number;
  port?: number;
}

/** Inclusive day window, both bounds in YYYY-MM-DD. */
export interface DateRange {
  from: string;
  to: string;
}

export interface Config {
  roots: string[];
  repos: string[];
  range: DateRange;
  authorEmail: string;
  maxDepth: number;
  port: number;
  configPath: string;
}

export interface CliArgs {
  date?: string;
  from?: string;
  to?: string;
  out?: string;
  dir?: string | string[];
  port?: number;
  ui?: boolean;
  discover?: boolean;
  init?: boolean;
  format?: string;
  color?: boolean;
  help?: boolean;
  _: string[];
}

/**
 * The calendar day a moment belongs to, in the machine's local timezone — the
 * same day the user sees on the clock. `toISOString()` would shift
 * late-evening events into the next day west of UTC.
 */
export function localDay(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getTodayDate(): string {
  return localDay(new Date());
}

export function dayRange(date: string): DateRange {
  return { from: date, to: date };
}

export function isSingleDay(range: DateRange): boolean {
  return range.from === range.to;
}

/** Number of calendar days in the window, inclusive of both bounds. */
export function rangeDayCount(range: DateRange): number {
  return eachDay(range).length;
}

/** Every day in the window, ascending. Used to render empty days in reports. */
export function eachDay(range: DateRange): string[] {
  const days: string[] = [];
  const cursor = new Date(`${range.from}T00:00:00Z`);
  const end = new Date(`${range.to}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * Rejects malformed dates *and* calendar-invalid ones (2026-02-30, 2026-13-01),
 * which Date silently rolls over instead of failing.
 */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Bad CLI input. Carries a message meant for the user, so `index.ts` prints it
 * plainly and exits instead of dumping a stack trace.
 */
export class CliArgsError extends Error {}

/** Bad --date/--from/--to input. */
export class DateArgsError extends CliArgsError {}

function requireValidDate(value: string, flag: string): string {
  if (!isValidDate(value)) {
    throw new DateArgsError(`${flag} must be a valid date in YYYY-MM-DD format (got "${value}").`);
  }
  return value;
}

/**
 * Resolves the day window from CLI flags:
 *   (nothing)            → today
 *   --date D             → D..D
 *   --from A --to B      → A..B
 *   --from A             → A..today  (open-ended "since")
 * `--to` without `--from` and `--date` mixed with either are rejected rather
 * than guessed at, since both readings would be defensible.
 */
export function resolveDateRange(args: CliArgs, today: string): DateRange {
  const { date, from, to } = args;

  if (date && (from || to)) {
    throw new DateArgsError('--date cannot be combined with --from/--to. Use --from/--to for a range.');
  }
  if (to && !from) {
    throw new DateArgsError('--to requires --from.');
  }
  if (from) {
    const start = requireValidDate(from, '--from');
    const end = to ? requireValidDate(to, '--to') : today;
    if (start > end) {
      throw new DateArgsError(`--from (${start}) is after --to (${end}).`);
    }
    return { from: start, to: end };
  }
  if (date) {
    return dayRange(requireValidDate(date, '--date'));
  }
  return dayRange(today);
}

export function getGitAuthorEmail(): string {
  const result = spawnSync('git', ['config', 'user.email'], { encoding: 'utf8' });
  if (result.status === 0 && result.stdout) {
    return result.stdout.trim();
  }
  return '';
}

export function readConfigFile(filePath: string): ConfigFile {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as ConfigFile;
  } catch {
    return { roots: [] };
  }
}

export function writeConfigFile(filePath: string, data: ConfigFile): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export function loadConfig(args: CliArgs): Config {
  const fileConfig = readConfigFile(configFilePath);

  const cliDirs = args.dir === undefined ? [] : [args.dir].flat();
  const fileRoots = fileConfig.roots ?? [];
  const roots = cliDirs.length > 0 ? [...fileRoots, ...cliDirs] : fileRoots;

  return {
    roots,
    repos: fileConfig.repos ?? [],
    range: resolveDateRange(args, getTodayDate()),
    authorEmail: getGitAuthorEmail(),
    maxDepth: fileConfig.maxDepth ?? 5,
    port: args.port ?? fileConfig.port ?? 3456,
    configPath: configFilePath,
  };
}

export function saveRepos(repos: string[], config: Config): void {
  const existing = readConfigFile(config.configPath);
  writeConfigFile(config.configPath, { ...existing, repos });
}
