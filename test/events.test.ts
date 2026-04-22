import {
  COMMIT_TYPES,
  isCommitType,
  normalizeTimestamp,
  parseEvent,
  parseEvents,
  type EventType,
  type RawReflogEntry,
} from '../src/events';

const BASE: RawReflogEntry = {
  hash: 'abc123',
  subject: '',
  timestamp: '2026-04-22 10:30:00 +0200',
  repoPath: '/projects/my-app',
};

function entry(subject: string): RawReflogEntry {
  return { ...BASE, subject };
}

describe('parseEvent', () => {
  describe('COMMIT', () => {
    it('parses a standard commit', () => {
      const e = parseEvent(entry('commit: Add JWT middleware'));
      expect(e?.type).toBe('COMMIT');
      expect(e?.message).toBe('Add JWT middleware');
    });

    it('parses an amended commit', () => {
      const e = parseEvent(entry('commit (amend): Fix typo'));
      expect(e?.type).toBe('COMMIT_AMEND');
      expect(e?.message).toBe('Fix typo');
    });

    it('parses an initial commit', () => {
      const e = parseEvent(entry('commit (initial): Initial commit'));
      expect(e?.type).toBe('COMMIT_INITIAL');
      expect(e?.message).toBe('Initial commit');
    });

    it('parses a merge commit (e.g. after resolving conflicts)', () => {
      const e = parseEvent(entry("commit (merge): Merge branch 'feature/auth' into main"));
      expect(e?.type).toBe('COMMIT_MERGE');
      expect(e?.message).toBe("Merge branch 'feature/auth' into main");
    });

    it('preserves colons in commit message', () => {
      const e = parseEvent(entry('commit: feat: add login'));
      expect(e?.message).toBe('feat: add login');
    });
  });

  describe('CHECKOUT', () => {
    it('parses a branch checkout', () => {
      const e = parseEvent(entry('checkout: moving from main to feature/auth'));
      expect(e?.type).toBe('CHECKOUT');
      expect(e?.toBranch).toBe('feature/auth');
    });

    it('parses checkout with slashes in branch names', () => {
      const e = parseEvent(entry('checkout: moving from feature/old to fix/issue-42'));
      expect(e?.toBranch).toBe('fix/issue-42');
    });

    it('parses a detached-HEAD checkout (target is a raw SHA)', () => {
      const e = parseEvent(
        entry('checkout: moving from master to d0b9e0d3282d399944388389e603e6355cd40d7c'),
      );
      expect(e?.type).toBe('CHECKOUT_DETACHED');
      expect(e?.toBranch).toBe('d0b9e0d3282d399944388389e603e6355cd40d7c');
    });

    it('does not treat a branch name containing hex chars as detached', () => {
      const e = parseEvent(entry('checkout: moving from master to feature/abc123'));
      expect(e?.type).toBe('CHECKOUT');
    });
  });

  describe('MERGE', () => {
    it('parses a merge', () => {
      const e = parseEvent(entry('merge feature/login: Merge pull request #12'));
      expect(e?.type).toBe('MERGE');
      expect(e?.sourceBranch).toBe('feature/login');
      expect(e?.message).toBe('Merge pull request #12');
    });
  });

  describe('REBASE', () => {
    it('parses a rebase finish', () => {
      const e = parseEvent(entry('rebase -i (finish): returning to refs/heads/main'));
      expect(e?.type).toBe('REBASE');
      expect(e?.branch).toBe('main');
    });
  });

  describe('discarded events', () => {
    it('returns null for reset events', () => {
      expect(parseEvent(entry('reset: moving to HEAD~1'))).toBeNull();
    });

    it('returns null for unknown subjects', () => {
      expect(parseEvent(entry('unknown operation: foo'))).toBeNull();
    });

    it('returns null for empty subject', () => {
      expect(parseEvent(entry(''))).toBeNull();
    });
  });

  describe('common fields', () => {
    it('sets timestamp as Date', () => {
      const e = parseEvent(entry('commit: Test'));
      expect(e?.timestamp).toBeInstanceOf(Date);
    });

    it('sets repoName as the repo folder basename', () => {
      const e = parseEvent(entry('commit: Test'));
      expect(e?.repoName).toBe('my-app');
    });

    it('sets hash from entry', () => {
      const e = parseEvent(entry('commit: Test'));
      expect(e?.hash).toBe('abc123');
    });
  });
});

describe('parseEvents', () => {
  it('filters out null events and returns only parseable ones', () => {
    const entries: RawReflogEntry[] = [
      entry('commit: Add feature'),
      entry('reset: moving to HEAD~1'),
      entry('checkout: moving from main to dev'),
      entry('unknown stuff'),
    ];
    const events = parseEvents(entries);
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('COMMIT');
    expect(events[1]?.type).toBe('CHECKOUT');
  });

  it('returns empty array for empty input', () => {
    expect(parseEvents([])).toEqual([]);
  });

  it('preserves input order for successful parses', () => {
    const entries: RawReflogEntry[] = [
      entry('checkout: moving from main to feature/x'),
      entry('commit: one'),
      entry('commit: two'),
    ];
    const events = parseEvents(entries);
    expect(events.map((e) => e.type)).toEqual(['CHECKOUT', 'COMMIT', 'COMMIT']);
    expect(events.map((e) => e.message)).toEqual([undefined, 'one', 'two']);
  });
});

describe('normalizeTimestamp', () => {
  it('converts space-separated timestamp with offset to strict ISO 8601', () => {
    expect(normalizeTimestamp('2026-04-07 14:58:32 +0200')).toBe('2026-04-07T14:58:32+02:00');
  });

  it('handles negative timezone offsets', () => {
    expect(normalizeTimestamp('2026-04-07 14:58:32 -0500')).toBe('2026-04-07T14:58:32-05:00');
  });

  it('returns input unchanged when it does not match the expected shape', () => {
    expect(normalizeTimestamp('not a timestamp')).toBe('not a timestamp');
  });

  it('produces a value parseable by Date', () => {
    const iso = normalizeTimestamp('2026-04-07 14:58:32 +0200');
    expect(new Date(iso).toISOString()).toBe('2026-04-07T12:58:32.000Z');
  });
});

describe('isCommitType / COMMIT_TYPES', () => {
  it('returns true for all commit variants', () => {
    expect(isCommitType('COMMIT')).toBe(true);
    expect(isCommitType('COMMIT_AMEND')).toBe(true);
    expect(isCommitType('COMMIT_INITIAL')).toBe(true);
    expect(isCommitType('COMMIT_MERGE')).toBe(true);
  });

  it('returns false for non-commit event types', () => {
    const nonCommit: EventType[] = ['CHECKOUT', 'CHECKOUT_DETACHED', 'MERGE', 'REBASE'];
    for (const t of nonCommit) {
      expect(isCommitType(t)).toBe(false);
    }
  });

  it('COMMIT_TYPES contains exactly the four commit variants', () => {
    expect([...COMMIT_TYPES].sort()).toEqual(
      ['COMMIT', 'COMMIT_AMEND', 'COMMIT_INITIAL', 'COMMIT_MERGE'],
    );
  });
});
