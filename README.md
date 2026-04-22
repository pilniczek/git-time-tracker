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

# Interactive browser UI (date picker, repo filters)
git-time-tracker --ui

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
| `--date <YYYY-MM-DD>` | Date to query (default: today) |
| `--ui` | Open interactive web UI in browser |
| `--port <n>` | Port for web server (default: `3456`) |
| `--format <fmt>` | `table` (default), `json`, `csv`, or `markdown` |
| `--no-color` | Disable ANSI colours |
| `--discover` | Scan `roots[]` for git repositories and save them to config |
| `--dir <path>` | Add a root directory for this invocation (can be repeated) |
| `--init` | Interactive setup wizard (runs `--discover` automatically) |
| `--help` | Show usage |

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
```

Tests live in `test/` and use Jest + ts-jest. Each module has a dedicated test file (`config`, `discovery`, `events`, `formatter`, `platform`, `reflog`, `timeline`); `reflog.ts` is tested via `test/fixtures/reflog-samples.txt` (real reflog output samples) without mocking `child_process`.

## How it works

git-time-tracker uses `git log -g` (reflog walk) to read HEAD history for a given day and author. This is the only way to capture both commits and branch checkouts retroactively without any prior setup — the reflog is always written by Git itself.

The author is resolved automatically from `git config user.email`, so each developer sees only their own activity:

- Commits (`COMMIT`, `COMMIT_AMEND`, `COMMIT_INITIAL`, `COMMIT_MERGE`) are matched against your email — anything authored by someone else (e.g. commits that passed through your HEAD via `git pull` / `git fetch` / `git reset`) is dropped before it reaches the timeline.
- Checkouts, merges, and rebases are never author-filtered: the reflog is local to your clone, so those entries always represent actions you performed yourself.
- If `git config user.email` is empty, analysis paths (`git-time-tracker`, `git-time-tracker --ui`) exit with an error rather than run with the filter disabled.

Timestamps are kept in the local timezone offset reported by Git (`%ai`), matching exactly what you see in `git reflog`.

Discovery (`--discover`) does a one-time recursive scan of your root directories, skipping `node_modules`, `vendor`, `dist`, and other build artifacts, and stops recursing when it finds a `.git` directory. The result is stored in the config file and reused on every subsequent run.
