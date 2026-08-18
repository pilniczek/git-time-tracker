import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { dayRange } from '../src/config';
import { OUTPUT_FORMATS, extensionFor } from '../src/output';
import { REPORTS_DIR, reportFileName, resolveReportPath, writeReport } from '../src/report';

const RANGE = { from: '2026-04-01', to: '2026-04-21' };

describe('reportFileName', () => {
  it('names single-day reports after the day', () => {
    expect(reportFileName(dayRange('2026-04-22'), 'markdown')).toBe('2026-04-22.md');
  });

  it('names range reports after both bounds', () => {
    expect(reportFileName(RANGE, 'markdown')).toBe('2026-04-01_2026-04-21.md');
  });

  it('takes the extension from the format registry', () => {
    for (const format of OUTPUT_FORMATS) {
      expect(reportFileName(RANGE, format)).toMatch(new RegExp(`\\.${extensionFor(format)}$`));
    }
  });
});

describe('resolveReportPath', () => {
  it('puts a bare --out in the gitignored reports directory', () => {
    expect(resolveReportPath('', RANGE, 'markdown')).toBe(
      path.join(REPORTS_DIR, '2026-04-01_2026-04-21.md'),
    );
  });

  it('resolves an explicit relative path against the working directory', () => {
    expect(resolveReportPath('out/week.md', RANGE, 'markdown')).toBe(
      path.resolve(process.cwd(), 'out/week.md'),
    );
  });

  it('keeps an absolute path as given', () => {
    const absolute = path.join(os.tmpdir(), 'week.md');
    expect(resolveReportPath(absolute, RANGE, 'markdown')).toBe(absolute);
  });
});

describe('writeReport', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-time-tracker-report-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates missing directories and appends a trailing newline', () => {
    const file = path.join(tmpDir, 'nested', 'week.md');
    writeReport(file, 'content');
    expect(fs.readFileSync(file, 'utf8')).toBe('content\n');
  });

  it('does not double the trailing newline', () => {
    const file = path.join(tmpDir, 'week.md');
    writeReport(file, 'content\n');
    expect(fs.readFileSync(file, 'utf8')).toBe('content\n');
  });

  it('drops a self-ignoring .gitignore into the reports directory', () => {
    const created = !fs.existsSync(REPORTS_DIR);
    writeReport(path.join(REPORTS_DIR, 'test-write.md'), 'content');
    const ignore = fs.readFileSync(path.join(REPORTS_DIR, '.gitignore'), 'utf8');
    expect(ignore).toContain('*');
    fs.rmSync(path.join(REPORTS_DIR, 'test-write.md'));
    if (created) fs.rmSync(REPORTS_DIR, { recursive: true, force: true });
  });
});
