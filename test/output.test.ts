import { CliArgsError, dayRange } from '../src/config';
import type { NormalizedEvent } from '../src/events';
import {
  DEFAULT_FILE_FORMAT,
  DEFAULT_STDOUT_FORMAT,
  OUTPUT_FORMATS,
  extensionFor,
  formatFromPath,
  isOutputFormat,
  parseFormat,
  renderTimeline,
  resolveFormat,
} from '../src/output';

const RANGE = dayRange('2026-04-22');

const ENTRY: NormalizedEvent = {
  type: 'COMMIT',
  timestamp: new Date('2026-04-22T12:00:00Z'),
  repoName: 'repo',
  repoPath: '/projects/repo',
  hash: 'abc1234',
  message: 'hello',
};

describe('format registry', () => {
  it('covers every advertised format', () => {
    expect(OUTPUT_FORMATS).toEqual(['table', 'json', 'csv', 'markdown']);
  });

  it('maps each format to a distinct extension', () => {
    const extensions = OUTPUT_FORMATS.map(extensionFor);
    expect(new Set(extensions).size).toBe(extensions.length);
  });

  it('round-trips format → extension → format', () => {
    for (const format of OUTPUT_FORMATS) {
      expect(formatFromPath(`report.${extensionFor(format)}`)).toBe(format);
    }
  });
});

describe('parseFormat', () => {
  it('accepts known formats', () => {
    expect(parseFormat('csv')).toBe('csv');
  });

  it('rejects unknown formats instead of falling back silently', () => {
    expect(() => parseFormat('xlsx')).toThrow(CliArgsError);
    expect(() => parseFormat('xlsx')).toThrow('--format must be one of');
  });

  it('does not treat inherited Object properties as formats', () => {
    expect(isOutputFormat('toString')).toBe(false);
    expect(isOutputFormat('constructor')).toBe(false);
  });
});

describe('formatFromPath', () => {
  it('is undefined for paths with no or unknown extension', () => {
    expect(formatFromPath('')).toBeUndefined();
    expect(formatFromPath('report')).toBeUndefined();
    expect(formatFromPath('report.xlsx')).toBeUndefined();
  });

  it('is case-insensitive', () => {
    expect(formatFromPath('REPORT.MD')).toBe('markdown');
  });
});

describe('resolveFormat', () => {
  it('defaults to a table on stdout', () => {
    expect(resolveFormat(undefined, undefined)).toBe(DEFAULT_STDOUT_FORMAT);
  });

  it('defaults a bare --out to markdown', () => {
    expect(resolveFormat(undefined, '')).toBe(DEFAULT_FILE_FORMAT);
  });

  it('infers the format from an explicit --out path', () => {
    expect(resolveFormat(undefined, 'week.csv')).toBe('csv');
  });

  it('falls back to markdown for an unrecognised extension', () => {
    expect(resolveFormat(undefined, 'week.xlsx')).toBe(DEFAULT_FILE_FORMAT);
  });

  it('lets --format win over the path extension', () => {
    expect(resolveFormat('json', 'week.csv')).toBe('json');
  });

  it('propagates an invalid --format', () => {
    expect(() => resolveFormat('xlsx', undefined)).toThrow(CliArgsError);
  });
});

describe('renderTimeline', () => {
  it('dispatches to the matching formatter', () => {
    expect(renderTimeline([ENTRY], RANGE, 'json', false)).toContain('"type": "COMMIT"');
    expect(renderTimeline([ENTRY], RANGE, 'csv', false)).toContain('date,time,repository');
    expect(renderTimeline([ENTRY], RANGE, 'markdown', false)).toContain('# Git Time Tracker');
    expect(renderTimeline([ENTRY], RANGE, 'table', false)).toContain('Git Time Tracker');
  });

  it('honours useColor for the table only', () => {
    // eslint-disable-next-line no-control-regex
    const ansi = /\x1b\[/;
    expect(ansi.test(renderTimeline([ENTRY], RANGE, 'table', true))).toBe(true);
    expect(ansi.test(renderTimeline([ENTRY], RANGE, 'markdown', true))).toBe(false);
  });
});
