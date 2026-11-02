import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  at,
  dayOverride,
  hoursFor,
  linkWipFollowUps,
  onWorkDay,
  parseRanges,
  planDay,
  splitAtMidnight,
  splitSquash,
  subtract,
  validate,
  workDate,
  type Config,
  type DayHours,
  type Entry,
  type LocalEvent,
} from './worklog.mts';

const HOURS: DayHours = { start: '08:00', lunch: { start: '12:00', minutes: 30 } };

function commit(date: string, time: string, detail: string, extra: Partial<LocalEvent> = {}): LocalEvent {
  const ticket = detail.match(/SST-\d+/)?.[0] ?? 'n/a';
  return {
    at: at(date, time),
    repo: 'repo',
    type: 'COMMIT',
    detail,
    ticket,
    ticketSource: ticket === 'n/a' ? 'none' : 'commit',
    isCommit: true,
    branch: 'main',
    ...extra,
  };
}

function entry(date: string, start: string, hours: number, cs: string, extra: Partial<Entry> = {}): Entry {
  return { date, start, sst: 'SST-1', original: 'x', cs, hours, ...extra };
}

describe('workDate', () => {
  it('assigns commits before the boundary to the previous day', () => {
    assert.equal(workDate(at('2026-10-27', '01:08'), '05:00'), '2026-10-26');
    assert.equal(workDate(at('2026-10-27', '04:59'), '05:00'), '2026-10-26');
  });

  it('starts a new day at the boundary', () => {
    assert.equal(workDate(at('2026-10-27', '05:00'), '05:00'), '2026-10-27');
    assert.equal(workDate(at('2026-10-27', '04:45'), '04:30'), '2026-10-27');
  });

  it('crosses month ends', () => {
    assert.equal(workDate(at('2026-11-01', '02:00'), '05:00'), '2026-10-31');
  });
});

describe('onWorkDay and parseRanges', () => {
  it('places times before the boundary on the next calendar date', () => {
    assert.deepEqual(onWorkDay('2026-10-26', '00:30', '05:00'), at('2026-10-27', '00:30'));
    assert.deepEqual(onWorkDay('2026-10-26', '22:00', '05:00'), at('2026-10-26', '22:00'));
  });

  it('lets a range run past midnight', () => {
    assert.deepEqual(parseRanges('2026-10-26', ['21:00-01:00'], '05:00'), [
      { from: at('2026-10-26', '21:00'), to: at('2026-10-27', '01:00') },
    ]);
  });
});

describe('subtract', () => {
  it('never returns negative parts when a hole ends after the span', () => {
    const span = { from: at('2026-10-26', '16:00'), to: at('2026-10-26', '18:00') };
    const parts = subtract(span, [{ from: at('2026-10-26', '16:30'), to: at('2026-10-26', '21:00') }]);
    assert.ok(parts.every((p) => p.to >= p.from));
    assert.deepEqual(parts[0], { from: at('2026-10-26', '16:00'), to: at('2026-10-26', '16:30') });
  });
});

describe('hoursFor', () => {
  const config: Config = { default: HOURS, days: { mon: { start: '07:00' } } };

  it('applies weekday overrides over the default', () => {
    assert.deepEqual(hoursFor(config, '2026-10-26', undefined), { ...HOURS, start: '07:00' });
    assert.deepEqual(hoursFor(config, '2026-10-27', undefined), HOURS);
  });

  it('uses a lunch given for the date', () => {
    assert.deepEqual(hoursFor(config, '2026-10-27', '13:00/45').lunch, { start: '13:00', minutes: 45 });
  });

  it('works without a default when the weekday is listed', () => {
    assert.deepEqual(hoursFor({ days: { tue: HOURS } }, '2026-10-27', undefined), HOURS);
  });

  it('fails for a weekday with no hours', () => {
    assert.throws(() => hoursFor({ days: { tue: HOURS } }, '2026-10-26', undefined), /no hours for mon/);
  });
});

describe('dayOverride', () => {
  const args = (entries: Record<string, string>) => new Map(Object.entries(entries));

  it('stores only values that differ from the default', () => {
    assert.deepEqual(dayOverride(args({ start: '07:00' }), { default: HOURS }, 'mon'), { start: '07:00' });
    assert.deepEqual(dayOverride(args({ start: '08:00' }), { default: HOURS }, 'mon'), {});
  });

  it('builds on the existing override', () => {
    const config: Config = { default: HOURS, days: { mon: { start: '07:00' } } };
    assert.deepEqual(dayOverride(args({ 'lunch-minutes': '45' }), config, 'mon'), {
      start: '07:00',
      lunch: { start: '12:00', minutes: 45 },
    });
  });

  it('rejects lunch minutes when no lunch start is known', () => {
    assert.throws(() => dayOverride(args({ 'lunch-minutes': '45' }), {}, 'mon'), /no lunch start/);
  });

  it('needs at least one value', () => {
    assert.throws(() => dayOverride(args({}), { default: HOURS }, 'mon'), /--day needs/);
  });
});

describe('splitSquash', () => {
  it('excludes TMP commits, replays and amend bursts but keeps repeated WIPs', () => {
    const commits = [
      commit('2026-10-26', '09:00', 'SST-1: add form'),
      commit('2026-10-26', '09:10', 'TMP'),
      commit('2026-10-26', '09:20', 'WIP'),
      commit('2026-10-26', '09:30', 'WIP'),
      commit('2026-10-26', '10:00', 'SST-1: add form'),
      commit('2026-10-26', '11:00', 'SST-1: a', { type: 'COMMIT_AMEND' }),
      commit('2026-10-26', '11:01', 'SST-1: b', { type: 'COMMIT_AMEND' }),
    ];
    const { work, squash } = splitSquash(commits);
    assert.deepEqual(work.map((c) => `${c.detail}`), ['SST-1: add form', 'WIP', 'WIP']);
    assert.equal(squash.length, 4);
  });
});

describe('linkWipFollowUps', () => {
  it('links a WIP to the next non-WIP commit on the same branch', () => {
    const linked = linkWipFollowUps([
      commit('2026-10-26', '09:00', 'WIP', { branch: 'feature' }),
      commit('2026-10-26', '10:00', 'SST-2: other', { branch: 'main' }),
      commit('2026-10-26', '11:00', 'SST-1: done', { branch: 'feature' }),
    ]);
    assert.equal(linked[0].ticket, 'SST-1');
    assert.equal(linked[0].followUp?.detail, 'SST-1: done');
  });

  it('leaves a WIP without follow-up unlinked', () => {
    assert.equal(linkWipFollowUps([commit('2026-10-26', '09:00', 'WIP')])[0].followUp, undefined);
  });
});

describe('planDay', () => {
  const plan = (commits: LocalEvent[], options: { start?: string; meetings?: string[]; breaks?: string[] } = {}) =>
    planDay(
      '2026-10-26',
      commits,
      HOURS,
      options.start,
      parseRanges('2026-10-26', options.meetings ?? [], '05:00'),
      parseRanges('2026-10-26', options.breaks ?? [], '05:00'),
      undefined,
    );

  it('starts at the configured start and deducts lunch', () => {
    const output = plan([commit('2026-10-26', '13:00', 'SST-1: form')]);
    assert.match(output, /start 08:00 \(config\)/);
    assert.match(output, /block 08:00 \| 4\.5 h \| SST-1/);
  });

  it('asks for the start when the first commit is early', () => {
    assert.match(plan([commit('2026-10-26', '07:00', 'SST-1: form')]), /ASK start: first commit 07:00/);
    assert.doesNotMatch(plan([commit('2026-10-26', '07:00', 'SST-1: form')], { start: '06:00' }), /ASK start/);
  });

  it('asks about gaps over 2 h until a meeting or break covers them', () => {
    const commits = [commit('2026-10-26', '09:00', 'SST-1: a'), commit('2026-10-26', '15:00', 'SST-1: b')];
    assert.match(plan(commits), /ASK gap: 09:00-15:00/);
    assert.doesNotMatch(plan(commits, { meetings: ['10:00-11:00'] }), /ASK gap/);
    assert.doesNotMatch(plan(commits, { breaks: ['10:00-14:00'] }), /ASK gap/);
  });

  it('gives a meeting its own block and leaves a break out', () => {
    const commits = [commit('2026-10-26', '09:00', 'SST-1: a'), commit('2026-10-26', '15:00', 'SST-1: b')];
    assert.match(plan(commits, { meetings: ['10:00-11:00'] }), /block 10:00 \| 1 h \| n\/a meeting/);
    assert.match(plan(commits, { breaks: ['10:00-14:00'] }), /block 14:00 \| 1 h \| SST-1/);
  });

  it('asks when a commit falls inside a break', () => {
    const commits = [commit('2026-10-26', '09:00', 'SST-1: a'), commit('2026-10-26', '11:00', 'SST-1: b')];
    assert.match(plan(commits, { breaks: ['10:00-12:00'] }), /ASK break: commit 11:00/);
  });

  it('shows night times with their calendar date', () => {
    const output = plan([commit('2026-10-26', '23:00', 'SST-1: a'), commit('2026-10-27', '01:00', 'SST-1: b')], {
      breaks: ['08:00-22:30'],
    });
    assert.match(output, /ends 01:00 \(2026-10-27\)/);
    assert.match(output, /01:00 \(2026-10-27\) repo COMMIT/);
  });
});

describe('validate', () => {
  it('accepts a valid day', () => {
    assert.deepEqual(validate([entry('2026-10-26', '08:00', 2, 'a'), entry('2026-10-26', '10:00', 1, 'b')]), []);
  });

  it('accepts an entry that crosses midnight', () => {
    assert.deepEqual(validate([entry('2026-10-26', '22:00', 3, 'a')]), []);
  });

  it('rejects blocks over 4 h and non-quarter values', () => {
    const problems = validate([entry('2026-10-26', '08:10', 4.1, 'a')]);
    assert.equal(problems.length, 3);
  });

  it('rejects overlaps across midnight', () => {
    const problems = validate([entry('2026-10-26', '23:00', 2, 'a'), entry('2026-10-27', '00:30', 1, 'b')]);
    assert.deepEqual(problems, ['2026-10-27 00:30 SST-1: overlaps previous entry']);
  });

  it('rejects unsorted rows and repeated Czech descriptions except meetings', () => {
    const meeting = { sst: 'n/a', original: 'Meeting' };
    assert.deepEqual(
      validate([
        entry('2026-10-26', '08:00', 1, 'Schůzka', meeting),
        entry('2026-10-26', '09:00', 1, 'Schůzka', meeting),
      ]),
      [],
    );
    assert.equal(validate([entry('2026-10-26', '08:00', 1, 'a'), entry('2026-10-26', '09:00', 1, 'a')]).length, 1);
    const unsorted = validate([entry('2026-10-26', '10:00', 1, 'a'), entry('2026-10-26', '08:00', 1, 'b')]);
    assert.ok(unsorted.some((problem) => /not sorted/.test(problem)));
  });
});

describe('splitAtMidnight', () => {
  it('splits an entry into one row per calendar date', () => {
    assert.deepEqual(splitAtMidnight(entry('2026-10-31', '22:00', 3, 'Noční práce')), [
      entry('2026-10-31', '22:00', 2, 'Noční práce (část 1)'),
      entry('2026-11-01', '00:00', 1, 'Noční práce (část 2)'),
    ]);
  });

  it('keeps an entry that ends at midnight', () => {
    assert.deepEqual(splitAtMidnight(entry('2026-10-26', '22:00', 2, 'a')), [entry('2026-10-26', '22:00', 2, 'a')]);
  });
});
