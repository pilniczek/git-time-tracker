import {
  EVENT_LABEL,
  formatCsv,
  formatDetail,
  formatJson,
  formatMarkdown,
  formatTable,
  summarize,
} from '../src/formatter';
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
    const out = formatTable([], '2026-04-22', false);
    expect(out).toContain('No events found for 2026-04-22.');
    expect(out).toContain('0 events across 0 repositories');
  });

  it('includes labels, times, and details', () => {
    const out = formatTable([entry({ message: 'Add JWT middleware' })], '2026-04-22', false);
    expect(out).toContain('COMMIT');
    expect(out).toContain('Add JWT middleware');
    expect(out).toContain('1 event across 1 repository');
  });

  it('omits ANSI escapes when useColor is false', () => {
    const out = formatTable([entry({})], '2026-04-22', false);
    // eslint-disable-next-line no-control-regex
    expect(/\x1b\[/.test(out)).toBe(false);
  });

  it('includes ANSI escapes when useColor is true', () => {
    const out = formatTable([entry({})], '2026-04-22', true);
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
    expect(header).toBe('time,repository,type,detail,hash');
    expect(row).toContain('COMMIT');
    expect(row).toContain('hello');
  });

  it('replaces commas in detail with semicolons to keep CSV safe', () => {
    const out = formatCsv([entry({ message: 'hello, world' })]);
    const row = out.split('\n')[1] ?? '';
    expect(row).toContain('hello; world');
    expect(row.split(',').length).toBe(5);
  });
});

describe('formatMarkdown', () => {
  it('produces a GFM table with a header and one row per entry', () => {
    const out = formatMarkdown([entry({ message: 'hello' })], '2026-04-22');
    expect(out).toContain('# Git Time Tracker — 2026-04-22');
    expect(out).toContain('| Time  | Repository | Type | Detail |');
    expect(out).toContain('| hello |');
  });

  it('escapes pipe characters in cells', () => {
    const out = formatMarkdown([entry({ message: 'a | b' })], '2026-04-22');
    expect(out).toContain('a \\| b');
  });

  it('reports "no events" when the list is empty', () => {
    const out = formatMarkdown([], '2026-04-22');
    expect(out).toContain('No events found for 2026-04-22.');
    expect(out).toContain('_0 events across 0 repositories_');
  });
});
