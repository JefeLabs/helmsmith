# @helmsmith/skillzkit-types

**Source of truth** for the skillzkit catalog shape. The TypeScript
definitions in `src/index.ts` are authoritative; the JSON Schema at
`apps/skillzkit/schema/catalog.schema.json` is a *generated* artifact.

## The pipeline

```
src/index.ts (this package — canonical, hand-authored TS)
    │
    │ npm run build:schema  →  ts-json-schema-generator
    ▼
apps/skillzkit/schema/catalog.schema.json (generated, checked in)
    │
    │ jsonschema2pojo  (in agentx-platform CI)
    ▼
Java POJOs in agentx-platform's catalog backend service
```

Why TS-first:

- **TypeScript is the toolbox's native language** — every toolbox app
  is TS, so authoring in TS is the natural choice.
- **Constraints expressed via JSDoc tags** (`@pattern`, `@format`,
  `@minimum`, `@additionalProperties`) propagate cleanly to the
  generated JSON Schema. Most JSON Schema features have a TS-native
  equivalent or a JSDoc tag.
- **No source duplication** — one file expresses the contract; both
  the TS types and the JSON Schema fall out of it.

The generated `catalog.schema.json` is checked into the repo so
agentx-platform's Java side can read it without depending on this
TypeScript package.

## Workflow

When the catalog shape changes:

1. Edit `src/index.ts`. Use JSDoc tags for any JSON-Schema-specific
   constraints (see "JSDoc tag reference" below).
2. Run `npm run build:schema` to regenerate
   `apps/skillzkit/schema/catalog.schema.json`.
3. Commit both files together.
4. CI runs `npm run verify:schema` — fails the PR if the checked-in
   schema is out of sync with the TS source.
5. Once merged, agentx-platform's Java codegen picks up the new
   schema (via git submodule, CI fetch, or manual sync).

## JSDoc tag reference

`ts-json-schema-generator` reads these from JSDoc comments:

| JSDoc tag | JSON Schema field | Example |
|---|---|---|
| `@pattern <regex>` | `pattern` | `@pattern ^[a-z]+$` |
| `@format <fmt>` | `format` | `@format date-time` |
| `@minimum <n>` | `minimum` | `@minimum 1` |
| `@maximum <n>` | `maximum` | `@maximum 100` |
| `@minLength <n>` | `minLength` | `@minLength 3` |
| `@maxLength <n>` | `maxLength` | `@maxLength 255` |
| `@additionalProperties <bool>` | `additionalProperties` | `@additionalProperties true` |

The first line of any JSDoc comment becomes the `description` field
in the generated schema.

## Usage (TS consumers)

```ts
import type { Catalog, Command, Skill, Workflow } from "@helmsmith/skillzkit-types";

function renderCommand(cmd: Command) {
  return `${cmd.slug}: ${cmd.outcome ?? cmd.description}`;
}
```

Zero runtime deps, types-only. Consumers import directly from the
`src/` (the package's `main` is `./src/index.ts`).

## Versioning

Semver. `Catalog.version` is independent — that's the *catalog format*
version, separate from this package's API version.
