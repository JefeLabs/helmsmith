# @helmsmith/workspace

## 0.1.0

### Minor Changes

- df686c3: **Breaking:** the `agentx-workspace` bin is now `helmsmith-workspace` (`workspace` is unchanged). `AGENTX_PLATFORM_ROOT` and `AGENTX_TMUX_SESSION` are now `HELMSMITH_PLATFORM_ROOT` and `HELMSMITH_TMUX_SESSION`. The default tmux session is `helmsmith`. Newly procured workspaces reference `helmsmith/*` images (`helmsmith/worker`, `helmsmith/harness-server`, …) and name job containers `helmsmith-job-<id>`. Rebuild local images under the new names before using a new workspace.
