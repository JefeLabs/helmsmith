import type { UserWeekRepoRecord } from "../types/schema.js";
import { rollup } from "./engine.js";

export interface LeaderboardEntry {
  rank: number;
  member: string;
  team: string;
  org: string;
  orgType: "core" | "consultant";
  value: number;
  filetype: {
    app: number;
    test: number;
    config: number;
    storybook: number;
  };
}

export interface LeaderboardColumn {
  title: string;
  metric: "all" | "app" | "test" | "config" | "storybook";
  entries: LeaderboardEntry[];
}

const COLUMN_DEFS: Array<{ title: string; metric: LeaderboardColumn["metric"] }> = [
  { title: "Overall", metric: "all" },
  { title: "App", metric: "app" },
  { title: "Test", metric: "test" },
  { title: "Config", metric: "config" },
];

/**
 * Compute leaderboard columns from records within a week window.
 *
 * Steps:
 * 1. Filter records to the given weeks
 * 2. Rollup by member to get per-member totals with filetype breakdown
 * 3. For each category (all, app, test, config): sort descending, take top N
 * 4. Return 4 columns
 */
export function computeLeaderboard(
  records: UserWeekRepoRecord[],
  weeks: string[],
  topN: number = 5,
): LeaderboardColumn[] {
  // Step 1: filter to the week window
  const weekSet = new Set(weeks);
  const filtered = records.filter((r) => weekSet.has(r.week));

  if (filtered.length === 0) {
    return COLUMN_DEFS.map((def) => ({
      title: def.title,
      metric: def.metric,
      entries: [],
    }));
  }

  // Step 2: rollup by member
  const rolled = rollup(filtered, (r) => r.member);

  // Build a lookup for member metadata (team, org, orgType).
  // Use the first record found for each member.
  const memberMeta = new Map<
    string,
    { team: string; org: string; orgType: "core" | "consultant" }
  >();
  for (const r of filtered) {
    if (!memberMeta.has(r.member)) {
      memberMeta.set(r.member, {
        team: r.team,
        org: r.org,
        orgType: r.orgType,
      });
    }
  }

  // Build a flat list of per-member summaries
  interface MemberSummary {
    member: string;
    team: string;
    org: string;
    orgType: "core" | "consultant";
    total: number;
    app: number;
    test: number;
    config: number;
    storybook: number;
  }

  const summaries: MemberSummary[] = [];
  for (const [member, agg] of rolled) {
    const meta = memberMeta.get(member)!;
    summaries.push({
      member,
      team: meta.team,
      org: meta.org,
      orgType: meta.orgType,
      total:
        agg.filetype.app.insertions +
        agg.filetype.app.deletions +
        agg.filetype.test.insertions +
        agg.filetype.test.deletions +
        agg.filetype.config.insertions +
        agg.filetype.config.deletions +
        agg.filetype.storybook.insertions +
        agg.filetype.storybook.deletions,
      app: agg.filetype.app.insertions + agg.filetype.app.deletions,
      test: agg.filetype.test.insertions + agg.filetype.test.deletions,
      config: agg.filetype.config.insertions + agg.filetype.config.deletions,
      storybook: agg.filetype.storybook.insertions + agg.filetype.storybook.deletions,
    });
  }

  // Step 3 & 4: build columns
  return COLUMN_DEFS.map((def) => {
    const valueFn = (s: MemberSummary): number => {
      switch (def.metric) {
        case "all":
          return s.total;
        case "app":
          return s.app;
        case "test":
          return s.test;
        case "config":
          return s.config;
        case "storybook":
          return s.storybook;
      }
    };

    const sorted = [...summaries].sort((a, b) => valueFn(b) - valueFn(a));
    const top = sorted.slice(0, topN);

    const entries: LeaderboardEntry[] = top.map((s, i) => ({
      rank: i + 1,
      member: s.member,
      team: s.team,
      org: s.org,
      orgType: s.orgType,
      value: valueFn(s),
      filetype: {
        app: s.app,
        test: s.test,
        config: s.config,
        storybook: s.storybook,
      },
    }));

    return {
      title: def.title,
      metric: def.metric,
      entries,
    };
  });
}
