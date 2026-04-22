import { annotateCommitBranches, buildTimeline, buildRepoDisplayNames } from '../src/timeline';
import type { NormalizedEvent } from '../src/events';

function event(isoTime: string, repo = 'repo-a'): NormalizedEvent {
  return {
    type: 'COMMIT',
    timestamp: new Date(isoTime),
    repoName: repo,
    repoPath: `/projects/${repo}`,
    hash: 'abc123',
    message: 'test',
  };
}

describe('buildTimeline', () => {
  it('returns events sorted ascending by timestamp', () => {
    const events = [
      event('2026-04-22T11:00:00Z'),
      event('2026-04-22T09:00:00Z'),
      event('2026-04-22T10:00:00Z'),
    ];
    const result = buildTimeline(events);
    expect(result[0]?.timestamp.toISOString()).toBe('2026-04-22T09:00:00.000Z');
    expect(result[1]?.timestamp.toISOString()).toBe('2026-04-22T10:00:00.000Z');
    expect(result[2]?.timestamp.toISOString()).toBe('2026-04-22T11:00:00.000Z');
  });

  it('returns empty array for empty input', () => {
    expect(buildTimeline([])).toEqual([]);
  });

  it('does not mutate the original array', () => {
    const events = [event('2026-04-22T11:00:00Z'), event('2026-04-22T09:00:00Z')];
    const original = [...events];
    buildTimeline(events);
    expect(events[0]?.timestamp).toEqual(original[0]?.timestamp);
  });

  it('sorts events across multiple repositories', () => {
    const events = [
      event('2026-04-22T10:30:00Z', 'repo-b'),
      event('2026-04-22T09:15:00Z', 'repo-a'),
      event('2026-04-22T11:00:00Z', 'repo-a'),
    ];
    const result = buildTimeline(events);
    expect(result.map((e) => e.repoName)).toEqual(['repo-a', 'repo-b', 'repo-a']);
  });

  it('handles events with identical timestamps', () => {
    const events = [
      event('2026-04-22T10:00:00Z', 'repo-a'),
      event('2026-04-22T10:00:00Z', 'repo-b'),
    ];
    expect(buildTimeline(events)).toHaveLength(2);
  });
});

describe('annotateCommitBranches', () => {
  const base = (overrides: Partial<NormalizedEvent>): NormalizedEvent => ({
    type: 'COMMIT',
    timestamp: new Date('2026-04-22T10:00:00Z'),
    repoName: 'repo',
    repoPath: '/projects/repo',
    hash: 'h',
    ...overrides,
  });

  it('propagates the last CHECKOUT target branch to subsequent commits in the same repo', () => {
    const events: NormalizedEvent[] = [
      base({
        type: 'CHECKOUT',
        timestamp: new Date('2026-04-22T09:00:00Z'),
        toBranch: 'feature/auth',
      }),
      base({ timestamp: new Date('2026-04-22T10:00:00Z'), message: 'WIP' }),
    ];
    const result = annotateCommitBranches(events);
    expect(result[1]?.branch).toBe('feature/auth');
  });

  it('isolates branch state per repo', () => {
    const events: NormalizedEvent[] = [
      base({
        repoPath: '/projects/a',
        type: 'CHECKOUT',
        timestamp: new Date('2026-04-22T09:00:00Z'),
        toBranch: 'feat-a',
      }),
      base({
        repoPath: '/projects/b',
        timestamp: new Date('2026-04-22T10:00:00Z'),
        message: 'WIP',
      }),
    ];
    const result = annotateCommitBranches(events);
    // repo-b never had a checkout → no shell fallback for non-WIP / different repo
    expect(result[1]?.branch).toBeUndefined();
  });

  it('leaves non-commit, non-checkout events unchanged', () => {
    const events: NormalizedEvent[] = [
      base({ type: 'REBASE', branch: 'main', message: undefined }),
    ];
    expect(annotateCommitBranches(events)[0]?.branch).toBe('main');
  });

  it('clears the tracked branch on CHECKOUT_DETACHED so subsequent non-WIP commits are not mis-labelled', () => {
    const events: NormalizedEvent[] = [
      base({
        type: 'CHECKOUT',
        timestamp: new Date('2026-04-22T08:00:00Z'),
        toBranch: 'main',
      }),
      base({
        type: 'CHECKOUT_DETACHED',
        timestamp: new Date('2026-04-22T09:00:00Z'),
        toBranch: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      }),
      base({
        type: 'COMMIT',
        timestamp: new Date('2026-04-22T10:00:00Z'),
        message: 'fixing things in detached head',
      }),
    ];
    const result = annotateCommitBranches(events);
    // Non-WIP commit in detached HEAD should NOT inherit "main".
    expect(result[2]?.branch).toBeUndefined();
  });
});

describe('buildRepoDisplayNames', () => {
  it('uses bare repo name for a single root', () => {
    const map = buildRepoDisplayNames(
      ['/work/my-apps/api', '/work/my-apps/web'],
      ['/work/my-apps'],
    );
    expect(map.get('/work/my-apps/api')).toBe('api');
    expect(map.get('/work/my-apps/web')).toBe('web');
  });

  it('uses parent/repo for multiple roots without collision', () => {
    const map = buildRepoDisplayNames(
      ['/work/projects-a/api', '/work/projects-b/web'],
      ['/work/projects-a', '/work/projects-b'],
    );
    expect(map.get('/work/projects-a/api')).toBe('projects-a/api');
    expect(map.get('/work/projects-b/web')).toBe('projects-b/web');
  });

  it('uses full path when short names collide across roots', () => {
    const map = buildRepoDisplayNames(
      ['/app/my-apps/first-project', '/friend/my-apps/first-project'],
      ['/app/my-apps', '/friend/my-apps'],
    );
    expect(map.get('/app/my-apps/first-project')).toBe('/app/my-apps/first-project');
    expect(map.get('/friend/my-apps/first-project')).toBe('/friend/my-apps/first-project');
  });

  it('only promotes colliding repos to full path — non-colliding stay short', () => {
    const map = buildRepoDisplayNames(
      ['/app/my-apps/shared', '/friend/my-apps/shared', '/app/my-apps/unique'],
      ['/app/my-apps', '/friend/my-apps'],
    );
    expect(map.get('/app/my-apps/shared')).toBe('/app/my-apps/shared');
    expect(map.get('/friend/my-apps/shared')).toBe('/friend/my-apps/shared');
    // non-colliding: prefix is root basename "my-apps", not immediate parent
    expect(map.get('/app/my-apps/unique')).toBe('my-apps/unique');
  });

  it('uses root basename even when repo is nested in a sub-folder within the root', () => {
    // e.g. root = Projects_ubuntu, repo lives at Projects_ubuntu/DISE/cis-app
    const map = buildRepoDisplayNames(
      ['/home/Projects_ubuntu/DISE/cis-app', '/home/Projects_win/cis-app'],
      ['/home/Projects_ubuntu', '/home/Projects_win'],
    );
    expect(map.get('/home/Projects_ubuntu/DISE/cis-app')).toBe('Projects_ubuntu/cis-app');
    expect(map.get('/home/Projects_win/cis-app')).toBe('Projects_win/cis-app');
  });

  it('returns empty map for empty repo list', () => {
    expect(buildRepoDisplayNames([], ['/work/projects']).size).toBe(0);
  });
});
