/**
 * What leaves the machine for the model: the staged diff, after redaction,
 * and never more than the caller's cap. The patterns here are deliberately
 * broad; a false positive costs the model one value, a false negative sends
 * a secret to a third party.
 */

const SECRET_FILE =
  /(^|\/)(\.env(\..*)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*credentials.*|.*secrets?\.(json|ya?ml|toml))$/i;
const ASSIGNMENT =
  /^([ +-]?\s*(?:export\s+)?["']?[\w.-]*(?:secret|token|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|auth|credential|client[_-]?secret)[\w.-]*["']?\s*[:=]\s*)(.+)$/i;
const BEARER = /((?:bearer|basic)\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
const KNOWN_TOKENS =
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20,})\b/g;
const PEM_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const PEM_END = /-----END [A-Z ]*PRIVATE KEY-----/;

function unquotePath(p: string): string {
  const unquoted =
    p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1).replace(/\\(.)/g, '$1') : p;
  return unquoted.replace(/^[ab]\//, '');
}

/**
 * Candidate paths named by a diff header. git quotes a path only when it has
 * control or non-ASCII characters, so `a/my file.env b/my file.env` arrives
 * unquoted and ambiguous; every ` b/` split is returned and the caller omits
 * the file if any candidate is a secret. Returns null for non-header lines.
 */
function headerPaths(line: string): string[] | null {
  const git = line.match(/^diff --git (.+)$/);
  if (git) {
    const rest = git[1]!;
    const quoted = rest.match(/^("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*")$/);
    if (quoted) return [unquotePath(quoted[1]!), unquotePath(quoted[2]!)];
    const out: string[] = [];
    let at = rest.indexOf(' b/');
    while (at !== -1) {
      out.push(unquotePath(rest.slice(0, at)), unquotePath(rest.slice(at + 1)));
      at = rest.indexOf(' b/', at + 1);
    }
    return out.length > 0 ? out : [rest];
  }
  const combined = line.match(/^diff --(?:cc|combined) (.+)$/);
  if (combined) return [unquotePath(combined[1]!)];
  return null;
}

/** Per-file metadata lines that also name the file; `/dev/null` is not a path. */
function metaPath(line: string): string | null {
  const m = line.match(/^(?:--- |\+\+\+ |rename from |rename to |copy from |copy to )(.+)$/);
  if (!m || m[1] === '/dev/null') return null;
  return unquotePath(m[1]!);
}

const isSecretPath = (p: string): boolean => SECRET_FILE.test(p);

export function redactDiff(diff: string): string {
  const out: string[] = [];
  let omitting = false;
  let announced = false;
  let inPem = false;
  for (const raw of diff.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const paths = headerPaths(line);
    if (paths) {
      omitting = paths.some(isSecretPath);
      announced = false;
      inPem = false;
      if (omitting) {
        out.push(`[diff for ${paths[paths.length - 1]} omitted]`);
        announced = true;
      } else out.push(line);
      continue;
    }
    const meta = metaPath(line);
    if (meta && isSecretPath(meta) && !omitting) {
      // the header was ambiguous or missing; the file names itself here, before any content
      omitting = true;
      if (!announced) {
        out.push(`[diff for ${meta} omitted]`);
        announced = true;
      }
      continue;
    }
    if (omitting) continue;
    if (inPem) {
      if (PEM_END.test(line)) inPem = false;
      continue;
    }
    if (PEM_BEGIN.test(line)) {
      inPem = !PEM_END.test(line);
      out.push(`${line[0] ?? ''}[private key omitted]`);
      continue;
    }
    let l = line;
    const assignment = l.match(ASSIGNMENT);
    if (assignment) l = `${assignment[1]}[REDACTED]`;
    l = l.replace(BEARER, '$1[REDACTED]').replace(KNOWN_TOKENS, '[REDACTED]');
    out.push(l);
  }
  return out.join('\n');
}

/** Reject `promise` if it has not settled within `ms`, naming the call in the error. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
