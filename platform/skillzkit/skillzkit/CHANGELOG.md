# @helmsmith/skillzkit

## 0.1.1

### Patch Changes

- a1cbe5a: Security: the Bun launcher no longer loads `bunfig.toml` or `.env*` files from the current directory. Previously, running the CLI inside a directory containing a `bunfig.toml` with a `preload` executed that script (and a `.env` there was loaded into the CLI's environment), so invoking the tool inside a cloned repo could run that repo's code. The launcher now starts Bun with `--no-env-file` and `--config=<package>/bunfig.toml`, and the package ships an empty `bunfig.toml`.
  
  timetracker still reads `./.env` itself through its config loader, as documented; `.env.local` and other `.env.*` variants that only Bun's auto-loader picked up are no longer read. Running a CLI directly under Bun (`bun x …`) bypasses the Node launcher and is not covered.
