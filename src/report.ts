import * as fs from 'node:fs';
import * as path from 'node:path';
import { isSingleDay, type DateRange } from './config';
import { extensionFor, type OutputFormat } from './output';
import { packageRoot } from './platform';

export const REPORTS_DIR = path.join(packageRoot, 'reports');

/** Written into `reports/` so the directory ignores itself even if the package
 *  is vendored into a repo whose .gitignore we don't control. */
const SELF_IGNORE = '# Generated timelines — never committed.\n*\n!.gitignore\n';

export function reportFileName(range: DateRange, format: OutputFormat): string {
  const stem = isSingleDay(range) ? range.from : `${range.from}_${range.to}`;
  return `${stem}.${extensionFor(format)}`;
}

/**
 * Resolves `--out`: an empty value (bare `--out`) means the default location in
 * `reports/`, an explicit value is used verbatim — absolute, or relative to the
 * directory the command was run from.
 */
export function resolveReportPath(out: string, range: DateRange, format: OutputFormat): string {
  if (out.trim() === '') {
    return path.join(REPORTS_DIR, reportFileName(range, format));
  }
  return path.resolve(process.cwd(), out);
}

export function writeReport(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  if (dir === REPORTS_DIR) {
    const ignoreFile = path.join(dir, '.gitignore');
    if (!fs.existsSync(ignoreFile)) {
      fs.writeFileSync(ignoreFile, SELF_IGNORE, 'utf8');
    }
  }
  fs.writeFileSync(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}
