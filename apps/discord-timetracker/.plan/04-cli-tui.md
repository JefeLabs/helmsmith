# 04 — CLI & TUI

The user-facing surface is built entirely on the two workspace libs:

- **`@jefelabs/cli-kit`** — `createCli()` owns the command tree, flag parsing,
  and inquirer prompts.
- **`@jefelabs/tui-view-components`** — `runTuiView()` + `AppShell` + organisms
  own the full-screen daily/weekly summary viewer.

## Command surface (commander, via cli-kit)

```ts
// src/index.ts
import { createCli } from '@jefelabs/cli-kit';
import { loadConfig } from './config/load';

const { program } = createCli({
  name: 'timetracker',
  version: '0.1.0',
  description: 'Discord activity time tracker (admin-only)',
  auth: noopAuthProvider, // local v1; swap for agent-auth when hosted
});

program.command('setup').description('interactive first-run config').action(runSetup);
program.command('start').description('run the bot (gateway listener)').action(runBot);
program.command('view').description('open the daily/weekly summary TUI')
  .option('-p, --period <period>', 'daily | weekly', 'daily')
  .option('-d, --date <iso>', 'anchor date (default: today)')
  .action(runViewer);
program.command('report').description('print a summary (non-interactive)')
  .option('--period <period>', 'daily | weekly', 'daily')
  .option('--json', 'machine-readable output')
  .action(runReport);
program.command('link').description('map a Discord user to a GitHub/CI identity').action(runLink);

program.parse();
```

| Command | Mode | Purpose |
|---------|------|---------|
| `setup` | interactive (inquirer) | Wizard: bot token, guild ID, channel IDs, admin role, storage backend, timezone → writes config. |
| `start` | long-running | Connects to the gateway and begins tracking + scheduled Discord summaries. |
| `view` | **TUI** | Full-screen daily/weekly summary browser (your request). |
| `report` | one-shot stdout | Same data as `view` but printed (and `--json` for piping/cron). |
| `link` | interactive | Build the `github↔discord` map used by CI attribution. |

## First-run wizard (`setup`)

Uses inquirer (peer dep of cli-kit) — never hand-edit JSON:

```ts
import { input, password, select } from '@inquirer/prompts';

const token   = await password({ message: 'Discord bot token:' });
const guildId = await input({ message: 'Guild (server) ID:' });
const backend = await select({
  message: 'Storage backend:',
  choices: [{ value: 'sqlite', name: 'SQLite (local file) — recommended for v1' },
            { value: 'dynamodb', name: 'DynamoDB (AWS us-east-1)' }],
});
// …channel IDs, admin role, timezone… → write ./timetracker.config.json (token to .env.bak / secret store)
```

## TUI summary viewer (`view`)

This is the daily/weekly viewer. It reads through `ReportService` (never storage
directly) and renders with the atomic-design organisms.

```ts
// src/tui/runViewer.ts
import { runTuiView } from '@jefelabs/tui-view-components/pages';
import { AppShell } from '@jefelabs/tui-view-components/templates';
import { SummaryView } from './SummaryView';

export async function runViewer(opts: { period: 'daily' | 'weekly'; date?: string }, deps: { reports: ReportService }) {
  await runTuiView({
    render: () => (
      <AppShell title="Time Tracker">
        <SummaryView period={opts.period} date={opts.date} reports={deps.reports} />
      </AppShell>
    ),
  });
}
```

```tsx
// src/tui/SummaryView.tsx  (sketch)
import { Table } from '@jefelabs/tui-view-components/organisms';
import { Menu } from '@jefelabs/tui-view-components/organisms';
import { useKeybinding } from '@jefelabs/tui-view-components/keyboard';

export function SummaryView({ period, date, reports }) {
  // load rows from reports.daily(date) / reports.weekly(date)
  // columns: user, online (h), startedAt, endedAt, CI, engagement
  useKeybinding({ key: 'd', label: 'Daily',  onPress: () => setPeriod('daily') });
  useKeybinding({ key: 'w', label: 'Weekly', onPress: () => setPeriod('weekly') });
  // Table master/detail → drill into one user's day on Enter (UserDetailView)
  return <Table columns={COLUMNS} rows={rows} /* sort, focus, master/detail */ />;
}
```

What the TUI shows:

- **Daily view** — one row per tracked user for the chosen date: online hours
  (≈ `presence.online × 5min`), start-of-day time, end-of-day time, CI count,
  engagement count. Sortable columns (the `Table` organism supports sort +
  focus + master/detail out of the box).
- **Weekly view** — same users, aggregated across the 7-day window: total online
  hours, days active, total CI, total engagement, plus a per-day sparkline-ish
  breakdown in the detail pane.
- **Navigation** — `Menu`/keybindings to switch daily↔weekly, page dates
  (←/→), and Enter to drill into a user's detail (`UserDetailView`).
- **Theme** — inherits the ecosystem theme via `AppShell`/`useTheme`; no custom
  styling needed.

## ReportService — the shared read model

```ts
// src/reports/ReportService.ts
export class ReportService {
  constructor(private storage: StorageAdapter, private tz: string) {}

  async daily(date: ISODate): Promise<DailySummary> {
    const rows = await this.storage.listDay(date);
    return { date, users: rows.map(toUserRow) };
  }
  async weekly(anchor: ISODate): Promise<WeeklySummary> {
    const { from, to } = weekWindow(anchor, this.tz);
    const rows = await this.storage.listRange(from, to);
    return aggregateByUser(from, to, rows);
  }
}
```

Both the **Discord scheduled summary** (pushed to the admin channel by the bot)
and the **TUI viewer** call these two methods. One read model, two renderers —
so daily/weekly numbers can never disagree between Discord and the TUI.
