import { CliArgsError, type DateRange } from './config';
import { formatCsv, formatJson, formatMarkdown, formatTable } from './formatter';
import type { TimelineEntry } from './timeline';

export type OutputFormat = 'table' | 'json' | 'csv' | 'markdown';

interface FormatSpec {
  /** File extension used when the result is written with `--out`. */
  extension: string;
  render: (entries: TimelineEntry[], range: DateRange, useColor: boolean) => string;
}

/**
 * The one place that knows the set of output formats. Extension lookup, the
 * reverse lookup from a file path, `--format` validation and rendering all read
 * this table, so adding a format is a single entry here.
 */
const FORMATS: Record<OutputFormat, FormatSpec> = {
  table: { extension: 'txt', render: (entries, range, useColor) => formatTable(entries, range, useColor) },
  json: { extension: 'json', render: (entries) => formatJson(entries) },
  csv: { extension: 'csv', render: (entries) => formatCsv(entries) },
  markdown: { extension: 'md', render: (entries, range) => formatMarkdown(entries, range) },
};

export const OUTPUT_FORMATS = Object.keys(FORMATS) as OutputFormat[];

export const DEFAULT_STDOUT_FORMAT: OutputFormat = 'table';
/** Files are read, not watched scroll past — markdown is the better default. */
export const DEFAULT_FILE_FORMAT: OutputFormat = 'markdown';

export function isOutputFormat(value: string): value is OutputFormat {
  return Object.prototype.hasOwnProperty.call(FORMATS, value);
}

/** Unknown `--format` values fail loudly instead of silently falling back. */
export function parseFormat(value: string): OutputFormat {
  if (!isOutputFormat(value)) {
    throw new CliArgsError(`--format must be one of: ${OUTPUT_FORMATS.join(', ')} (got "${value}").`);
  }
  return value;
}

export function extensionFor(format: OutputFormat): string {
  return FORMATS[format].extension;
}

/** Reverse of `extensionFor`, derived from the same table. */
export function formatFromPath(filePath: string): OutputFormat | undefined {
  const match = /\.([a-z]+)$/i.exec(filePath);
  if (!match) return undefined;
  const extension = match[1].toLowerCase();
  return OUTPUT_FORMATS.find((format) => extensionFor(format) === extension);
}

/**
 * `--format` wins; otherwise stdout gets a table, an explicit `--out <path>`
 * follows its extension, and a bare `--out` gets markdown.
 */
export function resolveFormat(explicit: string | undefined, out: string | undefined): OutputFormat {
  if (explicit !== undefined) return parseFormat(explicit);
  if (out === undefined) return DEFAULT_STDOUT_FORMAT;
  return formatFromPath(out) ?? DEFAULT_FILE_FORMAT;
}

export function renderTimeline(
  entries: TimelineEntry[],
  range: DateRange,
  format: OutputFormat,
  useColor: boolean,
): string {
  return FORMATS[format].render(entries, range, useColor);
}
