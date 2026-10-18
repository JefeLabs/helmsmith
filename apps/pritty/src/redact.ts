/**
 * What leaves the machine for the model: the staged diff, after redaction,
 * and never more than the caller's cap. The patterns here are deliberately
 * broad; a false positive costs the model one value, a false negative sends
 * a secret to a third party.
 */

const SECRET_FILE =
  /(^|\/)(\.env(\..*)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*credentials.*|.*secrets?\.(json|ya?ml|toml))$/i;
const ASSIGNMENT =
  /^([+-]\s*(?:export\s+)?["']?[\w.-]*(?:secret|token|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|auth|credential|client[_-]?secret)[\w.-]*["']?\s*[:=]\s*)(.+)$/i;
const BEARER = /((?:bearer|basic)\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
const KNOWN_TOKENS =
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20,})\b/g;
const PEM_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const PEM_END = /-----END [A-Z ]*PRIVATE KEY-----/;

export function redactDiff(diff: string): string {
  const out: string[] = [];
  let omitting = false;
  let inPem = false;
  for (const line of diff.split('\n')) {
    const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (header) {
      omitting = SECRET_FILE.test(header[2]!);
      inPem = false;
      out.push(omitting ? `[diff for ${header[2]} omitted]` : line);
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
