---
description: Remove or deprecate a pattern, template, or component the project has outgrown. Cleans up the .pen files, the React output (if built), the manifests, and surfaces any downstream references that would break. Inverse of /product:strategy:scaffold's additive nature.
argument-hint: <artifact-path> [--type pattern|template|component|foundation] [--mode deprecate|remove] [--force]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Remove or deprecate an artifact (pattern, template, component, or
foundation). The suite has been additive throughout — `/product:strategy:scaffold`
adds, `/product:design:design-page` adds, `/product:design:patterns:*` adds. This is
the explicit teardown command for when something needs to go away.

Two modes:
- **`--mode deprecate`** (default) — marks the artifact as deprecated
  but keeps it in place. Subsequent commands warn when consumers
  reference it. Existing consumers continue working.
- **`--mode remove`** — actually deletes the `.pen`, the React, the
  manifest entries, and the dependency-graph references. Destructive.

## When to use

- **Deprecation**: a pattern that the brand has moved away from but
  is still used by some pages. Marking it deprecated stops new
  consumers without breaking existing ones.
- **Removal**: a foundation token, component, pattern, or template
  that no consumer references and isn't returning. The dead code is
  pruned to keep the system honest about what it actually has.

## Pre-flight

1. Read `product/strategy/_context.md` (and the active framework's `_context.md`).
2. Resolve the artifact:
   - If `<artifact-path>` is a path like `patterns/hero` or
     `frameworks/heroui/components/buttons`, infer type from path
   - `--type` flag overrides inference when ambiguous
3. Verify the artifact exists. If not, the user may be passing a
   removed name — surface "already removed" message and stop.
4. Read `design/.product-dependencies.json` to find consumers.

## Phase 1 — Find consumers

Walk the dependency graph to find everything that references this
artifact:

- **`design/.product-dependencies.json`** for declared `requires` /
  `consumedBy` entries
- **Template `.pen` files** for inline composition references
- **React code** (`src/components/`, `src/patterns/`, `src/templates/`)
  for actual imports
- **Page `.pen` files** for runtime usage in a page composition
- **`product/.pencil-build-manifest.json`** for build-recorded usage

Surface the findings:

```
Removing: patterns/testimonial-grid

Found 4 consumers:

  Templates declared as requiring this pattern:
    - templates/landing-page (declared in .product-dependencies.json)
    - templates/marketing#about
    - templates/marketing#features

  Pages with build-time usage:
    - design/pages/our-story.pen (built 2026-04-15)

  React imports:
    - src/templates/marketing/about.tsx:14
    - src/templates/landing-page/index.tsx:22
    - src/pages/our-story.tsx:8

  Foundations / patterns this artifact depends on (will NOT be
  removed — they may be used elsewhere):
    - components/surfaces, foundations/imagery, foundations/typography
```

## Phase 2 — Confirm

For deprecate mode (default):

```
Deprecate patterns/testimonial-grid?

This will:
  ✓ Add `deprecated: true` to design/patterns/testimonial-grid.pen metadata
  ✓ Add `@deprecated` JSDoc comment to src/patterns/testimonial-grid/index.tsx
  ✓ Update design/.product-dependencies.json to mark deprecated
  ✓ Audit will warn consumers via Plane 7 (composition drift)

Existing consumers continue working but will see deprecation warnings.

Continue? [Y/n]
```

For remove mode:

```
⚠️  REMOVE patterns/testimonial-grid?

This will DELETE:
  ✗ design/patterns/testimonial-grid.pen
  ✗ src/patterns/testimonial-grid/ (entire directory)
  ✗ Manifest entries in product/.pencil-build-manifest.json
  ✗ Dependency entries in design/.product-dependencies.json

The 4 consumers listed above WILL BREAK:
  - templates/landing-page must be re-rendered without this pattern
  - templates/marketing#about must be re-rendered
  - templates/marketing#features must be re-rendered
  - design/pages/our-story.pen must be regenerated

This action is destructive and cannot be undone except via git revert.

Type the artifact name to confirm: ___
```

The user must type the exact artifact name (`testimonial-grid`) — a
deliberate friction point. `--force` skips this confirmation but
still runs the steps below.

## Phase 3 — Execute

### Deprecate mode

1. **Update the `.pen` metadata**: add `deprecated: true` and
   `deprecatedAt: <ISO date>` to the file's metadata frame. Mark
   visible variant frames with a "Deprecated" badge in their headers.
2. **Update React output** (if built): add `@deprecated` JSDoc
   comment to the component's exports + any default export. Add a
   `console.warn` on first render in dev mode (stripped in prod) so
   developers see the deprecation when running locally.
3. **Update dependency manifest**: set `deprecated: true` on the
   artifact's entry; set `deprecatedAt: <ISO>`.
4. **Add to deprecation log** at `product/.pencil-deprecations.md`:

```markdown
# Deprecation log

| Artifact | Deprecated at | Reason | Migration path |
| -------- | ------------- | ------ | -------------- |
| patterns/testimonial-grid | 2026-05-02 | Brand moved to single-spotlight format | Use patterns/testimonial spotlight variant |
```

### Remove mode

1. **Delete the `.pen`** at the artifact path
2. **Delete the React directory** (if exists)
3. **Remove dependency entries** from
   `design/.product-dependencies.json`
4. **Remove build-manifest entries** from
   `product/.pencil-build-manifest.json`
5. **For each consumer found in Phase 1**, log a "must regenerate"
   action so the user can address them after removal:

```
✓ Removed patterns/testimonial-grid

⚠️  4 consumers must be regenerated:
  1. /product:design:templates:marketing --variants about,features --re-render
  2. /product:design:templates:landing-page --re-render
  3. /product:design:design-page our-story --regenerate
  4. /audit  # to verify no orphans remain
```

## Phase 4 — Audit cleanup

After remove (or deprecate-after-grace-period), run audit
automatically to verify the system is consistent:

- Plane 4 (orphans) — confirm no orphan files left behind
- Plane 7a (composition) — confirm consumers updated or flagged
- Plane 1 — confirm React imports updated

Surface any remaining issues for the user to address.

## Special cases

### Removing a foundation

Foundations are deeply consumed — every component reads from foundation
tokens. Removing a foundation is unusual and warrants extra care:

- The command **always** runs in deprecate mode for foundations,
  ignoring `--mode remove` unless `--force-remove` is set
- A foundation removal triggers an automatic
  `/audit --plane 3` to surface every code reference to the
  about-to-be-removed tokens

### Removing a token (not a whole foundation)

For per-token removal (e.g. retire `--color-accent-300` while keeping
the `colors` foundation), use:

```bash
/product:strategy:remove foundations/colors --token --color-accent-300
```

The flow is the same — find consumers, confirm, remove from `@theme`,
foundation manifest, and `.pen`.

### Removing a template variant (not the whole template)

For per-variant removal (e.g. retire the `magic-link` variant of auth
while keeping signin/signup):

```bash
/product:strategy:remove templates/auth --variant magic-link
```

Updates the template's `variants` array in the dependency manifest,
removes the variant's frames from the template `.pen`, removes the
React component if built.

## Reporting

```
✅ Removed patterns/testimonial-grid

Files deleted:
  design/patterns/testimonial-grid.pen
  src/patterns/testimonial-grid/

Manifest updates:
  design/.product-dependencies.json (1 entry removed)
  product/.pencil-build-manifest.json (1 component removed)

Consumers requiring action:
  4 (see list above)

Deprecation log:
  product/.pencil-deprecations.md (1 new entry)
```

## What this command does NOT do

- Does not auto-update consumer code. Replacing usages in templates
  and pages is the user's call — they may want to use a different
  pattern, inline the composition, or simply remove the consuming
  section entirely.
- Does not roll back recent additions. To undo a recent
  `/product:strategy:scaffold` or `/product:design:patterns:*` invocation, use
  git revert. This command is for deliberate teardown of established
  artifacts.
- Does not remove anything from `product/design/` (the suite source itself).
  Suite-level removals are a Pencil-suite update, handled by
  `/product:strategy:migrate`.
