import { Button, Card, Chip, Separator } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Code, LoadingSpinner, PendingButton, TextAreaField, TextInput } from '../components/ui';
import { IntentSession, intent, subscribeToSession } from '../lib/api';

interface ChatLine {
  who: 'user' | 'system';
  text: string;
  at: string;
}

/**
 * Phase 6 — chat-style consumer of the Intent SSE stream. Demonstrates
 * the full intake → confirm round-trip without depending on a real
 * intake pipeline (the backend just needs the user to start a session
 * with any registered job-definition flow).
 *
 * <p>Three states drive the UI:
 *  - no session: prompt for intakePipelineId + productId, then start
 *  - session active: show chat log + SSE-streamed events
 *  - intent-ready: confirmation card with the resolved intent
 */
export default function IntakePage() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();

  const [session, setSession] = useState<IntentSession | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state for "start session"
  const [pipelineId, setPipelineId] = useState('default-intake');
  const [productId, setProductId] = useState('demo-product');
  const [initial, setInitial] = useState('');

  const cleanupRef = useRef<(() => void) | null>(null);

  // Resume on URL change / mount: if sessionId in URL, fetch + subscribe.
  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setLines([]);
      cleanupRef.current?.();
      cleanupRef.current = null;
      return;
    }
    let cancelled = false;
    setPending(true);
    intent
      .get(sessionId)
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        setLines([
          {
            who: 'system',
            text: `session ${s.id} (status=${s.status})`,
            at: s.createdAt,
          },
        ]);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setPending(false));

    const cleanup = subscribeToSession(sessionId, {
      onAny: (kind, data) => {
        setLines((prev) => [
          ...prev,
          {
            who: 'system',
            text: `event:${kind} ${JSON.stringify(data)}`,
            at: new Date().toISOString(),
          },
        ]);
      },
      onIntentReady: () => {
        intent
          .get(sessionId)
          .then(setSession)
          .catch(() => {});
      },
      onJobSubmitted: () => {
        intent
          .get(sessionId)
          .then(setSession)
          .catch(() => {});
      },
      onAborted: () => {
        intent
          .get(sessionId)
          .then(setSession)
          .catch(() => {});
      },
    });
    cleanupRef.current = cleanup;
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [sessionId]);

  async function startSession() {
    setError(null);
    setPending(true);
    try {
      const s = await intent.start({
        intakePipelineId: pipelineId || undefined,
        productId: productId || undefined,
        initialInput: initial ? (safeJson(initial) ?? { message: initial }) : undefined,
      });
      navigate(`/intake/${s.id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }

  async function sendMessage(message: string) {
    if (!session) return;
    setLines((prev) => [...prev, { who: 'user', text: message, at: new Date().toISOString() }]);
    try {
      await intent.message(session.id, message);
    } catch (e) {
      setError(String(e));
    }
  }

  async function confirmAndRun() {
    if (!session?.resolvedIntent) return;
    const intentBody = session.resolvedIntent as {
      flowId: string;
      productId: string;
      input?: unknown;
    };
    try {
      const updated = await intent.confirm(session.id, intentBody);
      setSession(updated);
    } catch (e) {
      setError(String(e));
    }
  }

  async function abortSession() {
    if (!session) return;
    try {
      const updated = await intent.abort(session.id);
      setSession(updated);
    } catch (e) {
      setError(String(e));
    }
  }

  if (!sessionId) {
    return (
      <Card className="max-w-xl mx-auto">
        <Card.Header>
          <div className="flex flex-col">
            <p className="text-base">Start an intake session</p>
            <p className="text-sm text-muted">
              Submits a job-definition pipeline and tracks it through <Code>intent-ready</Code>.
            </p>
          </div>
        </Card.Header>
        <Separator />
        <Card.Content className="gap-3">
          <TextInput
            label="Intake pipeline id"
            placeholder="default-intake"
            value={pipelineId}
            onValueChange={setPipelineId}
          />
          <TextInput
            label="Product id"
            placeholder="demo-product"
            value={productId}
            onValueChange={setProductId}
          />
          <TextAreaField
            label="Initial input (JSON or plain message)"
            placeholder='{"goal":"upgrade React"}'
            value={initial}
            onValueChange={setInitial}
            rows={3}
          />
          {error && <Code color="danger">{error}</Code>}
          <PendingButton
            variant="primary"
            onPress={startSession}
            pending={pending}
            isDisabled={!pipelineId || !productId}
          >
            Start session
          </PendingButton>
        </Card.Content>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card className="md:col-span-2">
        <Card.Header className="flex flex-row justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">session</span>
            <Code>{sessionId.slice(0, 8)}…</Code>
            {session && <StatusChip status={session.status} />}
          </div>
          <Button size="sm" variant="secondary" onPress={() => navigate('/intake')}>
            New session
          </Button>
        </Card.Header>
        <Separator />
        <Card.Content>
          {pending && !session && <LoadingSpinner label="Loading session…" />}
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {lines.map((l, i) => (
              <div
                key={i}
                className={
                  'p-2 rounded-md text-sm ' +
                  (l.who === 'user'
                    ? 'bg-accent-soft ml-12'
                    : 'bg-surface-secondary mr-12 font-mono text-xs')
                }
              >
                {l.text}
              </div>
            ))}
          </div>
          <Separator className="my-3" />
          <MessageBar
            disabled={
              !session ||
              session.status === 'aborted' ||
              session.status === 'submitted' ||
              session.status === 'expired'
            }
            onSend={sendMessage}
          />
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <p className="text-base">Session detail</p>
        </Card.Header>
        <Separator />
        <Card.Content className="gap-3">
          {error && <Code color="danger">{error}</Code>}
          {session && (
            <>
              <DetailRow label="status" value={<StatusChip status={session.status} />} />
              <DetailRow label="intake job" value={<Code>{session.intakeJobId ?? '—'}</Code>} />
              {session.workJobId && (
                <DetailRow label="work job" value={<Code>{session.workJobId}</Code>} />
              )}
              {session.resolvedIntent && (
                <div>
                  <p className="text-xs text-muted mb-1">resolved intent</p>
                  <pre className="text-xs bg-surface-secondary p-2 rounded overflow-x-auto">
                    {JSON.stringify(session.resolvedIntent, null, 2)}
                  </pre>
                </div>
              )}
              <Separator />
              <div className="flex flex-col gap-2">
                {session.status === 'intent-ready' && (
                  <Button variant="primary" onPress={confirmAndRun}>
                    Confirm & run
                  </Button>
                )}
                {session.status !== 'submitted' &&
                  session.status !== 'aborted' &&
                  session.status !== 'expired' && (
                    <Button variant="danger-soft" onPress={abortSession}>
                      Abort session
                    </Button>
                  )}
              </div>
            </>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}

function MessageBar({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="flex gap-2 items-end">
      <TextInput
        placeholder="Type a message…"
        value={text}
        onValueChange={setText}
        isDisabled={disabled}
        className="flex-1"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text && !disabled) {
            onSend(text);
            setText('');
          }
        }}
      />
      <Button
        variant="primary"
        isDisabled={disabled || !text}
        onPress={() => {
          if (text) {
            onSend(text);
            setText('');
          }
        }}
      >
        Send
      </Button>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function StatusChip({ status }: { status: IntentSession['status'] }) {
  const tone =
    status === 'submitted'
      ? 'success'
      : status === 'intent-ready'
        ? 'accent'
        : status === 'aborted' || status === 'failed' || status === 'expired'
          ? 'danger'
          : 'default';
  return (
    <Chip size="sm" color={tone} variant="soft">
      {status}
    </Chip>
  );
}

function safeJson(s: string): unknown | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
