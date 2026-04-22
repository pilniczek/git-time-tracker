import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readConfigFile, writeConfigFile, getTodayDate } from '../src/config';

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
