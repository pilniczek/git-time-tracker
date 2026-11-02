---
name: git-worklog
description: Turn git-time-tracker output into a calendar-ready worklog table (date, time start, sst-id, description (original commit messages + plain Czech summary), duration) and save it as markdown in reports/. Use whenever the user wants a worklog, timesheet, time report, calendar entries, hours per ticket or "what did I work on" for a day or date range, or pastes git-time-tracker output and asks to turn it into entries - even if they do not name git-time-tracker.
---

# Git worklog

Build calendar entries from git activity. The user copies each row into a calendar, so every row must be a real, non-overlapping time slot with one ticket and a description they can paste as is.

## Workflow

1. Get the date range. Ask only if the user gave none. A single day is fine (`--from` alone).
2. Read the day plans:

   ```sh
   node .claude/skills/git-worklog/scripts/worklog.mts sessions --from 2026-10-12 --to 2026-10-29
   ```

   Run it from the repository root. It calls the built tracker (`dist/index.js`, run `npm run build` if missing), converts times to local time, keeps only work commits (see Time model) and prints one plan per work day: a header with the day start, lunch, end and any carried WIP, then blocks of consecutive time per ticket (`block <start> | <hours> | <ticket> | <commits>`), then `ASK` lines. Each commit line shows the ticket and where it came from: `(commit)`, `(branch)`, `(none)` or `(wip)`. `SPLIT` marks a block over 4 h, `FOLD` a block that rounds to 0 h.

   The working hours live in the `worklog` section of the tracker's own config file (`~/.config/git-time-tracker/config.json`, `%APPDATA%\git-time-tracker\config.json` on Windows), next to its repos, so each user has one config. `git-time-tracker --init` sets it up. After that the user edits the file directly, so when hours change, tell them which key to edit instead of running a command:

   ```json
   "worklog": {
     "dayBoundary": "05:00",
     "default": { "start": "08:00", "lunch": { "start": "12:00", "minutes": 30 } },
     "days": { "mon": { "start": "07:00" }, "wed": { "lunch": { "start": "12:00", "minutes": 90 } } }
   }
   ```

   `days` overrides `default` per weekday (`mon`..`sun`), field by field; `default` is optional when every working weekday is listed. If the script exits with `config missing` (the user skipped the skill during `--init`), ask for their usual start time and lunch (start and length) in one question and add them to the file as the message shows. The `config` command it also prints is the fallback when editing the file is not possible. Never put one person's hours into the skill. Each day header shows the start and lunch it used, so the user can spot a day that did not follow the pattern.

   A work day runs from one `dayBoundary` to the next (default `05:00`), so night work after midnight belongs to the evening it started: its weekday hours apply and it stays in that day's plan. Times on the next calendar date show that date in brackets, e.g. `00:40 (2026-10-27)`. `--from`/`--to` select work days, so the night after `--to` is included and the night before `--from` is not.

   If the user pasted tracker output instead, apply the same rules to the paste by hand.
3. Resolve every `ASK` line before building entries. Ask all of them in one batch, since the user answers from memory or their calendar:
   - `ASK start`: the first commit landed before the configured start, so the real start is unknown. Ask when work started that day. Never guess it.
   - `ASK gap`: over 2 h passed between two commits. Ask whether it was a meeting or a break (for example going home and coming back in the evening) and when.
   - `ASK break`: a commit falls inside a break the user gave, so the break range is wrong. Ask for the correct range.
   - `ASK wip`: a WIP commit has no later non-WIP commit on its branch. Ask what it was about.

   Rerun `sessions` with the answers: `--starts 2026-10-13=06:30,...`, `--meetings 2026-10-12=09:00-10:30,...`, `--breaks 2026-10-26=16:00-21:30,...` (a date can repeat; dates are work days, so a range after midnight goes under the evening's date) and, when the user says lunch was different that day, `--lunches 2026-10-14=13:00/45` (start/minutes). A gap the user calls plain work stays as is; do not ask about it again.
4. Turn the blocks into entries using the rules below.
5. Write the entries to a JSON file in the scratchpad and render:

   ```sh
   node .claude/skills/git-worklog/scripts/worklog.mts render --from 2026-10-12 --to 2026-10-29 --entries <scratchpad>/entries.json
   ```

   Entry shape: `{"date": "2026-10-12", "start": "10:45", "sst": "SST-10746", "original": "...", "cs": "...", "hours": 3.5}`. The script rejects blocks over 4 h, non-quarter starts or durations, overlaps, unsorted rows, missing paragraphs and repeated Czech descriptions (Meeting rows excepted). Fix what it reports and rerun. It splits an entry that crosses midnight into two rows, one per calendar date, and appends `(část 1)` and `(část 2)` to the Czech paragraph, so write such an entry once with its real start date. On success it writes `reports/worklog-<from>_<to>.md` (`reports/worklog-<date>.md` for one day) and prints the entry count and total.
6. Reply with the table (same columns as the file), the total in hours, the file path, and a short list of judgment calls the user should check.

## Rules

**Ticket ID.** A ticket in the commit message wins over the ticket in the branch name. For example, a fixup committed on branch `SST-10851/...` with message `SST-10707: ...` is SST-10707. Use the branch ticket only when the block has no commit with a ticket. Work with no ticket anywhere (release bumps, doc commits without an ID) gets `n/a`. Keep `SST-0000` as written; it is a real "no ticket" code the team uses.

**One ticket per entry, merged.** Merge all work on one ticket within a session into one entry with one description. Do not create a row per commit.

**Time model.** A commit closes work: the time from the previous commit up to a commit belongs to that commit's ticket. The day's first commit takes the time from the day start (configured, or the user's answer to `ASK start`) and the day ends at its last commit. The script does this split; your job is to turn its blocks into calendar rows.
- Only commits are work. Checkouts, merges, rebases and detached checkouts never close time, because switching branches is not work done.
- Squashing is not work. It finishes the original change, so it closes no time and gets no "history cleanup" wording. The script drops `TMP` commits, amends that land within 2 min of another amend in the same repo (autosquash) and commits that repeat an earlier commit message in the same repo (branch rewrites), and lists them under `excluded as squash/replay`. Treat any remaining commit that only restates an earlier change in new words (for example on a `rewrite/*` branch) the same way: fold its block into the neighbouring block of the change it restates. A lone amend with real edits stays work. When an excluded amend rewords a commit to a different ticket, log the earlier work under the new ticket, because the final commit message decides the ticket.
- `fixup!` commits are work: count their time, but describe them in the entry of the change they fix (see Descriptions).
- WIP commits are work in progress on the change committed next. The script links each `WIP` commit to the next non-WIP commit in the same repo and on the same branch, takes that commit's ticket and prints the link as `WIP => <date> <time> <subject>`. When a day ends with a WIP commit, the next morning up to the first non-WIP commit finishes that work (`continues WIP` in the day header). Describe the change once, in the entry where it was finished. `ASK wip` means the branch has no later non-WIP commit, so ask the user what the WIP was about.

**Lunch.** A block that spans lunch stays one entry: it keeps its start and its duration drops by the lunch length. The script already does this.

**Meetings.** Each meeting the user confirms becomes its own entry with `sst` `n/a`, `original` `Meeting` and `cs` `Schůzka`. The script prints it as `n/a meeting`. The time left in the gap goes to the commit that closes it. A break the user confirms is time off: it gets no entry, and work resumes when it ends.

**One ticket per entry, merged.** Merge all work on one ticket into one entry with one description. Do not create a row per commit.

**Interleaved tickets.** Blocks alternate when the user switched tickets often. Fold `FOLD` blocks and other blocks of 15 min or so into the dominant neighbour, so the calendar is not full of 15-minute rows, and list notable folds as judgment calls. Entries must not overlap, because the user cannot be in two calendar entries at once.

**Block size.** The script rounds block edges to the quarter hour. No entry is longer than 4 h: split a `SPLIT` block at a commit near the middle, and name the later part after what was done after that commit. Entries use real calendar dates: a block that starts after midnight is dated the next day, even though it belongs to the evening's plan.

**Descriptions.** The cell holds two paragraphs for two readers. The render script joins them with `<br><br>`.

1. `original` is a reminder for the developer: the commit messages of the entry, unmodified. Copy each distinct commit subject verbatim (emoji, ticket prefix, mixed languages and all) and join them with `; ` in commit order. Leave out a `fixup!` or `amend!` subject when the commit it targets is already listed, since it would only repeat that subject. Squash commits the script excluded never appear. A `WIP` subject never appears either: use the subject of the commit it links to (`=>`), or the user's answer to `ASK wip`, and list it once per entry.
2. `cs` is for people who do not develop software, for example a project manager or client reading the calendar. Write it in plain Czech:
   - Say what changed for the user or the product, not how the code changed. "Aplikace funguje bez internetu: ukládá data, obrázky i videa a po výpadku spojení se sama znovu připojí" instead of "perzistence query cache, offline asset store, network retry".
   - Never leave a code name on its own. Component, file, function, package and script names (`VehicleTitle`, `src/shared`, `readInset`, `yalc`) are either replaced by what they are ("nadpis s názvem vozu") or kept with that explanation next to them.
   - Never write a bare "opravy". Say what was fixed and where: "opravy vzhledu na tabletech", "oprava zobrazení cen v detailu vozu".
   - Use Czech words throughout, no developer English ("gating buildu", "bump", "remount"). Product and brand names stay as they are (DISE, Laura, Figma, Google Maps), and a version number can stay ("verze 0.7.5").
   - A long comma-separated list is fine as long as every item belongs to the entry's ticket. Work that belongs to another ticket goes into that ticket's entry.

The Czech descriptions do not repeat. Each change appears in exactly one entry: the block where its first commit lands. Later fixups and amends of that change go into that same entry, not into a new one. When a ticket spans several blocks, each block lists only the new changes made in it. If a block holds only fixups to earlier work, name what was fixed and where in one short phrase. Do not reuse an earlier row's wording.

**Durations** are decimal hours in quarter steps (0.25, 1.5, 3.75).

## Reply format

```markdown
| date | time start | sst-id | description | duration (h) |
| --- | --- | --- | --- | --- |
| 2026-10-24 | 17:15 | SST-10916 | ✨ SST-10916: add VehicleTitle, QrCode, bodySmall variant and flow2Colors export for cis-web<br><br>Nové prvky knihovny komponent pro web CIS: nadpis s názvem vozu, QR kód, menší styl textu a barvy nového vzhledu Flow2 | 1 |

Total: 116.25 h
```

Then the file path, then judgment calls prefixed with 🙋: folded blocks, split blocks, ticket choices that went against the branch name, and tracker output that ended before the requested range.
