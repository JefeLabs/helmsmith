/**
 * Structural validation of a `.pen` `Document` against the rules that
 * actually break Pencil (all empirically verified against the live
 * app, schema v2.11):
 *
 *   1. wrong/absent `version` literal (must be "2.13")
 *   2. a node missing `id`/`type`, or an unknown `type`
 *   3. an `id` containing `/` — illegal; the slash is reserved as the
 *      `descendants` id-path separator, never part of a node id
 *   4. duplicate ids within the same parent scope
 *   5. a `ref` target that resolves nowhere. A LOCAL ref (`id`) must match
 *      a local `reusable`. A cross-file ref (`alias:id`) is valid when
 *      `alias` is a declared import (Pencil resolves these) — but cross-file
 *      `descendants` are rejected, since overrides don't cross files.
 *   6. a `$variable` reference to an undeclared key
 *
 * Every problem is collected (not just the first) so a generated
 * document can be fixed in one pass.
 */

import { type Child, CHILD_TYPES, type Document, PEN_VERSION } from './schema.ts';

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

const CHILD_TYPE_SET = new Set<string>(CHILD_TYPES);

function collectReusableIds(children: Child[], into: Set<string>): void {
  for (const node of children) {
    if (node.reusable && node.id) into.add(node.id);
    if ('children' in node && Array.isArray(node.children)) {
      collectReusableIds(node.children, into);
    }
  }
}

function walk(
  children: Child[],
  parentPath: string,
  reusableIds: Set<string>,
  declaredVars: Set<string>,
  importAliases: Set<string>,
  issues: ValidationIssue[],
): void {
  const seenIds = new Set<string>();
  children.forEach((node, index) => {
    const here = `${parentPath}[${index}]`;

    if (!node || typeof node !== 'object') {
      issues.push({ path: here, message: 'node is not an object' });
      return;
    }
    if (!node.id) {
      issues.push({ path: here, message: 'node is missing required `id`' });
    } else if (node.id.includes('/')) {
      issues.push({
        path: `${here} (${node.id})`,
        message: `id "${node.id}" contains '/' — illegal; the slash is the descendants path separator, not part of an id`,
      });
    } else if (seenIds.has(node.id)) {
      issues.push({
        path: `${here} (${node.id})`,
        message: `duplicate id "${node.id}" within the same parent`,
      });
    } else {
      seenIds.add(node.id);
    }

    const type = (node as { type?: string }).type;
    if (!type) {
      issues.push({ path: `${here} (${node.id ?? '?'})`, message: 'node is missing required `type`' });
    } else if (!CHILD_TYPE_SET.has(type)) {
      issues.push({ path: `${here} (${node.id ?? '?'})`, message: `unknown node type "${type}"` });
    }

    if (type === 'ref') {
      const target = (node as { ref?: string }).ref;
      const hasDescendants = !!(node as { descendants?: unknown }).descendants;
      if (!target) {
        issues.push({ path: `${here} (${node.id})`, message: 'ref node is missing `ref` target' });
      } else if (target.includes(':') || target.includes('/')) {
        // Cross-file ref (`alias:id`): Pencil resolves these against a declared
        // import (verified). The only true limitation is that `descendants`
        // don't cross files — so allow the ref, but reject cross-file overrides.
        const alias = target.split(/[:/]/)[0];
        if (!importAliases.has(alias)) {
          issues.push({
            path: `${here} (${node.id})`,
            message: `ref target "${target}" uses unknown import alias "${alias}" — declare it in \`imports\``,
          });
        } else if (hasDescendants) {
          issues.push({
            path: `${here} (${node.id})`,
            message: `ref target "${target}" is cross-file but has \`descendants\` — descendant overrides don't cross files; inline a local copy to customize`,
          });
        }
      } else if (!reusableIds.has(target)) {
        issues.push({
          path: `${here} (${node.id})`,
          message: `ref target "${target}" matches no local reusable component`,
        });
      }
    }

    checkVariableRefs(node, here, declaredVars, importAliases, issues);

    if ('children' in node && Array.isArray(node.children)) {
      walk(node.children, here, reusableIds, declaredVars, importAliases, issues);
    }
  });
}

/**
 * Flag `$token` strings whose key was never declared. A `$alias:key`
 * form is an imported variable — valid when `alias` is a declared
 * import (cross-file *variables* resolve; cross-file *component refs*
 * do not, hence only this path is whitelisted).
 */
function checkVariableRefs(
  node: unknown,
  path: string,
  declaredVars: Set<string>,
  importAliases: Set<string>,
  issues: ValidationIssue[],
): void {
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.startsWith('$')) {
        const ref = value.slice(1);
        const colon = ref.indexOf(':');
        if (colon > 0) {
          if (!importAliases.has(ref.slice(0, colon))) {
            issues.push({
              path,
              message: `references "${value}" via unknown import alias "${ref.slice(0, colon)}"`,
            });
          }
        } else if (!declaredVars.has(ref)) {
          issues.push({ path, message: `references undeclared variable "${value}"` });
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) visit(v);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (k === 'children') continue;
        visit(v);
      }
    }
  };
  visit(node);
}

export function validateDocument(doc: Document): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (doc.version !== PEN_VERSION) {
    issues.push({
      path: 'version',
      message: `expected version "${PEN_VERSION}", got ${JSON.stringify(doc.version)}`,
    });
  }

  if (!Array.isArray(doc.children)) {
    issues.push({ path: 'children', message: '`children` must be an array' });
    return { ok: false, issues };
  }

  const reusableIds = new Set<string>();
  collectReusableIds(doc.children, reusableIds);
  const declaredVars = new Set<string>(Object.keys(doc.variables ?? {}));
  const importAliases = new Set<string>(Object.keys(doc.imports ?? {}));

  walk(doc.children, 'children', reusableIds, declaredVars, importAliases, issues);

  return { ok: issues.length === 0, issues };
}
