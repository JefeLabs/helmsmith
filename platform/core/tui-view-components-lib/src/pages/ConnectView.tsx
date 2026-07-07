/**
 * `<ConnectView>` — the canonical "manage your connections" screen.
 *
 * Shows status of every required and optional Connection, drives
 * login/logout via the Connection's own methods, and handles the
 * keyboard. Apps wire it via the `<app> connect` subcommand.
 *
 * Layout:
 *   ┌─ <appName> connect ─────────────────────┐
 *   │  Required                                │
 *   │    ✓ GitHub Copilot   logged in as @x    │
 *   │  Optional                                │
 *   │    ✗ Anthropic API    not connected      │
 *   │                                          │
 *   │  ▸ login GitHub Copilot                  │
 *   │    logout GitHub Copilot                 │
 *   │    refresh                               │
 *   │                                          │
 *   │  ↑↓ navigate · enter · q quit            │
 *   └──────────────────────────────────────────┘
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box } from '../atoms/Box.tsx';
import { Heading } from '../atoms/Heading.tsx';
import { Text } from '../atoms/Text.tsx';
import type { Connection, ConnectionStatus } from '../connection.ts';
import { FocusManager } from '../focus/manager.tsx';
import { useKeybinding } from '../keyboard/registry.tsx';
import { KeybindingsBar } from '../molecules/KeybindingsBar.tsx';
import { Spinner } from '../molecules/Spinner.tsx';
import { SelectList, type SelectListItem } from '../organisms/SelectList.tsx';
import { StatusList, type StatusListItem } from '../organisms/StatusList.tsx';

export interface ConnectViewProps {
  appName: string;
  required?: Connection[];
  optional?: Connection[];
  /** Called when the user presses q to quit. Default: process.exit(0). */
  onQuit?: () => void;
}

interface BusyState {
  /** Connection id currently performing an action. */
  connectionId: string;
  action: 'login' | 'logout';
  message: string;
}

export function ConnectView({ appName, required = [], optional = [], onQuit }: ConnectViewProps) {
  const all = useMemo(() => [...required, ...optional], [required, optional]);

  const [statuses, setStatuses] = useState<Map<string, ConnectionStatus>>(() => new Map());
  const [busy, setBusy] = useState<BusyState | null>(null);

  // Initial status fetch + refresh helper
  const refreshAll = useCallback(async () => {
    const next = new Map<string, ConnectionStatus>();
    for (const c of all) {
      try {
        next.set(c.id, await c.getStatus());
      } catch {
        next.set(c.id, { state: 'disconnected', message: 'status unavailable' });
      }
    }
    setStatuses(next);
  }, [all]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  /** Returns the loaded ConnectionStatus, or null if still loading.
   *  Wrapped in useCallback so consuming useMemo/useCallback hooks
   *  can depend on it without invalidating every render. */
  const statusOf = useCallback(
    (c: Connection): ConnectionStatus | null => statuses.get(c.id) ?? null,
    [statuses],
  );

  // Build StatusList items (required + optional, with section badges).
  // A null status means the fetch is in flight — render as "pending".
  const statusItems: StatusListItem[] = useMemo(() => {
    const out: StatusListItem[] = [];
    const buildItem = (c: Connection, badge: 'required' | 'optional'): StatusListItem => {
      const s = statusOf(c);
      return {
        id: c.id,
        label: c.displayName,
        state: s ? s.state : 'pending',
        detail: s?.identity ?? s?.message ?? c.description ?? undefined,
        badge,
      };
    };
    for (const c of required) out.push(buildItem(c, 'required'));
    for (const c of optional) out.push(buildItem(c, 'optional'));
    return out;
    // statusOf is a stable closure over `statuses`; depend on the state map directly.
  }, [required, optional, statusOf]);

  // Build action items (login or logout per connection)
  const actionItems: SelectListItem[] = useMemo(
    () =>
      all.map((c) => {
        const s = statusOf(c);
        const isConnected = s?.state === 'connected';
        return {
          id: c.id,
          label: `${isConnected ? 'logout' : 'login'} ${c.displayName}`,
          detail: isConnected ? (s?.identity ?? '') : '',
          disabled: !s, // disabled while loading
        };
      }),
    [all, statusOf],
  );

  const runAction = useCallback(
    async (idx: number) => {
      if (busy) return;
      const conn = all[idx];
      if (!conn) return;
      const s = statusOf(conn);
      const action: 'login' | 'logout' = s?.state === 'connected' ? 'logout' : 'login';
      setBusy({
        connectionId: conn.id,
        action,
        message: action === 'login' ? 'starting login…' : 'logging out…',
      });
      try {
        if (action === 'login') {
          await conn.login((message) => {
            setBusy({ connectionId: conn.id, action, message });
          });
        } else {
          await conn.logout();
        }
      } catch (err) {
        setStatuses((prev) => {
          const next = new Map(prev);
          next.set(conn.id, {
            state: 'disconnected',
            message: `${action} failed: ${(err as Error).message}`,
          });
          return next;
        });
      } finally {
        setBusy(null);
        await refreshAll();
      }
    },
    [all, busy, refreshAll, statusOf],
  );

  // Quit + refresh keybindings
  useKeybinding(
    'q',
    'quit',
    () => {
      if (onQuit) onQuit();
      else process.exit(0);
    },
    { hidden: false },
  );
  useKeybinding('r', 'refresh', () => {
    void refreshAll();
  });

  return (
    <FocusManager initialFocus="connect-actions">
      <Box variant="default" padding="md" style={{ flexDirection: 'column', gap: 1, minWidth: 56 }}>
        <Heading level={1}>{appName} · connect</Heading>

        {required.length > 0 ? (
          <Box variant="transparent" style={{ flexDirection: 'column' }}>
            <Text variant="muted">Required</Text>
            <StatusList items={statusItems.filter((i) => i.badge === 'required')} />
          </Box>
        ) : null}

        {optional.length > 0 ? (
          <Box variant="transparent" style={{ flexDirection: 'column' }}>
            <Text variant="muted">Optional</Text>
            <StatusList items={statusItems.filter((i) => i.badge === 'optional')} />
          </Box>
        ) : null}

        {all.length === 0 ? (
          <Text variant="subtle">
            No connections registered. This app doesn't require any auth today.
          </Text>
        ) : (
          <Box variant="transparent" style={{ flexDirection: 'column' }}>
            <Text variant="muted">Actions</Text>
            <SelectList
              focusId="connect-actions"
              alwaysCapture
              items={actionItems}
              onSelect={(idx) => void runAction(idx)}
            />
          </Box>
        )}

        {busy ? <Spinner label={busy.message} /> : null}

        <KeybindingsBar />
      </Box>
    </FocusManager>
  );
}
