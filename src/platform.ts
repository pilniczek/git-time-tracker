import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const isWindows = process.platform === 'win32';
export const isMac = process.platform === 'darwin';

export const isWSL = (() => {
  try {
    const version = fs.readFileSync('/proc/version', 'utf8');
    return version.toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
})();

export const gitBin = 'git';

export function configDirFor(name: string): string {
  if (isWindows) {
    const appData = process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, name);
  }
  return path.join(os.homedir(), '.config', name);
}

export const configFilePath = path.join(configDirFor('git-time-tracker'), 'config.json');

export function openBrowser(url: string): void {
  if (isWSL) {
    const r = spawnSync('wslview', [url]);
    if (!r.error) return;
    spawnSync('explorer.exe', [url]);
    return;
  }
  if (isMac) {
    spawnSync('open', [url]);
    return;
  }
  if (isWindows) {
    spawnSync('cmd', ['/c', 'start', '', url]);
    return;
  }
  // Linux
  const r = spawnSync('xdg-open', [url]);
  if (r.error) {
    console.log(`Open in your browser: ${url}`);
  }
}

/**
 * Converts /mnt/c/Users/... to C:\Users\... . Pure — exported so it can be
 * unit-tested directly on any OS without faking the isWSL flag.
 */
export function wslPathToWindows(p: string): string {
  if (!p.startsWith('/mnt/')) return p;
  const withoutMnt = p.slice(5);
  const driveLetter = withoutMnt[0]?.toUpperCase() ?? '';
  const rest = withoutMnt.slice(1).replace(/\//g, '\\');
  return `${driveLetter}:${rest}`;
}

export function displayPath(absolutePath: string): string {
  return isWSL ? wslPathToWindows(absolutePath) : absolutePath;
}
