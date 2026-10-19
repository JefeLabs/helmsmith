---
"@helmsmith/gittyup": minor
---

Test harness: declarative temp-git-repo fixture (`src/test/git-fixture.ts`), e2e harness that spawns the built CLI against isolated temp workspaces, unit/e2e vitest configs split. `test:unit` and `test:integration` scripts removed; `pnpm test` runs co-located unit tests only. First slice of the 2026-10-19 hardening spec; version moves to 0.2.0.
