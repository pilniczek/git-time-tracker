import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseReflogOutput } from '../src/reflog';

const FIXTURES_PATH = path.join(__dirname, 'fixtures', 'reflog-samples.txt');
const FIXTURE_DATE = '2026-04-22';

describe('parseReflogOutput', () => {
  it('parses all lines from the fixture file', () => {
    const raw = fs.readFileSync(FIXTURES_PATH, 'utf8');
    const entries = parseReflogOutput(raw, '/projects/test-repo', FIXTURE_DATE);
    // fixture has 8 lines, all on 2026-04-22
    expect(entries).toHaveLength(8);
  });

  it('maps hash, subject, timestamp, repoPath', () => {
    const line =
      'abc1234def5678abc1234def5678abc1234def5678|HEAD@{2026-04-22 10:30:00 +0200}|commit: Add feature|Test User|test@example.com';
    const [entry] = parseReflogOutput(line + '\n', '/projects/my-app', FIXTURE_DATE, 'test@example.com');
    expect(entry?.hash).toBe('abc1234def5678abc1234def5678abc1234def5678');
    expect(entry?.subject).toBe('commit: Add feature');
    expect(entry?.timestamp).toBe('2026-04-22 10:30:00 +0200');
    expect(entry?.repoPath).toBe('/projects/my-app');
  });

  it('extracts timestamp from the reflog selector, not from a separate field', () => {
    const line =
      'hash1|HEAD@{2026-04-22 14:58:32 +0200}|checkout: moving from main to feature/x|Name|email@x.com';
    const [entry] = parseReflogOutput(line + '\n', '/repo', FIXTURE_DATE);
    expect(entry?.timestamp).toBe('2026-04-22 14:58:32 +0200');
  });

  it('handles subjects that contain pipe characters', () => {
    const line = 'hash1|HEAD@{2026-04-22 10:00:00 +0200}|commit: feat: pipe|test here|Name|email@x.com';
    const [entry] = parseReflogOutput(line + '\n', '/repo', FIXTURE_DATE, 'email@x.com');
    expect(entry?.subject).toBe('commit: feat: pipe|test here');
  });

  it('filters entries to the requested date', () => {
    const raw = fs.readFileSync(FIXTURES_PATH, 'utf8');
    const entries = parseReflogOutput(raw, '/projects/test-repo', '2026-04-21');
    expect(entries).toHaveLength(0);
  });

  it('returns all entries when no date filter is provided', () => {
    const raw = fs.readFileSync(FIXTURES_PATH, 'utf8');
    const entries = parseReflogOutput(raw, '/projects/test-repo');
    expect(entries).toHaveLength(8);
  });

  it('filters commit events by authorEmail but passes through non-commit events', () => {
    const lines = [
      'h1|HEAD@{2026-04-22 09:00:00 +0200}|commit: my work|Me|me@example.com',
      'h2|HEAD@{2026-04-22 09:05:00 +0200}|commit: colleague work|Other|other@example.com',
      'h3|HEAD@{2026-04-22 09:10:00 +0200}|checkout: moving from main to feature/x|Other|other@example.com',
    ].join('\n') + '\n';
    const entries = parseReflogOutput(lines, '/repo', '2026-04-22', 'me@example.com');
    expect(entries).toHaveLength(2);
    expect(entries[0]?.subject).toBe('commit: my work');
    expect(entries[1]?.subject).toBe('checkout: moving from main to feature/x');
  });

  it('returns empty array for empty input', () => {
    expect(parseReflogOutput('', '/repo')).toEqual([]);
  });

  it('skips malformed lines with fewer than 5 fields', () => {
    const bad = 'hash|selector|subject\n';
    expect(parseReflogOutput(bad, '/repo')).toEqual([]);
  });

  it('skips lines where selector has no date in braces', () => {
    // HEAD@{0} has braces but the contents aren't a date — with a date filter
    // this line must be dropped. The parser only extracts the content between
    // braces as-is; the filter does the rejection.
    const bad = 'hash|HEAD@{0}|commit: msg|Name|email@x.com\n';
    const entries = parseReflogOutput(bad, '/repo', '2026-04-22');
    expect(entries).toHaveLength(0);
  });

  it('sets repoPath on every entry', () => {
    const raw = fs.readFileSync(FIXTURES_PATH, 'utf8');
    const entries = parseReflogOutput(raw, '/my/custom/path', FIXTURE_DATE);
    expect(entries.every((e) => e.repoPath === '/my/custom/path')).toBe(true);
  });

  describe('author filtering (current-user guarantee)', () => {
    const mixedLines = [
      'h1|HEAD@{2026-04-22 09:00:00 +0200}|commit: my work|Me|me@example.com',
      'h2|HEAD@{2026-04-22 09:05:00 +0200}|commit: colleague work|Other|other@example.com',
      'h3|HEAD@{2026-04-22 09:10:00 +0200}|commit (amend): amend by other|Other|other@example.com',
      'h4|HEAD@{2026-04-22 09:10:00 +0200}|commit (merge): merge by other|Other|other@example.com',
      'h5|HEAD@{2026-04-22 09:15:00 +0200}|checkout: moving from main to x|Other|other@example.com',
      'h6|HEAD@{2026-04-22 09:20:00 +0200}|merge feature/x: msg|Other|other@example.com',
      'h7|HEAD@{2026-04-22 09:25:00 +0200}|rebase -i (finish): returning to refs/heads/main|Other|other@example.com',
    ].join('\n') + '\n';

    it('keeps only the current user\'s commits when an email is provided', () => {
      const entries = parseReflogOutput(mixedLines, '/repo', '2026-04-22', 'me@example.com');
      const subjects = entries.map((e) => e.subject);
      expect(subjects).toContain('commit: my work');
      expect(subjects).not.toContain('commit: colleague work');
      expect(subjects).not.toContain('commit (amend): amend by other');
      expect(subjects).not.toContain('commit (merge): merge by other');
    });

    it('always keeps non-commit events (checkout/merge/rebase) regardless of author', () => {
      const entries = parseReflogOutput(mixedLines, '/repo', '2026-04-22', 'me@example.com');
      const subjects = entries.map((e) => e.subject);
      expect(subjects).toContain('checkout: moving from main to x');
      expect(subjects).toContain('merge feature/x: msg');
      expect(subjects).toContain('rebase -i (finish): returning to refs/heads/main');
    });

    it('fails closed on empty email — drops all commits rather than leaking other authors', () => {
      const entries = parseReflogOutput(mixedLines, '/repo', '2026-04-22', '');
      const types = entries.map((e) => e.subject);
      // Every commit variant must be dropped.
      expect(types.some((s) => /^commit[:\s(]/.test(s))).toBe(false);
      // Non-commit events still survive.
      expect(types).toContain('checkout: moving from main to x');
    });

    it('skips the author filter entirely when email is undefined (test-path escape hatch)', () => {
      const entries = parseReflogOutput(mixedLines, '/repo', '2026-04-22');
      expect(entries).toHaveLength(7);
    });
  });

  it('does not leak parser intermediates (selector, authorName, authorEmail) onto entries', () => {
    const raw = fs.readFileSync(FIXTURES_PATH, 'utf8');
    const [entry] = parseReflogOutput(raw, '/repo', FIXTURE_DATE);
    expect(entry).toBeDefined();
    expect(Object.keys(entry ?? {})).toEqual(
      expect.arrayContaining(['hash', 'subject', 'timestamp', 'repoPath']),
    );
    expect(entry).not.toHaveProperty('selector');
    expect(entry).not.toHaveProperty('authorName');
    expect(entry).not.toHaveProperty('authorEmail');
  });
});
