/**
 * Layer 2: file bundle validation. Sync, deterministic, ms-latency.
 *
 * Skills can ship companion files alongside SKILL.md (helper scripts,
 * config, additional documentation). Companion files are the security
 * boundary — script files in particular are executable code that
 * downstream users will run. This layer enforces:
 *
 *   - Path safety: no traversal (`..`), no absolute paths, no leading
 *     slash, no null bytes. Server-side defense against malicious or
 *     accidental path manipulation.
 *   - File-type allowlist: only declared extensions allowed. Binaries,
 *     archive formats, and untyped data are rejected.
 *   - Size limits: per-file and total bundle. Caps the layer-3 token
 *     budget and resists pathological submissions.
 *   - Required-files-by-kind: skills must include SKILL.md;
 *     commands/workflows must include exactly one .md file.
 *   - Content scanning: hardcoded secrets (AWS keys, GitHub tokens,
 *     Anthropic keys, private keys) flagged at high severity. JSON
 *     files must parse cleanly.
 *
 * Note: this layer doesn't try to decide whether the contents of a
 * script file are "safe to run" beyond the obvious patterns. That's
 * layer 3's job (agent review) — pattern-matching for shell-injection
 * idioms is too false-positive-prone to gate at the deterministic
 * layer.
 */

import type {
  ContributionFile,
  ContributionKind,
  CreateContributionRequest,
  ReviewFinding,
} from "../contracts.js";

const ALLOWED_EXTENSIONS = new Set([
  ".md",
  ".py",
  ".sh",
  ".ts",
  ".js",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
]);

/** Per-file size limit. 100KB is generous for any single artifact —
 *  a 100KB markdown body is novella-length; a 100KB script is large
 *  for a skill helper. Submissions over this should be split. */
const MAX_FILE_BYTES = 100_000;

/** Total bundle size limit. 1MB caps layer-3 token cost when review
 *  is enabled and protects against pathological submissions. */
const MAX_TOTAL_BYTES = 1_000_000;

/** Hard cap on file count. Skills with more than this many companion
 *  files should be split into multiple skills. Resists ZIP-bomb-style
 *  many-tiny-files attacks. */
const MAX_FILE_COUNT = 20;

/* ── secret-pattern signatures ────────────────────────────────── */

/**
 * Hardcoded-credential patterns flagged at high severity. The regexes
 * are conservative — high-precision over high-recall — to keep false
 * positives near zero. A few well-chosen patterns catch the obvious
 * cases without snagging legitimate strings.
 */
interface SecretPattern {
  name: string;
  regex: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { name: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub personal access token", regex: /\bghp_[A-Za-z0-9]{36}\b/ },
  { name: "GitHub OAuth token", regex: /\bgho_[A-Za-z0-9]{36}\b/ },
  { name: "GitHub app token", regex: /\bghs_[A-Za-z0-9]{36}\b/ },
  { name: "Anthropic API key", regex: /\bsk-ant-api[0-9]{2}-[A-Za-z0-9_-]{40,}\b/ },
  { name: "OpenAI API key", regex: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: "PEM private key block", regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: "Slack webhook URL", regex: /https:\/\/hooks\.slack\.com\/services\/[A-Z0-9/]{30,}/ },
];

/* ── public entry ─────────────────────────────────────────────── */

export function validateFileBundle(
  req: CreateContributionRequest,
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  validateFileCount(req.files, findings);
  validateRequiredFiles(req.kind, req.files, findings);

  let totalBytes = 0;
  for (const file of req.files) {
    validatePath(file.path, findings);
    validateExtension(file.path, findings);
    validateSize(file, findings);
    totalBytes += file.content.length;
    scanForSecrets(file, findings);
    validateStructuredFile(file, findings);
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    findings.push({
      severity: "high",
      axis: "bundle",
      message: `Bundle size ${totalBytes} bytes exceeds limit of ${MAX_TOTAL_BYTES}. Trim companion files or split into multiple artifacts.`,
    });
  }

  return findings;
}

/* ── file count ──────────────────────────────────────────────── */

function validateFileCount(
  files: ContributionFile[],
  findings: ReviewFinding[],
): void {
  if (files.length === 0) {
    findings.push({
      severity: "high",
      axis: "bundle",
      message: `Contribution has no files. At minimum, the primary .md file must be present.`,
    });
    return;
  }
  if (files.length > MAX_FILE_COUNT) {
    findings.push({
      severity: "high",
      axis: "bundle",
      message: `Bundle has ${files.length} files; max ${MAX_FILE_COUNT}. Consider splitting into multiple skills.`,
    });
  }
}

/* ── required files by kind ──────────────────────────────────── */

function validateRequiredFiles(
  kind: ContributionKind,
  files: ContributionFile[],
  findings: ReviewFinding[],
): void {
  if (kind === "skill") {
    const hasSkillMd = files.some((f) => f.path === "SKILL.md");
    if (!hasSkillMd) {
      findings.push({
        severity: "high",
        axis: "bundle",
        message: `Skill bundles must include SKILL.md at the root of the bundle.`,
      });
    }
    return;
  }
  // Commands and workflows: exactly one .md file
  const mdFiles = files.filter((f) => f.path.endsWith(".md"));
  if (mdFiles.length !== 1) {
    findings.push({
      severity: "high",
      axis: "bundle",
      message: `${kind} contributions must contain exactly one .md file; got ${mdFiles.length}.`,
    });
  }
}

/* ── path safety ─────────────────────────────────────────────── */

function validatePath(path: string, findings: ReviewFinding[]): void {
  if (!path || path.length === 0) {
    findings.push({
      severity: "high",
      axis: "bundle",
      message: `File has empty path`,
    });
    return;
  }
  if (path.startsWith("/")) {
    findings.push({
      severity: "high",
      axis: "bundle",
      message: `Path \`${path}\` is absolute — paths must be relative to the bundle root`,
      fileRef: path,
    });
  }
  // Reject `..` segments anywhere — both the literal `..` segment and
  // the `\` Windows variant. Splitting on any path-separator catches
  // both styles even if the client mis-normalizes.
  const segments = path.split(/[/\\]/);
  if (segments.some((seg) => seg === "..")) {
    findings.push({
      severity: "high",
      axis: "bundle",
      message: `Path \`${path}\` contains \`..\` traversal — disallowed`,
      fileRef: path,
    });
  }
  if (path.includes("\0")) {
    findings.push({
      severity: "high",
      axis: "bundle",
      message: `Path \`${path}\` contains null byte`,
      fileRef: path,
    });
  }
  // Hidden files / control chars at the start of any segment
  if (segments.some((seg) => seg.startsWith("."))) {
    findings.push({
      severity: "medium",
      axis: "bundle",
      message: `Path \`${path}\` contains a dotfile segment — usually unintentional in contributions`,
      fileRef: path,
    });
  }
}

/* ── file extension allowlist ────────────────────────────────── */

function validateExtension(path: string, findings: ReviewFinding[]): void {
  const dotIdx = path.lastIndexOf(".");
  const ext = dotIdx === -1 ? "" : path.slice(dotIdx);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    findings.push({
      severity: "high",
      axis: "bundle",
      message: `File extension \`${ext || "(none)"}\` is not in the allowlist. Allowed: ${[
        ...ALLOWED_EXTENSIONS,
      ].join(", ")}`,
      fileRef: path,
    });
  }
}

/* ── size ────────────────────────────────────────────────────── */

function validateSize(file: ContributionFile, findings: ReviewFinding[]): void {
  if (file.content.length > MAX_FILE_BYTES) {
    findings.push({
      severity: "high",
      axis: "bundle",
      message: `File \`${file.path}\` is ${file.content.length} bytes; max ${MAX_FILE_BYTES}.`,
      fileRef: file.path,
    });
  }
}

/* ── secret scan ─────────────────────────────────────────────── */

function scanForSecrets(file: ContributionFile, findings: ReviewFinding[]): void {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.regex.test(file.content)) {
      findings.push({
        severity: "high",
        axis: "safety",
        message: `File \`${file.path}\` contains what looks like a hardcoded ${pattern.name}. Remove the secret before submitting.`,
        fileRef: file.path,
      });
    }
  }
}

/* ── structured-file parse check ─────────────────────────────── */

function validateStructuredFile(
  file: ContributionFile,
  findings: ReviewFinding[],
): void {
  if (file.path.endsWith(".json")) {
    try {
      JSON.parse(file.content);
    } catch (err) {
      findings.push({
        severity: "high",
        axis: "bundle",
        message: `JSON file \`${file.path}\` does not parse: ${(err as Error).message}`,
        fileRef: file.path,
      });
    }
  }
  // YAML / TOML parse-checks intentionally skipped at this layer —
  // adding a YAML/TOML parser dep just for malformedness checks isn't
  // worth it. The agent reviewer (layer 3) will surface obvious YAML
  // issues during quality review.
}
