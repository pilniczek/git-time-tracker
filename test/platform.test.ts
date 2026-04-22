import * as os from 'node:os';
import * as path from 'node:path';
import { configDirFor, configFilePath, wslPathToWindows } from '../src/platform';

// wslPathToWindows is the pure, OS-agnostic piece of displayPath — the one
// with actual logic worth testing. displayPath itself is a one-liner gated
// by the runtime isWSL flag and is covered implicitly by integration use.

describe('wslPathToWindows', () => {
  it('converts /mnt/<drive>/... to <DRIVE>:\\... with backslash separators', () => {
    expect(wslPathToWindows('/mnt/c/Users/<user>/Projects')).toBe('C:\\Users\\<user>\\Projects');
    expect(wslPathToWindows('/mnt/d/Work/repo')).toBe('D:\\Work\\repo');
  });

  it('returns paths that do not start with /mnt/ unchanged', () => {
    expect(wslPathToWindows('/home/<user>/projects')).toBe('/home/<user>/projects');
    expect(wslPathToWindows('C:\\Users\\<user>\\Projects')).toBe('C:\\Users\\<user>\\Projects');
  });
});

describe('configDirFor', () => {
  it('places the dir under ~/.config/<name> on non-Windows platforms', () => {
    if (process.platform === 'win32') return;
    expect(configDirFor('git-time-tracker')).toBe(
      path.join(os.homedir(), '.config', 'git-time-tracker'),
    );
  });
});

describe('configFilePath', () => {
  // Guards against silent drift between the canonical platform path logic
  // and any caller (e.g. scripts/uninstall.ts) that constructs its own path.
  it('equals configDirFor("git-time-tracker") joined with config.json', () => {
    expect(configFilePath).toBe(path.join(configDirFor('git-time-tracker'), 'config.json'));
  });
});
