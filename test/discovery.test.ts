import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { discoverRepos } from '../src/discovery';

function mkdir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function makeGitRepo(p: string): void {
  mkdir(p);
  mkdir(path.join(p, '.git'));
}

describe('discoverRepos', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-time-tracker-disc-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds a git repository at root level', () => {
    makeGitRepo(path.join(tmpDir, 'my-app'));
    const repos = discoverRepos([tmpDir]);
    expect(repos).toHaveLength(1);
    expect(repos[0]).toContain('my-app');
  });

  it('finds repos in subdirectories', () => {
    makeGitRepo(path.join(tmpDir, 'work', 'api'));
    makeGitRepo(path.join(tmpDir, 'work', 'frontend'));
    const repos = discoverRepos([tmpDir]);
    expect(repos).toHaveLength(2);
  });

  it('does not recurse into a found git repo', () => {
    makeGitRepo(path.join(tmpDir, 'outer'));
    // Nested repo inside outer — should not be found
    makeGitRepo(path.join(tmpDir, 'outer', 'nested'));
    const repos = discoverRepos([tmpDir]);
    expect(repos).toHaveLength(1);
    expect(repos[0]).toContain('outer');
  });

  it('skips node_modules directories', () => {
    makeGitRepo(path.join(tmpDir, 'node_modules', 'some-pkg'));
    const repos = discoverRepos([tmpDir]);
    expect(repos).toHaveLength(0);
  });

  it('skips hidden directories', () => {
    makeGitRepo(path.join(tmpDir, '.hidden', 'repo'));
    const repos = discoverRepos([tmpDir]);
    expect(repos).toHaveLength(0);
  });

  it('respects maxDepth', () => {
    // repo is 2 levels deep, maxDepth=1 should not find it
    makeGitRepo(path.join(tmpDir, 'a', 'b'));
    const repos = discoverRepos([tmpDir], 1);
    expect(repos).toHaveLength(0);
  });

  it('deduplicates repos when roots overlap', () => {
    makeGitRepo(path.join(tmpDir, 'repo'));
    const repoPath = path.join(tmpDir, 'repo');
    const repos = discoverRepos([tmpDir, repoPath]);
    expect(repos).toHaveLength(1);
  });

  it('handles multiple roots', () => {
    const rootA = path.join(tmpDir, 'groupA');
    const rootB = path.join(tmpDir, 'groupB');
    makeGitRepo(path.join(rootA, 'repo1'));
    makeGitRepo(path.join(rootB, 'repo2'));
    const repos = discoverRepos([rootA, rootB]);
    expect(repos).toHaveLength(2);
  });

  it('returns empty array when no repos found', () => {
    mkdir(path.join(tmpDir, 'empty-dir'));
    expect(discoverRepos([tmpDir])).toEqual([]);
  });

  it('returns sorted results', () => {
    makeGitRepo(path.join(tmpDir, 'z-repo'));
    makeGitRepo(path.join(tmpDir, 'a-repo'));
    const repos = discoverRepos([tmpDir]);
    expect(repos[0]).toContain('a-repo');
    expect(repos[1]).toContain('z-repo');
  });
});
