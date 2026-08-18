# git-time-tracker

A daily work timeline built from git history across multiple repositories — retroactive, local, zero upfront setup.

Tracks commits (including amends), branch checkouts, merges, and rebases by reading `git reflog`. Works on any existing repository; no hooks or configuration required before you start using it.

## Requirements

- Node.js 24+ (managed via `.nvmrc` / `nvm`)
- Git in your `PATH`
- `git config user.email` set (global or per-repo) — the timeline is scoped to *your* commits, so the tool refuses to analyze reflogs without one. Set it once with `git config --global user.email "you@example.com"`.

## Installation

```sh
npm install
npm run build
npm link          # makes git-time-tracker available globally
```

## First-time setup

Run the interactive wizard once:

```sh
git-time-tracker --init
```

It will ask you for the root directories that contain your git repositories, write a config file, and run discovery automatically. After that, the tool is ready to use.

### WSL

Install and run the tool from **inside WSL** — not native Windows. You can mix Linux-native and Windows-side root directories, because WSL mounts Windows drives under `/mnt/`:

- Linux-native: `/home/<user>/Projects_ubuntu`
- Windows through WSL: `/mnt/c/Users/<user>/Projects_win`

In the timeline output, `/mnt/c/Users/...` paths are rendered as `C:\Users\...` for readability; the config file keeps them in `/mnt/` form.

## Usage

```sh
# Today's timeline (default)
git-time-tracker

# Specific date
git-time-tracker --date 2026-04-21

# Date range, grouped per day
git-time-tracker --from 2026-04-01 --to 2026-04-21

# Everything since a date (ends today)
git-time-tracker --from 2026-04-01

# Write the result to a gitignored file instead of stdout
git-time-tracker --from 2026-04-01 --to 2026-04-21 --out

# Interactive browser UI (date picker, repo filters)
git-time-tracker --ui

# UI opened on a specific day
git-time-tracker --ui --date 2026-04-21

# Machine-readable output
git-time-tracker --format json
git-time-tracker --format csv
git-time-tracker --format markdown

# Disable ANSI colours
git-time-tracker --no-color
```

## All options

| Flag | Description |
|---|---|
| `--date <YYYY-MM-DD>` | Single date to query (default: today) |
| `--from <YYYY-MM-DD>` | Range start, inclusive. Without `--to`, the range ends today |
| `--to <YYYY-MM-DD>` | Range end, inclusive. Requires `--from` |
| `--out [path]` | Write the result to a file instead of stdout (see [Report files](#report-files)) |
| `--ui` | Open interactive web UI in browser, starting on `--date` / `--from` (default: today) |
| `--port <n>` | Port for web server (default: `3456`) |
| `--format <fmt>` | `table` (default), `json`, `csv`, or `markdown` |
| `--no-color` | Disable ANSI colours |
| `--discover` | Scan `roots[]` for git repositories and save them to config |
| `--dir <path>` | Add a root directory for this invocation (can be repeated) |
| `--init` | Interactive setup wizard (runs `--discover` automatically) |
| `--help` | Show usage |

## Date ranges

`--from` / `--to` are both inclusive. `--from` on its own means "since that date", ending today.

`--date` is shorthand for a one-day range and cannot be combined with `--from` / `--to` - the tool errors out instead of guessing which one wins. Malformed or calendar-invalid dates (`2026-02-30`, `22-04-2026`) are rejected too.

In range mode, `table` and `markdown` output is grouped per day, with a per-day event count and a grand total that also reports how many days actually had activity:

```text
Git Time Tracker — 2026-04-20 .. 2026-04-22
═══════════════════════════════════════════════════════════════════════════════════════
 TIME     REPOSITORY                   TYPE                DETAIL
───────────────────────────────────────────────────────────────────────────────────────
── 2026-04-20 Mon ─────────────────────────────────────────────────────────────────────
 09:12    my-app                       CHECKOUT            feature/auth
 09:45    my-app                       COMMIT              Add JWT middleware
 2 events across 1 repository

── 2026-04-21 Tue ─────────────────────────────────────────────────────────────────────
  No events.

── 2026-04-22 Wed ─────────────────────────────────────────────────────────────────────
 10:31    api-service                  COMMIT              Fix rate limiter config
 1 event across 1 repository
───────────────────────────────────────────────────────────────────────────────────────
 3 events across 2 repositories, 2 active days of 3
```

Days with no activity are printed explicitly - in a timesheet, an empty Tuesday is information.

Grouping is driven by the data, not the flags: headings and per-day counts appear whenever the output covers more than one day. A single date therefore reads exactly as it always has - but if a `--date` run happens to contain an event from a neighbouring day (possible when a repository's git offset differs from your machine's), both days get labelled instead of being merged under the requested date.

`markdown` carries the very same fixed-width layout, wrapped in a fenced block so it stays monospace and keeps its column alignment. Only the title is lifted out into a `#` heading:

````markdown
# Git Time Tracker — 2026-04-20 .. 2026-04-22

```text
═══════════════════════════════════════════════════════════════════════════════════════
 TIME     REPOSITORY                   TYPE                DETAIL
───────────────────────────────────────────────────────────────────────────────────────
── 2026-04-20 Mon ─────────────────────────────────────────────────────────────────────
 09:12    my-app                       CHECKOUT            feature/auth
 09:45    my-app                       COMMIT              Add JWT middleware
 2 events across 1 repository

── 2026-04-21 Tue ─────────────────────────────────────────────────────────────────────
  No events.
───────────────────────────────────────────────────────────────────────────────────────
 2 events across 1 repository, 1 active day of 3
```
````

A GFM pipe table was deliberately rejected: it reflows the columns to fit the widest cell and cannot show the day rules, so long branch names make it unreadable. The fenced block is byte-identical to what the terminal prints (minus ANSI colours), which also means both formats are one implementation - `formatMarkdown` embeds the table renderer's own output rather than re-describing the layout.

`json` and `csv` stay flat, since each row already carries its own date. The CSV has a `date` column alongside the full ISO `time`, so a range export pivots per day in a spreadsheet.

## Report files

`--out` writes the rendered result to a file instead of stdout, and prints a one-line confirmation with the path and totals. ANSI colours are always stripped from file output.

Bare `--out` writes into the `reports/` directory of the git-time-tracker checkout:

```text
git-time-tracker/
  reports/                        <- gitignored
    2026-04-01_2026-04-21.md
    2026-04-22.md
```

The file is named after the range (`<from>_<to>.<ext>`), or just the day for a single date. `reports/` is listed in this repository's `.gitignore`, and the tool also drops a `reports/.gitignore` containing `*` on first write - so generated timelines stay out of git even if the package is vendored into a repository whose `.gitignore` it does not control.

Bare `--out` defaults to `--format markdown`. With an explicit path, the format is inferred from the extension (`.md`, `.json`, `.csv`, `.txt`); an explicit `--format` always wins:

```sh
git-time-tracker --from 2026-04-01 --to 2026-04-21 --out ~/timesheets/april.csv
```

`--out` is ignored by `--ui`, which serves the timeline over HTTP instead. `--format` values other than the four listed are rejected with an error rather than silently falling back.

## Config file

The config file is created automatically by `--init`. You can also edit it by hand.

| Platform | Location |
|---|---|
| Windows | `%APPDATA%\git-time-tracker\config.json` |
| macOS / Linux / WSL | `~/.config/git-time-tracker/config.json` |

```json
{
  "roots": [
    "C:\\Users\\<user>\\Projects_win"
  ],
  "repos": [
    "C:\\Users\\<user>\\Projects_win\\api-service",
    "C:\\Users\\<user>\\Projects_win\\my-app"
  ],
  "maxDepth": 5,
  "port": 3456
}
```

`roots` — directories to scan when you run `--discover`.

`repos` — the discovered repository paths. Populated by `--discover`. If empty, the tool exits with a helpful error.

`maxDepth` — how many directory levels deep to look for git repositories (default: `5`).

Run `git-time-tracker --discover` after adding new projects to update `repos`.

## Example output

```text
Git Time Tracker — 2026-04-22
═══════════════════════════════════════════════════════════════════════════════════════
 TIME     REPOSITORY                   TYPE                DETAIL
───────────────────────────────────────────────────────────────────────────────────────
 09:12    my-app                       CHECKOUT            feature/auth
 09:45    my-app                       COMMIT              Add JWT middleware
 10:03    api-service                  CHECKOUT            fix/rate-limit
 10:31    api-service                  COMMIT              Fix rate limiter config
 10:45    api-service                  COMMIT (amend)      Fix rate limiter config + tests
 11:05    my-app                       CHECKOUT (detached) d0b9e0d
 11:20    my-app                       CHECKOUT            main
 11:35    my-app                       COMMIT (merge)      Merge branch 'feature/auth' into main
───────────────────────────────────────────────────────────────────────────────────────
 8 events across 2 repositories
```

The `CHECKOUT` detail shows the **target branch only** — that's the branch you're starting work on. Starting new work implicitly ends the previous work at the preceding timestamp, so the `from` branch carries no information the timeline doesn't already encode.

## Events captured

| Reflog subject | Shown as |
|---|---|
| `commit: <msg>` | `COMMIT` |
| `commit (amend): <msg>` | `COMMIT (amend)` |
| `commit (initial): <msg>` | `COMMIT (initial)` |
| `commit (merge): <msg>` | `COMMIT (merge)` — e.g. committing after resolving a merge conflict |
| `checkout: moving from <A> to <branch>` | `CHECKOUT` |
| `checkout: moving from <A> to <sha>` | `CHECKOUT (detached)` — detached HEAD; detail shows the short SHA |
| `merge <branch>: <msg>` | `MERGE` |
| `rebase -i (finish): returning to refs/heads/<b>` | `REBASE` |

Reset events are excluded — they are internal operations, not work milestones.

### WIP commits

Commits whose message is exactly `WIP` or `wip` have the branch name appended in the detail column so you can tell multiple in-flight branches apart:

```text
 16:02    my-app               COMMIT             WIP (feature/auth)
 17:30    my-app               COMMIT (amend)     WIP (feature/auth)
```

The branch is resolved from the preceding `CHECKOUT` event in the timeline when available, or by looking up the commit in the repo's branches as a fallback.

## Uninstall

Remove the global `npm link` binary created during installation:

```sh
npm run uninstall
```

The script runs `npm unlink -g git-time-tracker` and then prompts before deleting `~/.config/git-time-tracker/` (or `%APPDATA%\git-time-tracker\` on Windows). Pass `--yes` to skip the prompt.

## Development

```sh
# Type-check without building
npm run typecheck

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Build
npm run build

# Run directly (no build step)
npm run dev -- --date 2026-04-22
npm run dev -- --from 2026-04-01 --to 2026-04-22
```

Tests live in `test/` and use Jest + ts-jest. Each module has a dedicated test file (`config`, `discovery`, `events`, `formatter`, `platform`, `reflog`, `report`, `timeline`); `reflog.ts` is tested via `test/fixtures/reflog-samples.txt` (real reflog output samples) without mocking `child_process`.

## How it works

git-time-tracker uses `git log -g` (reflog walk) to read HEAD history for a given day window and author. This is the only way to capture both commits and branch checkouts retroactively without any prior setup — the reflog is always written by Git itself.

The author is resolved automatically from `git config user.email`, so each developer sees only their own activity:

- Commits (`COMMIT`, `COMMIT_AMEND`, `COMMIT_INITIAL`, `COMMIT_MERGE`) are matched against your email — anything authored by someone else (e.g. commits that passed through your HEAD via `git pull` / `git fetch` / `git reset`) is dropped before it reaches the timeline.
- Checkouts, merges, and rebases are never author-filtered: the reflog is local to your clone, so those entries always represent actions you performed yourself.
- If `git config user.email` is empty, analysis paths (`git-time-tracker`, `git-time-tracker --ui`) exit with an error rather than run with the filter disabled.

Timestamps are kept in the local timezone offset reported by Git (`%ai`), matching exactly what you see in `git reflog`.

Discovery (`--discover`) does a one-time recursive scan of your root directories, skipping `node_modules`, `vendor`, `dist`, and other build artifacts, and stops recursing when it finds a `.git` directory. The result is stored in the config file and reused on every subsequent run.
