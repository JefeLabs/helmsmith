import { Button, Card, Chip, Modal, Separator, Tabs, useOverlayState } from '@heroui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Code, LoadingSpinner, PendingButton, TextInput } from '../components/ui';
import { ProposalStatus, RemoteStatus, SkillProposal, skillProposals } from '../lib/api';

/**
 * Skill-proposal admin queue. Shows proposals (defaults to status=
 * proposed); each card surfaces the proposed skill's name, category,
 * tags, rationale, source-job link, and Approve / Reject actions.
 *
 * Approve: POSTs to controlplane → service seeds a draft into
 * catalog_items + transitions the proposal to status=approved.
 * Reject: prompts for a reason via modal → POSTs with the reason.
 */
export default function ProposalsPage() {
  const [status, setStatus] = useState<ProposalStatus>('proposed');

  const { data, isPending, error } = useQuery({
    queryKey: ['skill-proposals', status],
    queryFn: () => skillProposals.list(status),
    refetchInterval: 5_000,
  });

  return (
    <div className="space-y-4">
      <Card>
        <Card.Header className="flex flex-col gap-1 items-start">
          <p className="text-base font-semibold">Skill proposals</p>
          <p className="text-sm text-muted">
            Surfaced from job reflections that flagged <Code>{`{kind:"missing-skill"}`}</Code>{' '}
            surprises. Approve to seed a draft into the catalog.
          </p>
        </Card.Header>
        <Separator />
        <Card.Content>
          {/* The tab strip only selects the status filter; the list below renders outside the panels. */}
          <Tabs
            selectedKey={status}
            onSelectionChange={(k) => setStatus(String(k) as ProposalStatus)}
          >
            <Tabs.ListContainer>
              <Tabs.List aria-label="proposal status">
                {(['proposed', 'approved', 'rejected'] as const).map((s) => (
                  <Tabs.Tab key={s} id={s}>
                    {s[0].toUpperCase() + s.slice(1)}
                    <Tabs.Indicator />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs.ListContainer>
            {(['proposed', 'approved', 'rejected'] as const).map((s) => (
              <Tabs.Panel key={s} id={s} className="hidden">
                {null}
              </Tabs.Panel>
            ))}
          </Tabs>
        </Card.Content>
      </Card>

      {isPending && <LoadingSpinner label="Loading proposals…" />}
      {error && <Code color="danger">{String(error)}</Code>}
      {data && data.length === 0 && (
        <Card>
          <Card.Content>
            <p className="text-muted">No {status} proposals.</p>
          </Card.Content>
        </Card>
      )}
      {data && data.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {data.map((p) => (
            <ProposalCard key={p.id} proposal={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: SkillProposal }) {
  const qc = useQueryClient();
  const rejectModal = useOverlayState();
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      await skillProposals.approve(proposal.id);
      await qc.invalidateQueries({ queryKey: ['skill-proposals'] });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!rejectReason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await skillProposals.reject(proposal.id, rejectReason);
      rejectModal.close();
      setRejectReason('');
      await qc.invalidateQueries({ queryKey: ['skill-proposals'] });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function resubmit() {
    setBusy(true);
    setError(null);
    try {
      await skillProposals.resubmit(proposal.id);
      await qc.invalidateQueries({ queryKey: ['skill-proposals'] });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // Show resubmit only on approved proposals that have either never
  // been pushed (remoteStatus == null — likely approved before
  // skillzkit was wired) or failed transport (remoteStatus === 'failed').
  // In-flight states (pending/reviewing) and terminal-accepted states
  // (accepted/promoted/rejected by skillzkit) shouldn't show resubmit:
  // they're either polling or settled.
  const canResubmit =
    proposal.status === 'approved' &&
    (proposal.remoteStatus == null || proposal.remoteStatus === 'failed');

  return (
    <Card>
      <Card.Header className="flex flex-row justify-between items-start gap-2">
        <div className="flex flex-col gap-1">
          <Code className="font-mono">{proposal.name}</Code>
          <div className="flex flex-wrap gap-1">
            {proposal.category && (
              <Chip size="sm" variant="soft">
                {proposal.category}
              </Chip>
            )}
            {proposal.tags.map((t) => (
              <Chip key={t} size="sm" variant="soft" color="default">
                {t}
              </Chip>
            ))}
            <StatusChip status={proposal.status} />
            {proposal.status === 'approved' && (
              <SkillzkitChip remoteStatus={proposal.remoteStatus} remoteUrl={proposal.remoteUrl} />
            )}
          </div>
        </div>
      </Card.Header>
      <Separator />
      <Card.Content className="space-y-2 text-sm">
        {proposal.description && (
          <div>
            <span className="text-muted text-xs">description</span>
            <p>{proposal.description}</p>
          </div>
        )}
        {proposal.rationale && (
          <div>
            <span className="text-muted text-xs">rationale</span>
            <p>{proposal.rationale}</p>
          </div>
        )}
        {proposal.sourceJobId && (
          <div>
            <span className="text-muted text-xs">source job</span>
            <Code className="block">{proposal.sourceJobId}</Code>
          </div>
        )}
        {proposal.status === 'approved' && proposal.catalogItemId && (
          <div>
            <span className="text-muted text-xs">catalog item</span>
            <Code className="block">{proposal.catalogItemId}</Code>
          </div>
        )}
        {proposal.status === 'rejected' && proposal.rejectionReason && (
          <div>
            <span className="text-muted text-xs">rejection reason</span>
            <p className="text-danger">{proposal.rejectionReason}</p>
          </div>
        )}
        {proposal.status === 'approved' && proposal.remoteError && (
          <div>
            <span className="text-muted text-xs">skillzkit error</span>
            <p className="text-danger break-words">{proposal.remoteError}</p>
          </div>
        )}
        {error && <Code color="danger">{error}</Code>}

        {proposal.status === 'proposed' && (
          <>
            <Separator />
            <div className="flex gap-2">
              <PendingButton variant="primary" onPress={approve} pending={busy}>
                Approve
              </PendingButton>
              <Button variant="danger-soft" onPress={rejectModal.open}>
                Reject
              </Button>
            </div>
          </>
        )}

        {canResubmit && (
          <>
            <Separator />
            <div className="flex gap-2 items-center">
              <PendingButton variant="tertiary" onPress={resubmit} pending={busy}>
                Resubmit to skillzkit
              </PendingButton>
              <span className="text-xs text-muted">
                {proposal.remoteStatus === 'failed'
                  ? 'Last submit failed — retry'
                  : 'Approved before skillzkit was wired'}
              </span>
            </div>
          </>
        )}
      </Card.Content>

      <Modal state={rejectModal}>
        <Modal.Backdrop>
          <Modal.Container size="md">
            <Modal.Dialog>
              {({ close }) => (
                <>
                  <Modal.CloseTrigger />
                  <Modal.Header>
                    <Modal.Heading>Reject {proposal.name}</Modal.Heading>
                  </Modal.Header>
                  <Modal.Body>
                    <TextInput
                      label="Reason"
                      placeholder="Why is this proposal being rejected?"
                      value={rejectReason}
                      onValueChange={setRejectReason}
                    />
                  </Modal.Body>
                  <Modal.Footer>
                    <Button variant="secondary" onPress={close}>
                      Cancel
                    </Button>
                    <PendingButton
                      variant="danger"
                      onPress={reject}
                      pending={busy}
                      isDisabled={!rejectReason.trim()}
                    >
                      Reject
                    </PendingButton>
                  </Modal.Footer>
                </>
              )}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </Card>
  );
}

function StatusChip({ status }: { status: ProposalStatus }) {
  const tone = status === 'approved' ? 'success' : status === 'rejected' ? 'danger' : 'accent';
  return (
    <Chip size="sm" color={tone} variant="soft">
      {status}
    </Chip>
  );
}

/**
 * Skillzkit upstream-submission status. Distinct from the proposal's
 * own status (the local approve/reject flow). Only meaningful on
 * approved proposals — the parent gates rendering accordingly.
 *
 *   - null            → never submitted (e.g., skillzkit not configured
 *                       at approve time). Operator sees the resubmit
 *                       button below.
 *   - pending         → submitted, awaiting skillzkit's review.
 *   - reviewing       → skillzkit reviewer engaged.
 *   - accepted/promoted → terminal success; local draft was dropped.
 *   - rejected        → skillzkit declined; local draft kept.
 *   - failed          → transport / 5xx error on submit. Resubmit
 *                       button below offers retry.
 */
function SkillzkitChip({
  remoteStatus,
  remoteUrl,
}: {
  remoteStatus?: RemoteStatus;
  remoteUrl?: string;
}) {
  if (remoteStatus == null) {
    return (
      <Chip size="sm" color="warning" variant="soft">
        skillzkit: not sent
      </Chip>
    );
  }
  const tone: 'accent' | 'success' | 'danger' | 'warning' =
    remoteStatus === 'accepted' || remoteStatus === 'promoted'
      ? 'success'
      : remoteStatus === 'rejected' || remoteStatus === 'failed'
        ? 'danger'
        : remoteStatus === 'reviewing'
          ? 'accent'
          : 'warning'; // 'pending'
  const label = `skillzkit: ${remoteStatus}`;

  // Wrap the chip in a link only when we have a destination. The
  // remoteUrl is the skillzkit /api/v1/contributions/{id} endpoint —
  // useful for ops debugging even though it's an API path, not a UI
  // route. Future: if skillzkit ships a UI per-contribution page,
  // wire that URL on its side.
  const chip = (
    <Chip size="sm" color={tone} variant="soft">
      {label}
    </Chip>
  );
  if (remoteUrl) {
    return (
      <a href={remoteUrl} target="_blank" rel="noreferrer" title={remoteUrl}>
        {chip}
      </a>
    );
  }
  return chip;
}
