import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DateArgsError,
  eachDay,
  getTodayDate,
  isValidDate,
  localDay,
  rangeDayCount,
  readConfigFile,
  resolveDateRange,
  writeConfigFile,
  type CliArgs,
} from '../src/config';

const TODAY = '2026-04-22';
const cli = (overrides: Partial<CliArgs> = {}): CliArgs => ({ _: [], ...overrides });

describe('getTodayDate', () => {
  it('returns a string in YYYY-MM-DD format', () => {
    expect(getTodayDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('matches today\'s date', () => {
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(getTodayDate()).toBe(expected);
  });
});

describe('localDay', () => {
  it('uses the local calendar day, so a late evening stays on its own date', () => {
    expect(localDay(new Date(2026, 3, 22, 23, 30))).toBe('2026-04-22');
  });

  it('is the single source getTodayDate builds on', () => {
    expect(getTodayDate()).toBe(localDay(new Date()));
  });
});

describe('isValidDate', () => {
  it('accepts real ISO dates', () => {
    expect(isValidDate('2026-04-22')).toBe(true);
    expect(isValidDate('2024-02-29')).toBe(true);
  });

  it('rejects malformed and calendar-invalid dates', () => {
    for (const bad of ['', '2026-4-2', '22-04-2026', '2026-02-30', '2026-13-01', 'today']) {
      expect(isValidDate(bad)).toBe(false);
    }
  });
});

describe('rangeDayCount / eachDay', () => {
  it('counts both bounds', () => {
    expect(rangeDayCount({ from: '2026-04-22', to: '2026-04-22' })).toBe(1);
    expect(rangeDayCount({ from: '2026-04-20', to: '2026-04-22' })).toBe(3);
  });

  it('counts exactly what eachDay enumerates', () => {
    const range = { from: '2026-04-29', to: '2026-05-02' };
    expect(rangeDayCount(range)).toBe(eachDay(range).length);
  });

  it('enumerates days across a month boundary', () => {
    expect(eachDay({ from: '2026-04-29', to: '2026-05-02' })).toEqual([
      '2026-04-29',
      '2026-04-30',
      '2026-05-01',
      '2026-05-02',
    ]);
  });

  it('spans a DST change without gaining or losing a day', () => {
    // Europe/Prague springs forward on 2026-03-29.
    expect(eachDay({ from: '2026-03-28', to: '2026-03-30' })).toEqual([
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
    ]);
  });
});

describe('resolveDateRange', () => {
  it('defaults to today', () => {
    expect(resolveDateRange(cli(), TODAY)).toEqual({ from: TODAY, to: TODAY });
  });

  it('turns --date into a single-day range', () => {
    expect(resolveDateRange(cli({ date: '2026-04-01' }), TODAY)).toEqual({
      from: '2026-04-01',
      to: '2026-04-01',
    });
  });

  it('uses --from and --to as given', () => {
    expect(resolveDateRange(cli({ from: '2026-04-01', to: '2026-04-21' }), TODAY)).toEqual({
      from: '2026-04-01',
      to: '2026-04-21',
    });
  });

  it('treats --from alone as "since that date"', () => {
    expect(resolveDateRange(cli({ from: '2026-04-01' }), TODAY)).toEqual({
      from: '2026-04-01',
      to: TODAY,
    });
  });

  it('accepts a range whose bounds are equal', () => {
    expect(resolveDateRange(cli({ from: TODAY, to: TODAY }), TODAY)).toEqual({
      from: TODAY,
      to: TODAY,
    });
  });

  it.each([
    ['--date with --from', { date: TODAY, from: '2026-04-01' }],
    ['--to without --from', { to: TODAY }],
    ['reversed bounds', { from: '2026-04-21', to: '2026-04-01' }],
    ['invalid --from', { from: 'yesterday' }],
    ['invalid --to', { from: '2026-04-01', to: '2026-04-31' }],
    ['invalid --date', { date: '22-04-2026' }],
  ])('rejects %s', (_label, args) => {
    expect(() => resolveDateRange(cli(args), TODAY)).toThrow(DateArgsError);
  });

  it('reports which flag was wrong', () => {
    expect(() => resolveDateRange(cli({ to: TODAY }), TODAY)).toThrow('--to requires --from');
  });
});

describe('readConfigFile / writeConfigFile', () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-time-tracker-test-'));
    tmpFile = path.join(tmpDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty roots when file does not exist', () => {
    const config = readConfigFile(path.join(tmpDir, 'nonexistent.json'));
    expect(config.roots).toEqual([]);
  });

  it('reads a valid config file', () => {
    const data = { roots: ['/projects/a', '/projects/b'], maxDepth: 3 };
    fs.writeFileSync(tmpFile, JSON.stringify(data));
    const result = readConfigFile(tmpFile);
    expect(result.roots).toEqual(['/projects/a', '/projects/b']);
    expect(result.maxDepth).toBe(3);
  });

  it('returns empty roots for malformed JSON', () => {
    fs.writeFileSync(tmpFile, 'not valid json {{');
    const result = readConfigFile(tmpFile);
    expect(result.roots).toEqual([]);
  });

  it('writes and reads back correctly', () => {
    const data = { roots: ['/a', '/b'], repos: ['/a/repo1'], maxDepth: 4 };
    writeConfigFile(tmpFile, data);
    const result = readConfigFile(tmpFile);
    expect(result.roots).toEqual(['/a', '/b']);
    expect(result.repos).toEqual(['/a/repo1']);
    expect(result.maxDepth).toBe(4);
  });

  it('creates intermediate directories when writing', () => {
    const nested = path.join(tmpDir, 'a', 'b', 'c', 'config.json');
    writeConfigFile(nested, { roots: [] });
    expect(fs.existsSync(nested)).toBe(true);
  });

  it('written file ends with a newline', () => {
    writeConfigFile(tmpFile, { roots: [] });
    const raw = fs.readFileSync(tmpFile, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
  });
});
