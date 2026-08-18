import type { Config, DateRange } from './config';
import { parseEvents } from './events';
import { readReflog } from './reflog';
import {
  annotateCommitBranches,
  buildRepoDisplayNames,
  buildTimeline,
  type TimelineEntry,
} from './timeline';

export function buildTimelineForRange(config: Config, range: DateRange): TimelineEntry[] {
  const entries = config.repos.flatMap((repoPath) => {
    const raw = readReflog(repoPath, range, config.authorEmail);
    return parseEvents(raw);
  });
  const displayNames = buildRepoDisplayNames(config.repos, config.roots);
  // Seed entries are pre-window CHECKOUTs included only so the annotator
  // can resolve the branch for in-window commits. Drop them before display.
  return annotateCommitBranches(buildTimeline(entries))
    .filter((e) => !e.isSeed)
    .map((e) => ({
      ...e,
      repoName: displayNames.get(e.repoPath) ?? e.repoName,
    }));
}
