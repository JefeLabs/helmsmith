export type BaseSource = 'flag' | 'config' | 'remote' | 'fallback';

/**
 * Which branch a PR or rebase targets, most explicit first: the --base flag,
 * then an explicit `baseBranch` in config, then the repository's default
 * branch as GitHub reports it, then `main`. The config loader leaves
 * `baseBranch` undefined when nothing sets it, which is what lets the
 * repository default apply without overriding a value the user chose.
 */
export function resolveBaseBranch(o: {
  flag?: string | undefined;
  config?: string | undefined;
  remoteDefault?: string | undefined;
}): { base: string; source: BaseSource } {
  if (o.flag) return { base: o.flag, source: 'flag' };
  if (o.config) return { base: o.config, source: 'config' };
  if (o.remoteDefault) return { base: o.remoteDefault, source: 'remote' };
  return { base: 'main', source: 'fallback' };
}
