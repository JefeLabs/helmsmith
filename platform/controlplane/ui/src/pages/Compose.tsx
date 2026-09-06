import { Button, Card, Chip, Label, Radio, RadioGroup, Separator } from '@heroui/react';
import { useMemo, useState } from 'react';
import {
  Code,
  LoadingSpinner,
  PendingButton,
  SelectField,
  TextAreaField,
  TextInput,
} from '../components/ui';
import { ApiError, ComposeResponse, ContributionKind, compose, ReviewFinding } from '../lib/api';

/**
 * Compose page - author a new skillzkit contribution from scratch.
 *
 * Form captures the minimum skillzkit's POST /contributions needs:
 * kind, slug, frontmatter (description + tags + kind-specific
 * required fields), and the markdown body. Submitted via the
 * controlplane's compose endpoint, which proxies to skillzkit.
 *
 * Result panel renders one of:
 *   - success: contribution id + version + a "view in skillzkit"
 *     hint. Status will be `accepted` (stored, awaiting promotion).
 *   - validation findings: grouped by severity, each with axis +
 *     message + optional fileRef. Mirrors what `skillzkit contribute`
 *     prints on the CLI.
 *   - author mismatch: explains who owns the slug.
 *   - slug conflict: suggests bumping the version.
 *   - generic error: status code + message.
 */
export default function ComposePage() {
  const [kind, setKind] = useState<ContributionKind>('command');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [body, setBody] = useState('');
  const [outcome, setOutcome] = useState(''); // workflow-only
  const [versionBump, setVersionBump] = useState<'major' | 'minor' | 'patch'>('patch');
  const [changelog, setChangelog] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ComposeResponse | null>(null);
  const [err, setErr] = useState<ApiError | Error | null>(null);

  const tags = useMemo(
    () =>
      tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    [tagsInput],
  );

  // Slug-format hint depends on kind:
  //   command/workflow: lowercase, colon-separated, e.g. core:tools:my-thing
  //   skill: lowercase, hyphenated, e.g. skillzkit-my-router
  const slugHint =
    kind === 'skill'
      ? 'lowercase, hyphenated (e.g. skillzkit-my-router)'
      : 'lowercase, colon-separated (e.g. core:tools:my-thing or product:strategy:my-task)';

  // Derive the file path for the bundle from the slug. For skills,
  // SKILL.md is at the root. For commands/workflows, the path mirrors
  // the slug structure - so `core:tools:foo` lands at
  // `core/tools/foo.md`.
  const filePath = useMemo(() => {
    if (kind === 'skill') return 'SKILL.md';
    return `${slug.replace(/:/g, '/')}.md`;
  }, [kind, slug]);

  function buildFrontmatter(): Record<string, unknown> {
    const fm: Record<string, unknown> = {};
    if (description.trim()) fm.description = description.trim();
    if (tags.length > 0) fm.tags = tags;
    if (kind === 'workflow' && outcome.trim()) fm.outcome = outcome.trim();
    if (kind === 'skill' && slug.trim()) fm.name = slug.trim();
    return fm;
  }

  function buildFileContent(): string {
    // Reconstruct the .md body with frontmatter at the top so the
    // server-side parse re-derives the same fields. Skipping
    // frontmatter in the file content would force the server to
    // synthesize it, which is fragile.
    const fm = buildFrontmatter();
    if (Object.keys(fm).length === 0) return body;
    const lines: string[] = ['---'];
    for (const [k, v] of Object.entries(fm)) {
      if (Array.isArray(v)) {
        lines.push(`${k}: [${v.join(', ')}]`);
      } else {
        lines.push(`${k}: ${typeof v === 'string' ? JSON.stringify(v) : v}`);
      }
    }
    lines.push('---');
    lines.push('');
    lines.push(body);
    return lines.join('\n');
  }

  function canSubmit(): boolean {
    if (busy) return false;
    if (!slug.trim()) return false;
    if (!description.trim()) return false;
    if (!body.trim()) return false;
    if (kind === 'workflow' && !outcome.trim()) return false;
    return true;
  }

  async function submit() {
    setBusy(true);
    setResult(null);
    setErr(null);
    try {
      const response = await compose.submit({
        kind,
        slug: slug.trim(),
        frontmatter: buildFrontmatter(),
        files: [{ path: filePath, content: buildFileContent() }],
        versionBump,
        changelog: changelog.trim() || undefined,
      });
      setResult(response);
    } catch (e) {
      setErr(e as ApiError | Error);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setSlug('');
    setDescription('');
    setTagsInput('');
    setBody('');
    setOutcome('');
    setChangelog('');
    setResult(null);
    setErr(null);
  }

  return (
    <div className="space-y-4">
      <Card>
        <Card.Header className="flex flex-col gap-1 items-start">
          <p className="text-base font-semibold">Compose a contribution</p>
          <p className="text-sm text-muted">
            Author a new skillzkit command, workflow, or skill and submit it directly to the
            upstream catalog. The bundle goes through structural + file + agent-review validation
            server-side; findings (if any) are shown below.
          </p>
        </Card.Header>
        <Separator />
        <Card.Content className="space-y-4">
          <RadioGroup
            name="kind"
            orientation="horizontal"
            value={kind}
            onChange={(v) => setKind(v as ContributionKind)}
          >
            <Label>Kind</Label>
            {(['command', 'workflow', 'skill'] as const).map((k) => (
              <Radio key={k} value={k}>
                <Radio.Content>
                  <Radio.Control>
                    <Radio.Indicator />
                  </Radio.Control>
                  {k}
                </Radio.Content>
              </Radio>
            ))}
          </RadioGroup>

          <TextInput
            label="Slug"
            placeholder={kind === 'skill' ? 'skillzkit-my-router' : 'core:tools:my-thing'}
            description={slugHint}
            value={slug}
            onValueChange={setSlug}
            isRequired
          />

          <TextInput
            label="Description"
            placeholder="What this artifact does, in one or two sentences"
            value={description}
            onValueChange={setDescription}
            isRequired
          />

          <TextInput
            label="Tags"
            placeholder="comma-separated: research, accessibility, brand"
            description="Lowercase, hyphen-separated. See TAGS.md for the curated core list."
            value={tagsInput}
            onValueChange={setTagsInput}
          />

          {kind === 'workflow' && (
            <TextInput
              label="Outcome"
              placeholder="Imperative verb + outcome, e.g. 'Apply a brand refresh'"
              description="Required for workflows - displayed as the row label in TUI/CLI listings."
              value={outcome}
              onValueChange={setOutcome}
              isRequired
            />
          )}

          <TextAreaField
            label="Body (markdown)"
            placeholder={`# ${slug || 'Your artifact'}\n\nThe markdown body that drives this artifact.`}
            description={
              kind === 'skill'
                ? "SKILL.md body - the agent-facing prompt that defines this skill's behavior."
                : 'The slash-command body - what runs when /<slug> is invoked.'
            }
            rows={10}
            value={body}
            onValueChange={setBody}
            isRequired
          />

          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Version bump"
              value={versionBump}
              onValueChange={(v) => setVersionBump(v as 'major' | 'minor' | 'patch')}
              description="patch by default; bump higher for breaking changes"
              options={[
                { id: 'patch', label: 'patch' },
                { id: 'minor', label: 'minor' },
                { id: 'major', label: 'major' },
              ]}
            />
            <TextInput
              label="Changelog (optional)"
              placeholder="What changed in this version"
              value={changelog}
              onValueChange={setChangelog}
            />
          </div>

          <Separator />

          <div className="flex gap-2">
            <PendingButton
              variant="primary"
              onPress={submit}
              pending={busy}
              isDisabled={!canSubmit()}
            >
              Submit to skillzkit
            </PendingButton>
            <Button variant="secondary" onPress={reset} isDisabled={busy}>
              Reset
            </Button>
          </div>

          {kind === 'skill' && (
            <p className="text-xs text-muted">
              Skill bundles can include companion script files (.py, .sh, .json, etc.) — adding a
              multi-file uploader is a planned v2 enhancement. For now, single-body skills only.
            </p>
          )}
        </Card.Content>
      </Card>

      {busy && <LoadingSpinner label="Submitting…" />}

      {result && <SuccessCard result={result} />}
      {err && <ErrorCard error={err} />}
    </div>
  );
}

function SuccessCard({ result }: { result: ComposeResponse }) {
  return (
    <Card>
      <Card.Header>
        <p className="text-base font-semibold text-success">✓ Accepted by skillzkit</p>
      </Card.Header>
      <Separator />
      <Card.Content className="space-y-2 text-sm">
        <div className="flex flex-wrap gap-1 items-center">
          <Code>{result.id}</Code>
          <Chip size="sm" color="success" variant="soft">
            {result.status}
          </Chip>
          {result.promoted ? (
            <Chip size="sm" color="success" variant="soft">
              promoted (live)
            </Chip>
          ) : (
            <Chip size="sm" color="warning" variant="soft">
              awaiting promote
            </Chip>
          )}
        </div>
        {result.version && (
          <p>
            <span className="text-muted text-xs">version</span> <Code>{result.version}</Code>
          </p>
        )}
        <p>
          <span className="text-muted text-xs">author</span> {result.author.displayName}
          {result.author.email ? ` <${result.author.email}>` : ''}
        </p>
        {result.findings.length > 0 && (
          <details>
            <summary className="cursor-pointer text-muted text-xs">
              {result.findings.length} non-blocking finding(s)
            </summary>
            <FindingsList findings={result.findings} />
          </details>
        )}
        <p className="text-xs text-muted">
          Stored at <Code>{`v1/${result.kind}s/${result.slug}@${result.version}.json`}</Code>. A
          maintainer can promote this version to the catalog index from the Proposals page.
        </p>
      </Card.Content>
    </Card>
  );
}

function ErrorCard({ error }: { error: ApiError | Error }) {
  const apiErr = error instanceof ApiError ? error : null;
  const code = apiErr?.code;
  const findings =
    (apiErr?.details as { findings?: ReviewFinding[] } | undefined)?.findings ?? null;
  const ownerAuthorId =
    (apiErr?.details as { ownerAuthorId?: string } | undefined)?.ownerAuthorId ?? null;

  let title = 'Submission failed';
  let hint: string | null = null;
  if (code === 'validation_failed') {
    title = 'Validation failed';
    hint = 'Fix the findings below and resubmit.';
  } else if (code === 'author_mismatch') {
    title = 'Slug owned by another author';
    hint = ownerAuthorId
      ? `${ownerAuthorId} already publishes this slug. Pick a different slug, or coordinate with that author.`
      : 'Pick a different slug.';
  } else if (code === 'slug_conflict') {
    title = 'Version already exists';
    hint = 'Bump the version and resubmit.';
  } else if (code === 'unauthorized') {
    title = 'Authentication failed';
    hint = 'Your skillzkit credentials may be expired. Contact your administrator.';
  }

  return (
    <Card>
      <Card.Header>
        <p className="text-base font-semibold text-danger">✗ {title}</p>
      </Card.Header>
      <Separator />
      <Card.Content className="space-y-2 text-sm">
        <Code color="danger" className="block whitespace-pre-wrap">
          {error.message}
        </Code>
        {hint && <p className="text-foreground">{hint}</p>}
        {findings && findings.length > 0 && <FindingsList findings={findings} />}
      </Card.Content>
    </Card>
  );
}

function FindingsList({ findings }: { findings: ReviewFinding[] }) {
  // Group by severity so reviewers fix the blockers first
  const grouped: Record<'high' | 'medium' | 'low', ReviewFinding[]> = {
    high: [],
    medium: [],
    low: [],
  };
  for (const f of findings) grouped[f.severity]?.push(f);

  return (
    <div className="space-y-3">
      {(['high', 'medium', 'low'] as const).map((sev) => {
        const items = grouped[sev];
        if (items.length === 0) return null;
        const tone = sev === 'high' ? 'danger' : sev === 'medium' ? 'warning' : 'default';
        return (
          <div key={sev} className="space-y-1">
            <Chip size="sm" color={tone} variant="soft">
              {sev.toUpperCase()} ({items.length})
            </Chip>
            <ul className="space-y-1 ml-2">
              {items.map((f, idx) => (
                <li key={idx} className="text-sm">
                  <span className="text-muted text-xs">{f.axis}:</span> {f.message}
                  {f.fileRef && <Code className="ml-1">{f.fileRef}</Code>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
