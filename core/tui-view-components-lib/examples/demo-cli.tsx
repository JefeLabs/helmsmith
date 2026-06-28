#!/usr/bin/env bun

/**
 * @ecruz165/tui-view-components — interactive component showcase.
 *
 * Run: `bun run examples/demo-cli.tsx`
 *  or: `npm run demo-cli --workspace=@ecruz165/tui-view-components`
 *
 * Layout: top-level horizontal menu of sections; number + label
 * hotkeys jump to a section; Tab/Shift+Tab cycle scenarios within
 * the active section.
 *
 *   1-9     — jump to section N
 *   Tab     — next scenario in active section
 *   ⇧+Tab   — previous scenario
 *   Ctrl+T  — cycle theme · Ctrl+Shift+T toggle dark/light · t open picker
 *   q       — quit
 */

import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { useEffect, useRef, useState } from 'react';
import {
  AppShell,
  Box,
  Button,
  Confirm,
  Heading,
  Input,
  KeybindingsBar,
  Menu,
  type MenuItem,
  Panel,
  SelectList,
  type SelectListItem,
  Span,
  Spinner,
  StatusList,
  type StatusListItem,
  Table,
  type TableColumn,
  type TableHandle,
  TableHelp,
  Text,
  ThemeSwitcher,
  useKeybinding,
  useThemeKeybindings,
} from '../src/index.ts';

// ────────────────────────────────────────────────────────────────────
// Scenario types
// ────────────────────────────────────────────────────────────────────

interface Scenario {
  id: string;
  label: string;
  Component: () => JSX.Element;
}

interface DemoSection {
  id: string;
  label: string;
  scenarios: Scenario[];
}

// ════════════════════════════════════════════════════════════════════
// SECTION: Typography (atoms)
// ════════════════════════════════════════════════════════════════════

function TypographyOverview() {
  return (
    <Panel title="Typography · all variants" padding="md">
      <Box variant="transparent" style={{ flexDirection: 'column', gap: 1 }}>
        <Heading level={1}>Heading level 1</Heading>
        <Heading level={2}>Heading level 2</Heading>
        <Heading level={3}>Heading level 3</Heading>
        <Text>Default body text — readable, theme.colors.text</Text>
        <Text variant="muted">Muted text — for secondary content</Text>
        <Text variant="subtle">Subtle text — for tertiary / dim content</Text>
        <Text variant="accent">Accent text — for emphasis</Text>
        <Text variant="inverted">Inverted text — for overlays</Text>
        <Text preset="caption">Caption preset — small italic</Text>
        <Text preset="code">code preset — for inline literals</Text>
        <Text preset="label">LABEL PRESET — for form labels</Text>
      </Box>
    </Panel>
  );
}

// ════════════════════════════════════════════════════════════════════
// SECTION: Buttons (atoms)
// ════════════════════════════════════════════════════════════════════

function ButtonsAllVariants() {
  const [focused, setFocused] = useState<string | null>(null);
  const variants = ['primary', 'secondary', 'ghost', 'danger', 'success'] as const;
  const sizes = ['sm', 'md', 'lg'] as const;
  return (
    <Panel title="Buttons · variants × sizes" padding="md">
      <Box variant="transparent" style={{ flexDirection: 'column', gap: 1 }}>
        <Text variant="muted">Click any button to set focus</Text>
        {sizes.map((size) => (
          <Box key={size} variant="transparent" style={{ flexDirection: 'row', gap: 1 }}>
            {variants.map((variant) => {
              const id = `${variant}-${size}`;
              return (
                <Button
                  key={id}
                  variant={variant}
                  size={size}
                  focused={focused === id}
                  onPress={() => setFocused(id)}
                >
                  {variant}
                </Button>
              );
            })}
          </Box>
        ))}
      </Box>
    </Panel>
  );
}

function ButtonsDisabled() {
  return (
    <Panel title="Buttons · disabled state" padding="md">
      <Box variant="transparent" style={{ flexDirection: 'column', gap: 1 }}>
        <Text variant="muted">Disabled buttons render dim and ignore press</Text>
        <Box variant="transparent" style={{ flexDirection: 'row', gap: 1 }}>
          <Button variant="primary">Enabled</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="danger" disabled>
            Disabled danger
          </Button>
        </Box>
      </Box>
    </Panel>
  );
}

// Selected / focused state showcase — variant × state matrix.
// Each row demonstrates one state across all five variants so the
// orthogonal-axis design (variant vs. state) is visible at a glance.
function ButtonsSelected() {
  const variants = ['primary', 'secondary', 'ghost', 'danger', 'success'] as const;
  const tabs = ['overview', 'connections', 'logs', 'settings'] as const;
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>('overview');
  const [focusedTab, setFocusedTab] = useState<(typeof tabs)[number] | null>(null);

  return (
    <Panel title="Buttons · selected & focused states" padding="md">
      <Box variant="transparent" style={{ flexDirection: 'column', gap: 1 }}>
        <Text variant="muted">
          <Span variant="accent">selected</Span> is a persistent state (set by app);{' '}
          <Span variant="accent">focused</Span> is transient (keyboard cursor). Both fill the bg but
          with different shades. When both apply, focus wins.
        </Text>

        <Text variant="subtle">at rest (default)</Text>
        <Box variant="transparent" style={{ flexDirection: 'row', gap: 1 }}>
          {variants.map((v) => (
            <Button key={v} variant={v}>
              {v}
            </Button>
          ))}
        </Box>

        <Text variant="subtle">
          selected — intent color fills bg (<Span variant="accent">bgActive</Span>)
        </Text>
        <Box variant="transparent" style={{ flexDirection: 'row', gap: 1 }}>
          {variants.map((v) => (
            <Button key={v} variant={v} selected>
              {v}
            </Button>
          ))}
        </Box>

        <Text variant="subtle">
          focused — accent shade fills bg (<Span variant="accent">bgFocus</Span>)
        </Text>
        <Box variant="transparent" style={{ flexDirection: 'row', gap: 1 }}>
          {variants.map((v) => (
            <Button key={v} variant={v} focused>
              {v}
            </Button>
          ))}
        </Box>

        <Text variant="subtle">selected + focused — focus wins</Text>
        <Box variant="transparent" style={{ flexDirection: 'row', gap: 1 }}>
          {variants.map((v) => (
            <Button key={v} variant={v} selected focused>
              {v}
            </Button>
          ))}
        </Box>

        <Text variant="subtle">
          interactive tab bar — click a tab to <Span variant="accent">select</Span> it;
          hover-equivalent <Span variant="accent">focus</Span> tracks the most recently moused-over
          tab
        </Text>
        <Box variant="transparent" style={{ flexDirection: 'row', gap: 1 }}>
          {tabs.map((t) => (
            <Button
              key={t}
              variant="ghost"
              selected={activeTab === t}
              focused={focusedTab === t}
              onPress={() => {
                setActiveTab(t);
                setFocusedTab(t);
              }}
            >
              {t}
            </Button>
          ))}
        </Box>
        <Text variant="muted">
          active view: <Span variant="accent">{activeTab}</Span>
          {focusedTab && focusedTab !== activeTab ? (
            <Span variant="muted"> · cursor on {focusedTab}</Span>
          ) : null}
        </Text>
      </Box>
    </Panel>
  );
}

// ════════════════════════════════════════════════════════════════════
// SECTION: Inputs (atoms)
// ════════════════════════════════════════════════════════════════════

function InputsAllVariants() {
  const [name, setName] = useState('');
  return (
    <Panel title="Inputs · variants" padding="md">
      <Box variant="transparent" style={{ flexDirection: 'column', gap: 1 }}>
        <Text>Default:</Text>
        <Input variant="default" placeholder="enter your name…" value={name} onInput={setName} />
        <Text>Filled:</Text>
        <Input variant="filled" placeholder="surface bg, no border" />
        <Text>Flushed:</Text>
        <Input variant="flushed" placeholder="borderless" />
        {name ? <Text variant="accent">Hello, {name}!</Text> : null}
      </Box>
    </Panel>
  );
}

// ════════════════════════════════════════════════════════════════════
// SECTION: Spinner (molecule)
// ════════════════════════════════════════════════════════════════════

function SpinnerOverview() {
  return (
    <Panel title="Spinner · variants" padding="md">
      <Box variant="transparent" style={{ flexDirection: 'column', gap: 1 }}>
        <Spinner label="loading…" />
        <Spinner label="downloading bundle" progress={0.42} />
        <Spinner label="finalizing" progress={0.95} />
      </Box>
    </Panel>
  );
}

// ════════════════════════════════════════════════════════════════════
// SECTION: StatusList (organism)
// ════════════════════════════════════════════════════════════════════

function StatusListBasic() {
  const items: StatusListItem[] = [
    { id: 'github', label: 'GitHub Copilot', state: 'connected' },
    { id: 'anthropic', label: 'Anthropic API', state: 'expired' },
    { id: 'openai', label: 'OpenAI API', state: 'disconnected' },
    { id: 'linear', label: 'Linear', state: 'pending' },
  ];
  return (
    <Panel title="StatusList · all states" padding="md">
      <StatusList items={items} />
    </Panel>
  );
}

function StatusListWithDetails() {
  const items: StatusListItem[] = [
    {
      id: 'github',
      label: 'GitHub Copilot',
      state: 'connected',
      detail: 'logged in as @ecruz165 (scope: read:user, repo)',
      badge: 'required',
    },
    {
      id: 'anthropic',
      label: 'Anthropic API',
      state: 'expired',
      detail: 'token expired 2 hours ago — renew to continue',
      badge: 'optional',
    },
    {
      id: 'openai',
      label: 'OpenAI API',
      state: 'disconnected',
      detail: 'set OPENAI_API_KEY to enable',
      badge: 'optional',
    },
  ];
  return (
    <Panel title="StatusList · with details + badges" padding="md">
      <StatusList items={items} />
    </Panel>
  );
}

// ════════════════════════════════════════════════════════════════════
// SECTION: SelectList (organism)
// ════════════════════════════════════════════════════════════════════

function SelectListBasic() {
  const [picked, setPicked] = useState<string | null>(null);
  const items: SelectListItem[] = [
    { id: 'rose-pine', label: 'Rosé Pine' },
    { id: 'tokyo-night', label: 'Tokyo Night' },
    { id: 'catppuccin-mocha', label: 'Catppuccin Mocha' },
    { id: 'catppuccin-latte', label: 'Catppuccin Latte' },
  ];
  return (
    <Panel title="SelectList · keyboard-navigable" padding="md">
      <Box variant="transparent" style={{ flexDirection: 'column', gap: 1 }}>
        <Text variant="muted">↑↓ to navigate · enter to pick</Text>
        <SelectList items={items} alwaysCapture onSelect={(_, item) => setPicked(item.id)} />
        {picked ? (
          <Text variant="accent">Picked: {picked}</Text>
        ) : (
          <Text variant="subtle">(no selection yet)</Text>
        )}
      </Box>
    </Panel>
  );
}

function SelectListWithDisabled() {
  const items: SelectListItem[] = [
    { id: '1', label: 'Available item 1', detail: 'ready to select' },
    { id: '2', label: 'Available item 2', detail: 'ready to select' },
    { id: '3', label: 'Coming soon…', disabled: true },
    { id: '4', label: 'Available item 3', detail: 'ready to select' },
    { id: '5', label: 'Premium only', disabled: true },
  ];
  return (
    <Panel title="SelectList · with disabled items" padding="md">
      <Box variant="transparent" style={{ flexDirection: 'column', gap: 1 }}>
        <Text variant="muted">Disabled items are skipped during navigation</Text>
        <SelectList items={items} alwaysCapture />
      </Box>
    </Panel>
  );
}

// ════════════════════════════════════════════════════════════════════
// SECTION: Table (organism — 4 scenarios)
// ════════════════════════════════════════════════════════════════════

interface DemoRow {
  id: string;
  name: string;
  status: 'connected' | 'expired' | 'disconnected';
  priority: number;
  description: string;
}

const STATUS_ORDER: Record<DemoRow['status'], number> = {
  connected: 0,
  expired: 1,
  disconnected: 2,
};

const tableColumns: TableColumn<DemoRow>[] = [
  {
    key: 'name',
    label: 'Provider',
    width: 22,
    description:
      'Display name of the auth provider. Maps to the connection registered for this app.',
  },
  {
    key: 'status',
    label: 'Status',
    width: 14,
    description:
      'connected → token healthy. expired → renew needed. disconnected → not configured.',
  },
  {
    key: 'priority',
    label: 'Pri',
    width: 5,
    align: 'right',
    description: 'Sort priority within the same status. Lower = surfaces first.',
  },
];

const initialRows: DemoRow[] = [
  {
    id: 'u-1',
    name: 'GitHub Copilot',
    status: 'connected',
    priority: 1,
    description: 'Primary AI provider. Healthy.',
  },
  {
    id: 'u-2',
    name: 'Anthropic Claude',
    status: 'expired',
    priority: 2,
    description: 'API token expired. Re-auth needed.',
  },
  {
    id: 'u-3',
    name: 'OpenAI GPT-4',
    status: 'disconnected',
    priority: 3,
    description: 'Not configured. Optional fallback.',
  },
  {
    id: 'u-4',
    name: 'GitHub PAT',
    status: 'connected',
    priority: 1,
    description: 'Used for octokit enrichment.',
  },
  {
    id: 'u-5',
    name: 'Linear',
    status: 'disconnected',
    priority: 4,
    description: 'Optional ticket integration.',
  },
];

function TableBasic() {
  return (
    <Panel title="Table · pin header, no sort" padding="md">
      <Table
        rows={initialRows}
        columns={tableColumns}
        rowKey="id"
        pinHeader
        selectable
        alwaysCapture
      />
    </Panel>
  );
}

function TableSorted() {
  return (
    <Panel title="Table · sort with cursor-follow" padding="md">
      <Box variant="transparent" style={{ flexDirection: 'column', gap: 1 }}>
        <Text variant="muted">
          Sorted: connected → expired → disconnected. Cursor sticks to its row.
        </Text>
        <Table
          rows={initialRows}
          columns={tableColumns}
          rowKey="id"
          pinHeader
          selectable
          alwaysCapture
          reorder={{
            mode: 'sort',
            compare: (a, b) =>
              STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.priority - b.priority,
            cursorFollow: 'row',
          }}
        />
      </Box>
    </Panel>
  );
}

function TableMasterDetail() {
  return (
    <Panel title="Table · master/detail" padding="md">
      <Table
        rows={initialRows}
        columns={tableColumns}
        rowKey="id"
        pinHeader
        selectable
        alwaysCapture
        renderDetail={(row) => (
          <Box variant="transparent" style={{ flexDirection: 'column', gap: 1, minWidth: 28 }}>
            <Heading level={3}>{row.name}</Heading>
            <Text variant="muted">id: {row.id}</Text>
            <Text>{row.description}</Text>
            <Text variant="accent">priority {row.priority}</Text>
          </Box>
        )}
      />
    </Panel>
  );
}

function TableColumnHelp() {
  return (
    <Panel title="TableHelp · column reference tied to a Table" padding="md">
      <Box variant="transparent" style={{ flexDirection: 'column', gap: 1 }}>
        <Text variant="muted">
          A 2-column reference page generated from the same <Span variant="accent">columns</Span>{' '}
          array passed to the data Table. Each column's <Span variant="accent">description</Span>{' '}
          field is the source of truth.
        </Text>
        <TableHelp
          columns={tableColumns}
          intro="Columns shown in the Table scenarios above."
          title="Provider table — column reference"
        />
      </Box>
    </Panel>
  );
}

function TableStreaming() {
  const tableRef = useRef<TableHandle<DemoRow>>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const ids = ['u-1', 'u-2', 'u-3', 'u-4', 'u-5'];
      const id = ids[Math.floor(Math.random() * ids.length)]!;
      const states: DemoRow['status'][] = ['connected', 'expired', 'disconnected'];
      const newStatus = states[Math.floor(Math.random() * states.length)]!;
      tableRef.current?.markLoading(id);
      setTimeout(() => {
        tableRef.current?.updateRow(id, {
          status: newStatus,
          description: `Last update: ${new Date().toLocaleTimeString()}`,
        });
      }, 350);
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  return (
    <Panel title="Table · live streaming updates" padding="md">
      <Box variant="transparent" style={{ flexDirection: 'column', gap: 1 }}>
        <Text variant="muted">
          A random row's status changes every 1.5s. Watch the cursor stick to its row across
          reorders.
        </Text>
        <Table
          ref={tableRef}
          rows={initialRows}
          columns={tableColumns}
          rowKey="id"
          pinHeader
          selectable
          alwaysCapture
          reorder={{
            mode: 'sort',
            compare: (a, b) =>
              STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.priority - b.priority,
            cursorFollow: 'row',
          }}
          renderDetail={(row) => (
            <Box variant="transparent" style={{ flexDirection: 'column', gap: 1, minWidth: 28 }}>
              <Heading level={3}>{row.name}</Heading>
              <Text variant="accent">{row.status}</Text>
              <Text variant="muted">{row.description}</Text>
            </Box>
          )}
        />
      </Box>
    </Panel>
  );
}

// ────────────────────────────────────────────────────────────────────
// Wide table (15 columns) — demonstrates horizontal scroll via scrollbox
// ────────────────────────────────────────────────────────────────────

interface WideRow {
  id: string;
  name: string;
  status: string;
  team: string;
  region: string;
  pricing: string;
  capacity: string;
  latency: string;
  uptime: string;
  version: string;
  owner: string;
  created: string;
  updated: string;
  alerts: string;
  notes: string;
}

const wideColumns: TableColumn<WideRow>[] = [
  { key: 'id', label: 'ID', width: 6 },
  { key: 'name', label: 'Service', width: 18 },
  { key: 'status', label: 'Status', width: 12 },
  { key: 'team', label: 'Team', width: 12 },
  { key: 'region', label: 'Region', width: 12 },
  { key: 'pricing', label: 'Tier', width: 10 },
  { key: 'capacity', label: 'Capacity', width: 10, align: 'right' },
  { key: 'latency', label: 'p95 (ms)', width: 10, align: 'right' },
  { key: 'uptime', label: 'Uptime', width: 10, align: 'right' },
  { key: 'version', label: 'Version', width: 10 },
  { key: 'owner', label: 'Owner', width: 14 },
  { key: 'created', label: 'Created', width: 12 },
  { key: 'updated', label: 'Updated', width: 12 },
  { key: 'alerts', label: 'Alerts', width: 8, align: 'right' },
  { key: 'notes', label: 'Notes', width: 30 },
];

const wideRows: WideRow[] = [
  {
    id: 'svc-01',
    name: 'github-copilot',
    status: 'healthy',
    team: 'platform',
    region: 'us-east-1',
    pricing: 'enterprise',
    capacity: '85%',
    latency: '127',
    uptime: '99.97%',
    version: '2.4.1',
    owner: '@platform',
    created: '2025-01-12',
    updated: '2026-05-09',
    alerts: '0',
    notes: 'Primary AI provider — autoscale enabled.',
  },
  {
    id: 'svc-02',
    name: 'anthropic-claude',
    status: 'degraded',
    team: 'platform',
    region: 'us-west-2',
    pricing: 'pro',
    capacity: '92%',
    latency: '340',
    uptime: '99.81%',
    version: '3.5.0',
    owner: '@ai-infra',
    created: '2025-03-04',
    updated: '2026-05-09',
    alerts: '2',
    notes: 'Token expired — re-auth needed.',
  },
  {
    id: 'svc-03',
    name: 'openai-gpt4',
    status: 'offline',
    team: 'platform',
    region: 'eu-west-1',
    pricing: 'free',
    capacity: '0%',
    latency: '—',
    uptime: '0%',
    version: '—',
    owner: '@ai-infra',
    created: '2024-11-22',
    updated: '2026-05-09',
    alerts: '1',
    notes: 'Not configured. Optional fallback only.',
  },
  {
    id: 'svc-04',
    name: 'github-pat',
    status: 'healthy',
    team: 'platform',
    region: 'us-east-1',
    pricing: 'enterprise',
    capacity: '12%',
    latency: '45',
    uptime: '99.99%',
    version: '—',
    owner: '@platform',
    created: '2025-01-12',
    updated: '2026-05-09',
    alerts: '0',
    notes: 'Used for octokit enrichment.',
  },
  {
    id: 'svc-05',
    name: 'linear',
    status: 'offline',
    team: 'product',
    region: 'us-east-1',
    pricing: 'team',
    capacity: '0%',
    latency: '—',
    uptime: '0%',
    version: '1.32',
    owner: '@product',
    created: '2025-08-19',
    updated: '2026-05-09',
    alerts: '0',
    notes: 'Optional ticket integration.',
  },
  {
    id: 'svc-06',
    name: 'datadog-apm',
    status: 'healthy',
    team: 'observability',
    region: 'us-east-1',
    pricing: 'enterprise',
    capacity: '68%',
    latency: '95',
    uptime: '99.95%',
    version: '7.51',
    owner: '@obs',
    created: '2024-06-10',
    updated: '2026-05-09',
    alerts: '0',
    notes: 'APM + log forwarding.',
  },
  {
    id: 'svc-07',
    name: 'pagerduty',
    status: 'healthy',
    team: 'sre',
    region: 'global',
    pricing: 'business',
    capacity: '4%',
    latency: '210',
    uptime: '99.99%',
    version: '—',
    owner: '@sre',
    created: '2024-02-28',
    updated: '2026-05-09',
    alerts: '0',
    notes: 'Oncall routing.',
  },
];

function TableWideColumns() {
  return (
    <Panel title="Table · 15 columns (horizontal scroll)" padding="md">
      <Box variant="transparent" style={{ flexDirection: 'column', gap: 1 }}>
        <Text variant="muted">
          Total column width exceeds the viewport. Wrapped in a{' '}
          <Span variant="accent">scrollbox</Span> with <Span variant="accent">scrollX</Span> so the
          table scrolls horizontally — use the mouse wheel (or shift+wheel) to scroll right and
          reveal the rest of the columns.
        </Text>
        {/*
          openTUI's <scrollbox> provides a bounded viewport with built-in
          scrollbars. We set a fixed height so the viewport can't grow to
          fit the content, which is what triggers the horizontal scroll.
          The Table itself is unmodified — scrolling is a pure container
          concern, just like overflow: scroll on the web.
        */}
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <scrollbox
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {...({
            style: { width: '100%', height: 14 },
            scrollX: true,
            scrollY: false,
          } as any)}
        >
          <Table
            rows={wideRows}
            columns={wideColumns}
            rowKey="id"
            pinHeader
            selectable
            alwaysCapture
          />
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        </scrollbox>
      </Box>
    </Panel>
  );
}

// ────────────────────────────────────────────────────────────────────
// Tall table (100 rows) — demonstrates vertical scroll via scrollbox
// ────────────────────────────────────────────────────────────────────

const manyRows: DemoRow[] = Array.from({ length: 100 }, (_, i) => {
  const idx = i + 1;
  const statusCycle: DemoRow['status'][] = ['connected', 'expired', 'disconnected'];
  return {
    id: `r-${String(idx).padStart(3, '0')}`,
    name: `Service ${idx}`,
    status: statusCycle[i % 3]!,
    priority: (i % 9) + 1,
    description: `Synthetic row ${idx} — used for vertical-scroll demo.`,
  };
});

// Minimal type for the openTUI ScrollBoxRenderable surface we use.
interface ScrollBoxRef {
  scrollTop: number;
  scrollHeight: number;
  height: number;
}

function TableManyRows() {
  // Ref to the openTUI scrollbox so we can drive scrollTop from the
  // cursor position. Each Table row renders as one line; pinHeader adds
  // one line above the rows.
  const scrollRef = useRef<ScrollBoxRef | null>(null);
  const VIEWPORT_HEIGHT = 18;
  // Subtract 2 for the scrollbox's own border so the cursor never sits
  // on the last visible line where it would feel "stuck".
  const VISIBLE_ROWS = VIEWPORT_HEIGHT - 2;

  const handleCursorChange = (_row: DemoRow, idx: number) => {
    const box = scrollRef.current;
    if (!box) return;
    // y-position of this row within the scrollbox's content area
    const cursorY = idx + 1; // +1 because pinHeader occupies row 0
    const currentTop = box.scrollTop;
    if (cursorY < currentTop) {
      box.scrollTop = Math.max(0, cursorY);
    } else if (cursorY >= currentTop + VISIBLE_ROWS) {
      box.scrollTop = cursorY - VISIBLE_ROWS + 1;
    }
  };

  return (
    <Panel title="Table · 100 rows (vertical scroll)" padding="md">
      <Box variant="transparent" style={{ flexDirection: 'column', gap: 1 }}>
        <Text variant="muted">
          100 rows in a bounded <Span variant="accent">scrollbox</Span>. Use{' '}
          <Span variant="accent">↑↓</Span> (or <Span variant="accent">j/k</Span>) to navigate — the
          viewport auto-scrolls to keep the cursor visible. Mouse wheel still works for
          free-scrolling.
        </Text>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <scrollbox
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ref={scrollRef as any}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {...({
            style: { width: '100%', height: VIEWPORT_HEIGHT },
            scrollX: false,
            scrollY: true,
          } as any)}
        >
          <Table
            rows={manyRows}
            columns={tableColumns}
            rowKey="id"
            pinHeader
            selectable
            alwaysCapture
            onChange={handleCursorChange}
          />
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        </scrollbox>
      </Box>
    </Panel>
  );
}

// ════════════════════════════════════════════════════════════════════
// SECTION: Confirm (organism)
// ════════════════════════════════════════════════════════════════════

function ConfirmOverview() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  useKeybinding('c', 'confirm dialog', () => setOpen(true), { hidden: open });
  return (
    <Panel title="Confirm · yes/no modal" padding="md">
      <Box variant="transparent" style={{ flexDirection: 'column', gap: 1 }}>
        <Text variant="muted">
          Press <Span variant="accent">c</Span> to open the modal.
        </Text>
        {result ? (
          <Text variant={result === 'yes' ? 'accent' : 'subtle'}>Last answer: {result}</Text>
        ) : (
          <Text variant="subtle">(no answer yet)</Text>
        )}
        {open ? (
          <Confirm
            title="Delete configuration?"
            message="This will remove ~/.agentx/myapp.yaml. Are you sure?"
            defaultAnswer="no"
            onConfirm={() => {
              setResult('yes');
              setOpen(false);
            }}
            onCancel={() => {
              setResult('no');
              setOpen(false);
            }}
          />
        ) : null}
      </Box>
    </Panel>
  );
}

// ════════════════════════════════════════════════════════════════════
// SECTION: Theme (organism)
// ════════════════════════════════════════════════════════════════════

function ThemePicker() {
  const [open, setOpen] = useState(false);
  useKeybinding('p', 'theme picker', () => setOpen((o) => !o));
  return (
    <Panel title="Theme · interactive picker" padding="md">
      <Box variant="transparent" style={{ flexDirection: 'column', gap: 1 }}>
        <Text variant="muted">
          Press <Span variant="accent">p</Span> to open the picker.
        </Text>
        <Text variant="subtle">
          Or use Ctrl+T to cycle directly · Ctrl+Shift+T to toggle dark/light.
        </Text>
        {open ? (
          <ThemeSwitcher active onApply={() => setOpen(false)} onCancel={() => setOpen(false)} />
        ) : null}
      </Box>
    </Panel>
  );
}

// ════════════════════════════════════════════════════════════════════
// Sections registry
// ════════════════════════════════════════════════════════════════════

const SECTIONS: DemoSection[] = [
  {
    id: 'typography',
    label: 'Typography',
    scenarios: [{ id: 'all', label: 'Overview', Component: TypographyOverview }],
  },
  {
    id: 'buttons',
    label: 'Buttons',
    scenarios: [
      { id: 'variants', label: 'Variants × sizes', Component: ButtonsAllVariants },
      { id: 'states', label: 'Selected & focused', Component: ButtonsSelected },
      { id: 'disabled', label: 'Disabled', Component: ButtonsDisabled },
    ],
  },
  {
    id: 'inputs',
    label: 'Inputs',
    scenarios: [{ id: 'variants', label: 'Variants', Component: InputsAllVariants }],
  },
  {
    id: 'spinner',
    label: 'Spinner',
    scenarios: [{ id: 'all', label: 'Variants', Component: SpinnerOverview }],
  },
  {
    id: 'status',
    label: 'StatusList',
    scenarios: [
      { id: 'basic', label: 'Basic', Component: StatusListBasic },
      { id: 'details', label: 'Details + badges', Component: StatusListWithDetails },
    ],
  },
  {
    id: 'select',
    label: 'SelectList',
    scenarios: [
      { id: 'basic', label: 'Basic', Component: SelectListBasic },
      { id: 'disabled', label: 'With disabled', Component: SelectListWithDisabled },
    ],
  },
  {
    id: 'table',
    label: 'Table',
    scenarios: [
      { id: 'basic', label: 'Basic', Component: TableBasic },
      { id: 'sorted', label: 'Sort + cursor follow', Component: TableSorted },
      { id: 'master-detail', label: 'Master/detail', Component: TableMasterDetail },
      { id: 'streaming', label: 'Live streaming', Component: TableStreaming },
      { id: 'help', label: 'Column help (TableHelp)', Component: TableColumnHelp },
      { id: 'wide', label: '15 columns (h-scroll)', Component: TableWideColumns },
      { id: 'many', label: '100 rows (v-scroll)', Component: TableManyRows },
    ],
  },
  {
    id: 'confirm',
    label: 'Confirm',
    scenarios: [{ id: 'modal', label: 'Modal', Component: ConfirmOverview }],
  },
  {
    id: 'theme',
    label: 'Theme',
    scenarios: [{ id: 'picker', label: 'Picker', Component: ThemePicker }],
  },
];

// ────────────────────────────────────────────────────────────────────
// Build MenuItem tree from sections — each section becomes a top-level
// MenuItem; scenarios become its submenu (or merge into the parent if
// only one scenario).
// ────────────────────────────────────────────────────────────────────

function buildMenuItems(): MenuItem[] {
  return SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    submenu:
      section.scenarios.length > 1
        ? section.scenarios.map((s) => ({ id: s.id, label: s.label }))
        : undefined,
  }));
}

// ────────────────────────────────────────────────────────────────────
// Main App — uses <Menu> organism for section + scenario nav
// ────────────────────────────────────────────────────────────────────

function App({ onQuit }: { onQuit: () => void }) {
  useThemeKeybindings();
  useKeybinding('q', 'quit', onQuit);

  const menuItems = buildMenuItems();
  const [path, setPath] = useState<MenuItem[]>([]);

  // Resolve current section + scenario from the menu path.
  // path[0] = section item; path[1] = scenario item (when section has multi-scenarios).
  const sectionItem = path[0];
  const scenarioItem = path[1];

  const section = sectionItem ? SECTIONS.find((s) => s.id === sectionItem.id) : SECTIONS[0]!;
  const scenarios = section?.scenarios ?? [];
  const scenario =
    (scenarioItem && scenarios.find((s) => s.id === scenarioItem.id)) ?? scenarios[0]!;
  // Mount the scenario as a React element so its hooks belong to its own fiber.
  // Calling scenario.Component() inline would inline its hooks into App and break
  // the rules of hooks the moment a scenario with a different hook count loads.
  const Scenario = scenario?.Component;

  return (
    <Box variant="default" padding="md" style={{ flexDirection: 'column', gap: 1 }}>
      <Heading level={1}>tui-view-components · showcase</Heading>
      <Text variant="muted">
        1-9 jumps to a section · Tab cycles items · Enter drills in · Esc back · Ctrl+T theme · q
        quit
      </Text>

      <Menu items={menuItems} layout="stacked" exitKey="escape" onChange={setPath} />

      <Box variant="transparent" style={{ flexDirection: 'column', gap: 1 }}>
        {Scenario ? <Scenario /> : null}
      </Box>

      <KeybindingsBar />
    </Box>
  );
}

// ────────────────────────────────────────────────────────────────────
// Bootstrap (uses AppShell — the canonical provider stack)
// ────────────────────────────────────────────────────────────────────

const renderer = await createCliRenderer();
const root = createRoot(renderer);

const cleanup = () => {
  try {
    (root as unknown as { unmount?: () => void }).unmount?.();
  } catch {
    /* ignore */
  }
  process.exit(0);
};

root.render(
  <AppShell appName="tui-demo" fallbackThemeName="rose-pine">
    <App onQuit={cleanup} />
  </AppShell>,
);
