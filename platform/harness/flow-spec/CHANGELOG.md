# @helmsmith/flow-spec

## 0.1.1

### Patch Changes

- Ship the regenerated JSON Schema artifact.

  `schema/flow-spec.schema.json` is exported as the `./schema` subpath, so it is
  part of the published surface. The copy in 0.1.0 predates the regeneration that
  landed with the control-plane `/v1/catalog` wire contract: 1921 lines then, 1653
  now. The definition set is byte-for-byte equivalent in scope — all 48 `$defs`
  present in both, none added, none removed — so this is a compaction of the
  emitted artifact rather than a change in what the schema accepts.

  No change to `src/`, so the emitted `dist/` is identical to 0.1.0.
