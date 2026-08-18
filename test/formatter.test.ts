import {
  EVENT_LABEL,
  buildDocument,
  formatCsv,
  formatDetail,
  formatJson,
  formatMarkdown,
  formatTable,
  groupByDay,
  rangeTitle,
  summarize,
  summarizeRange,
} from '../src/formatter';
import { dayRange } from '../src/config';
import type { NormalizedEvent } from '../src/events';

function entry(overrides: Partial<NormalizedEvent>): NormalizedEvent {
  return {
    type: 'COMMIT',
    timestamp: new Date('2026-04-22T10:00:00Z'),
    repoName: 'repo',
    repoPath: '/projects/repo',
    hash: 'abc1234',
    message: 'hello',
    ...overrides,
  };
}

describe('summarize', () => {
  it('pluralizes correctly for 0 / 1 / many', () => {
    expect(summarize(0, 0)).toBe('0 events across 0 repositories');
    expect(summarize(1, 1)).toBe('1 event across 1 repository');
    expect(summarize(2, 1)).toBe('2 events across 1 repository');
    expect(summarize(1, 2)).toBe('1 event across 2 repositories');
  });
});

describe('formatDetail', () => {
  it('returns the commit message for all commit variants', () => {
    for (const type of ['COMMIT', 'COMMIT_AMEND', 'COMMIT_INITIAL', 'COMMIT_MERGE'] as const) {
      expect(formatDetail(entry({ type, message: 'msg' }))).toBe('msg');
    }
  });

  it('annotates WIP commits with the branch when available', () => {
    expect(formatDetail(entry({ message: 'WIP', branch: 'feature/auth' }))).toBe('WIP (feature/auth)');
    expect(formatDetail(entry({ message: 'wip', branch: 'feature/auth' }))).toBe('wip (feature/auth)');
  });

  it('does not annotate WIP commits when branch is unknown', () => {
    expect(formatDetail(entry({ message: 'WIP' }))).toBe('WIP');
  });

  it('returns the target branch for CHECKOUT', () => {
    expect(formatDetail(entry({ type: 'CHECKOUT', toBranch: 'feature/x', message: undefined })))
      .toBe('feature/x');
  });

  it('shows 7-char short SHA for CHECKOUT_DETACHED', () => {
    expect(
      formatDetail(
        entry({
          type: 'CHECKOUT_DETACHED',
          toBranch: 'd0b9e0d3282d399944388389e603e6355cd40d7c',
          message: undefined,
        }),
      ),
    ).toBe('d0b9e0d');
  });

  it('combines sourceBranch and message for MERGE', () => {
    expect(
      formatDetail(
        entry({ type: 'MERGE', sourceBranch: 'feature/x', message: 'Merge PR #12' }),
      ),
    ).toBe('feature/x: Merge PR #12');
  });

  it('returns the branch for REBASE', () => {
    expect(formatDetail(entry({ type: 'REBASE', branch: 'main', message: undefined })))
      .toBe('main');
  });
});

describe('EVENT_LABEL', () => {
  it('maps every event type to a human-readable label', () => {
    expect(EVENT_LABEL.COMMIT).toBe('COMMIT');
    expect(EVENT_LABEL.COMMIT_AMEND).toBe('COMMIT (amend)');
    expect(EVENT_LABEL.COMMIT_INITIAL).toBe('COMMIT (initial)');
    expect(EVENT_LABEL.COMMIT_MERGE).toBe('COMMIT (merge)');
    expect(EVENT_LABEL.CHECKOUT).toBe('CHECKOUT');
    expect(EVENT_LABEL.CHECKOUT_DETACHED).toBe('CHECKOUT (detached)');
    expect(EVENT_LABEL.MERGE).toBe('MERGE');
    expect(EVENT_LABEL.REBASE).toBe('REBASE');
  });
});

describe('formatTable', () => {
  it('shows a friendly message for empty input', () => {
    const out = formatTable([], dayRange('2026-04-22'), false);
    expect(out).toContain('No events.');
    expect(out).toContain('0 events across 0 repositories');
  });

  it('includes labels, times, and details', () => {
    const out = formatTable([entry({ message: 'Add JWT middleware' })], dayRange('2026-04-22'), false);
    expect(out).toContain('COMMIT');
    expect(out).toContain('Add JWT middleware');
    expect(out).toContain('1 event across 1 repository');
  });

  it('omits ANSI escapes when useColor is false', () => {
    const out = formatTable([entry({})], dayRange('2026-04-22'), false);
    // eslint-disable-next-line no-control-regex
    expect(/\x1b\[/.test(out)).toBe(false);
  });

  it('includes ANSI escapes when useColor is true', () => {
    const out = formatTable([entry({})], dayRange('2026-04-22'), true);
    // eslint-disable-next-line no-control-regex
    expect(/\x1b\[/.test(out)).toBe(true);
  });
});

describe('formatJson', () => {
  it('serialises timestamps as ISO strings', () => {
    const out = formatJson([entry({})]);
    const parsed = JSON.parse(out);
    expect(parsed[0].timestamp).toBe('2026-04-22T10:00:00.000Z');
  });
});

describe('formatCsv', () => {
  it('emits a header and a row per entry', () => {
    const out = formatCsv([entry({ message: 'hello' })]);
    const [header, row] = out.split('\n');
    expect(header).toBe('date,time,repository,type,detail,hash');
    expect(row).toContain('COMMIT');
    expect(row).toContain('hello');
  });

  it('replaces commas in detail with semicolons to keep CSV safe', () => {
    const out = formatCsv([entry({ message: 'hello, world' })]);
    const row = out.split('\n')[1] ?? '';
    expect(row).toContain('hello; world');
    expect(row.split(',').length).toBe(6);
  });

  it('carries a date column so multi-day exports pivot per day', () => {
    const out = formatCsv([entry({ timestamp: new Date('2026-04-20T12:00:00Z') })]);
    const row = out.split('\n')[1] ?? '';
    expect(row.startsWith('2026-04-20,')).toBe(true);
  });
});

describe('formatMarkdown', () => {
  it('lifts the title into a heading and fences the CLI layout', () => {
    const out = formatMarkdown([entry({ message: 'hello' })], dayRange('2026-04-22'));
    const lines = out.split('\n');
    expect(lines[0]).toBe('# Git Time Tracker — 2026-04-22');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('```text');
    expect(lines[lines.length - 1]).toBe('```');
  });

  it('embeds the table rendering verbatim, minus its title line', () => {
    const entries = [entry({ message: 'hello' })];
    const body = formatTable(entries, dayRange('2026-04-22'), false).split('\n').slice(1).join('\n');
    expect(formatMarkdown(entries, dayRange('2026-04-22'))).toContain(body);
  });

  it('never carries ANSI escapes into the file', () => {
    const out = formatMarkdown([entry({})], dayRange('2026-04-22'));
    // eslint-disable-next-line no-control-regex
    expect(/\x1b\[/.test(out)).toBe(false);
  });

  it('does not escape pipes, since a fenced block is literal', () => {
    const out = formatMarkdown([entry({ message: 'a | b' })], dayRange('2026-04-22'));
    expect(out).toContain('a | b');
    expect(out).not.toContain('a \\| b');
  });

  it('grows the fence past any backtick run in the content', () => {
    const out = formatMarkdown([entry({ message: 'fix ```code``` block' })], dayRange('2026-04-22'));
    expect(out).toContain('````text');
    expect(out.endsWith('````')).toBe(true);
  });

  it('reports "no events" when the list is empty', () => {
    const out = formatMarkdown([], dayRange('2026-04-22'));
    expect(out).toContain('  No events.');
    expect(out).toContain(' 0 events across 0 repositories');
  });
});

const RANGE = { from: '2026-04-20', to: '2026-04-22' };

function dayEntry(day: string, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  // Midday keeps the local calendar day equal to the UTC one on every offset.
  return entry({ timestamp: new Date(`${day}T12:00:00Z`), ...overrides });
}

describe('rangeTitle', () => {
  it('collapses a single-day range to one date', () => {
    expect(rangeTitle(dayRange('2026-04-22'))).toBe('2026-04-22');
    expect(rangeTitle(RANGE)).toBe('2026-04-20 .. 2026-04-22');
  });
});

describe('groupByDay', () => {
  it('emits every day of the range, including empty ones, ascending', () => {
    const groups = groupByDay([dayEntry('2026-04-21')], RANGE);
    expect(groups.map((g) => g.date)).toEqual(['2026-04-20', '2026-04-21', '2026-04-22']);
    expect(groups.map((g) => g.entries.length)).toEqual([0, 1, 0]);
  });

  it('keeps entries that fall outside the range instead of dropping them', () => {
    const groups = groupByDay([dayEntry('2026-04-19')], RANGE);
    expect(groups[0]?.date).toBe('2026-04-19');
    expect(groups).toHaveLength(4);
  });
});

describe('summarizeRange', () => {
  it('appends active-day counts only for multi-day ranges', () => {
    expect(summarizeRange([dayEntry('2026-04-22')], dayRange('2026-04-22'))).toBe(
      '1 event across 1 repository',
    );
    expect(summarizeRange([dayEntry('2026-04-20'), dayEntry('2026-04-22')], RANGE)).toBe(
      '2 events across 1 repository, 2 active days of 3',
    );
  });
});

describe('formatTable over a range', () => {
  it('groups events under day headings with per-day and total summaries', () => {
    const out = formatTable(
      [dayEntry('2026-04-20', { message: 'first' }), dayEntry('2026-04-22', { message: 'last' })],
      RANGE,
      false,
    );
    expect(out).toContain('Git Time Tracker — 2026-04-20 .. 2026-04-22');
    expect(out).toContain('── 2026-04-20 Mon');
    expect(out).toContain('── 2026-04-21 Tue');
    expect(out).toContain('  No events.');
    expect(out).toContain('first');
    expect(out).toContain('2 events across 1 repository, 2 active days of 3');
  });

  it('keeps the single-day layout free of day headings', () => {
    const out = formatTable([dayEntry('2026-04-22')], dayRange('2026-04-22'), false);
    expect(out).not.toContain('── 2026-04-22');
    // The per-day footer would only repeat the grand total on a single day.
    expect(out.match(/1 event across 1 repository/g)).toHaveLength(1);
  });

  it('labels both days when a single-date query holds a neighbouring-day entry', () => {
    // Possible when a repo's git offset differs from the machine's; the days are
    // named rather than silently merged under the requested date.
    const out = formatTable(
      [dayEntry('2026-04-22'), dayEntry('2026-04-23')],
      dayRange('2026-04-22'),
      false,
    );
    expect(out).toContain('── 2026-04-22');
    expect(out).toContain('── 2026-04-23');
  });
});

describe('formatMarkdown over a range', () => {
  it('carries the same day rules and totals as the table', () => {
    const out = formatMarkdown([dayEntry('2026-04-20', { message: 'first' })], RANGE);
    expect(out).toContain('# Git Time Tracker — 2026-04-20 .. 2026-04-22');
    expect(out).toContain('── 2026-04-20 Mon');
    expect(out).toContain('── 2026-04-21 Tue');
    expect(out).toContain('  No events.');
    expect(out).toContain(' 1 event across 1 repository, 1 active day of 3');
  });
});

describe('markdown and table share one document structure', () => {
  const ENTRIES = [dayEntry('2026-04-20', { message: 'first' }), dayEntry('2026-04-22', { message: 'last' })];

  it('builds the same outline both renderers consume', () => {
    const doc = buildDocument(ENTRIES, RANGE);
    expect(doc.title).toBe('Git Time Tracker — 2026-04-20 .. 2026-04-22');
    expect(doc.sections.map((s) => s.heading)).toEqual([
      '2026-04-20 Mon',
      '2026-04-21 Tue',
      '2026-04-22 Wed',
    ]);
    expect(doc.sections.map((s) => s.summary)).toEqual([
      '1 event across 1 repository',
      undefined,
      '1 event across 1 repository',
    ]);
    expect(doc.total).toBe('2 events across 1 repository, 2 active days of 3');
  });

  it('drops headings and per-day summaries for a one-day document', () => {
    const doc = buildDocument([dayEntry('2026-04-22')], dayRange('2026-04-22'));
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]?.heading).toBeUndefined();
    expect(doc.sections[0]?.summary).toBeUndefined();
  });

  it('renders every document string in both formats', () => {
    const doc = buildDocument(ENTRIES, RANGE);
    const table = formatTable(ENTRIES, RANGE, false);
    const markdown = formatMarkdown(ENTRIES, RANGE);
    for (const text of [...doc.sections.map((s) => s.heading), ...doc.sections.map((s) => s.summary)]) {
      if (!text) continue;
      expect(table).toContain(text);
      expect(markdown).toContain(text);
    }
    for (const text of [doc.emptyNotice, doc.total]) {
      expect(table).toContain(text);
      expect(markdown).toContain(text);
    }
  });

  it('keeps the column header identical in both formats', () => {
    const doc = buildDocument(ENTRIES, RANGE);
    const table = formatTable(ENTRIES, RANGE, false);
    const markdown = formatMarkdown(ENTRIES, RANGE);
    for (const column of doc.columns) {
      expect(table).toContain(column.toUpperCase());
      expect(markdown).toContain(column.toUpperCase());
    }
  });
});
