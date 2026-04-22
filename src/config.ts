import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { configFilePath } from './platform';

export interface ConfigFile {
  roots: string[];
  repos?: string[];
  maxDepth?: number;
  port?: number;
}

export interface Config {
  roots: string[];
  repos: string[];
  date: string;
  authorEmail: string;
  maxDepth: number;
  port: number;
  configPath: string;
}

export interface CliArgs {
  date?: string;
  dir?: string | string[];
  port?: number;
  ui?: boolean;
  discover?: boolean;
  init?: boolean;
  format?: string;
  color?: boolean;
  help?: boolean;
  _: string[];
}

export function getTodayDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getGitAuthorEmail(): string {
  const result = spawnSync('git', ['config', 'user.email'], { encoding: 'utf8' });
  if (result.status === 0 && result.stdout) {
    return result.stdout.trim();
  }
  return '';
}

export function readConfigFile(filePath: string): ConfigFile {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as ConfigFile;
  } catch {
    return { roots: [] };
  }
}

export function writeConfigFile(filePath: string, data: ConfigFile): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export function loadConfig(args: CliArgs): Config {
  const fileConfig = readConfigFile(configFilePath);

  const cliDirs = args.dir === undefined ? [] : [args.dir].flat();
  const fileRoots = fileConfig.roots ?? [];
  const roots = cliDirs.length > 0 ? [...fileRoots, ...cliDirs] : fileRoots;

  return {
    roots,
    repos: fileConfig.repos ?? [],
    date: args.date ?? getTodayDate(),
    authorEmail: getGitAuthorEmail(),
    maxDepth: fileConfig.maxDepth ?? 5,
    port: args.port ?? fileConfig.port ?? 3456,
    configPath: configFilePath,
  };
}

export function saveRepos(repos: string[], config: Config): void {
  const existing = readConfigFile(config.configPath);
  writeConfigFile(config.configPath, { ...existing, repos });
}
