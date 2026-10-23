# helmsmith — release targets
#
# Why a Makefile and not `pnpm release`: the root `release` script runs
# `changeset publish`, which does NOT publish only what has changesets. It
# publishes every non-private package whose local version is absent from the
# registry — including @helmsmith/* names that have never been released and
# would not even install: gitradar, mech-pencil, taskmaster, timetracker,
# toolz, and skillzkit all depend on the private tui-view-components
# (`pnpm release:plan` prints the current BLOCKED list). gittyup bundles its
# workspace libraries into dist, so it ships like the others on the list.
# Claiming a name on npm is irreversible, so publishing goes through an
# explicit allowlist instead. @helmsmith/workspace has no blockers but stays
# off the list until it is meant to ship.
#
#   make status                 what would publish, local vs npm
#   make version                apply changesets + build (pre-publish)
#   make publish-dry            pack and inspect, no upload
#   make publish-web            publish, authorizing via a browser link
#   make publish [OTP=123456]   publish with a one-time password
#
# Both publish targets skip a package whose exact local version is already on
# the registry, so after a partial failure you just run the same command again.

# Order matters: a dependency before its dependents. pnpm rewrites
# `workspace:*` to the exact local version at pack time, so publishing the
# dependent first leaves it briefly unresolvable.
#   flow-spec → flow-designer
#   cli-kit   → storybrokr
PUBLISH_PKGS ?= @helmsmith/flow-spec @helmsmith/flow-designer @helmsmith/cli-kit @helmsmith/storybrokr @helmsmith/workbrokr @helmsmith/pritty @helmsmith/gittyup

PACK_DIR ?= /tmp/helmsmith-pack

.DEFAULT_GOAL := help
.PHONY: help status version build publish publish-web publish-dry

# Shell fragment for the publish loops (which bind $$p): sets local_v, and skips
# the package when that exact version is already on the registry. Asks for the
# exact version rather than comparing against `latest`, and --prefer-online so
# npm's local metadata cache can't report a just-published version as missing.
# A *staged* version (npm 11: published, awaiting 2FA approval) is invisible
# here; npm then fails with E409 and the loop prints how to approve it.
SKIP_IF_PUBLISHED = local_v=$$(pnpm --filter $$p exec node -p "require('./package.json').version" 2>/dev/null | tail -1); \
	if [ -z "$$local_v" ]; then echo "==> cannot read the local version of $$p"; exit 1; fi; \
	if [ -n "$$(npm view "$$p@$$local_v" version --prefer-online 2>/dev/null)" ]; then \
		echo "==> skip $$p ($$local_v is already on npm)"; \
		continue; \
	fi;

PUBLISH_FAILED_HINT = echo "    publish of $$p $$local_v failed. E409 \"previously staged\" means an earlier run"; \
	echo "    uploaded it and it awaits approval: npm stage list $$p, then npm stage approve <id>."; \
	echo "    Otherwise fix the cause and re-run; packages already on npm are skipped."

help:
	@echo "helmsmith release targets"
	@echo
	@echo "  make status              show local vs published versions"
	@echo "  make version             apply pending changesets, then build"
	@echo "  make publish-dry         pack each package and list contents"
	@echo "  make publish-web         publish the allowlist, authorizing via a browser link"
	@echo "  make publish [OTP=…]     same, with a one-time password (prompted after the build if omitted)"
	@echo
	@echo "  Publishing skips versions already on npm; narrow it with PUBLISH_PKGS=\"…\"."
	@echo
	@echo "  allowlist: $(PUBLISH_PKGS)"

status:
	@echo "package                          local      npm"
	@echo "-------------------------------- ---------- ----------"
	@for p in $(PUBLISH_PKGS); do \
		local_v=$$(pnpm --filter $$p exec node -p "require('./package.json').version" 2>/dev/null | tail -1); \
		npm_v=$$(npm view $$p version --prefer-online 2>/dev/null || echo "-"); \
		printf "%-32s %-10s %-10s\n" "$$p" "$$local_v" "$$npm_v"; \
	done
	@echo
	@pnpm changeset status 2>/dev/null | grep -A 4 "bumped at" || echo "no pending changesets"

version:
	pnpm changeset:version
	$(MAKE) build

# `build:lib` too where a package has one: flow-designer's `build` is its demo
# app, while what npm users import (dist-lib) only comes from build:lib — and
# pack does not run prepublishOnly, so nothing else would rebuild it.
build:
	@for p in $(PUBLISH_PKGS); do \
		echo "==> build $$p"; \
		pnpm --filter $$p run build || exit 1; \
		pnpm --filter $$p run --if-present build:lib || exit 1; \
	done

publish-dry: build
	@mkdir -p $(PACK_DIR)
	@rm -f $(PACK_DIR)/*.tgz
	@for p in $(PUBLISH_PKGS); do \
		dir=$$(pnpm --filter $$p exec pwd | grep -v WARN | tail -1); \
		echo "==> pack $$p"; \
		( cd "$$dir" && pnpm pack --pack-destination $(PACK_DIR) >/dev/null ) || exit 1; \
	done
	@echo
	@echo "tarballs in $(PACK_DIR):"
	@ls -la $(PACK_DIR)/*.tgz 2>/dev/null || true

# Browser authorization instead of a typed OTP.
#
# npm prints "Open this URL in your browser to authenticate:" and waits — but
# ONLY with a TTY, so run this yourself in a terminal, not through a wrapper
# that captures output.
#
# Why pack-then-publish rather than `npm publish` in the package directory:
# flow-designer depends on `@helmsmith/flow-spec: workspace:*`. Only pnpm
# rewrites that protocol to a real version, and only when pnpm does the
# packing. npm would upload the literal string and produce a package that
# cannot be installed. So pnpm builds the tarball, npm just uploads it — which
# is also what gives us npm's web auth flow.
# NOTE: `pnpm --filter <pkg> pack` does NOT work — --filter implies recursive
# mode and pack rejects it. pnpm must pack from inside the package directory,
# so resolve the directory by package name first. (`pnpm publish` does accept
# --filter, which is why only the pack targets need this.)
publish-web: build
	@mkdir -p $(PACK_DIR)
	@for p in $(PUBLISH_PKGS); do \
		$(SKIP_IF_PUBLISHED) \
		rm -f $(PACK_DIR)/*.tgz; \
		dir=$$(pnpm --filter $$p exec pwd | grep -v WARN | tail -1); \
		echo "==> pack $$p"; \
		( cd "$$dir" && pnpm pack --pack-destination $(PACK_DIR) >/dev/null ) || exit 1; \
		tgz=$$(ls $(PACK_DIR)/*.tgz | head -1); \
		echo "==> publish $$(basename $$tgz)"; \
		echo "    npm will print a browser link below — open it to authorize"; \
		npm publish "$$tgz" --access public || { $(PUBLISH_FAILED_HINT); exit 1; }; \
	done
	@echo
	@$(MAKE) --no-print-directory status

# One-time password: pass OTP=123456, or leave it out and you're asked once the
# build is done, right before the first upload. Codes live ~30s, so a code
# typed before a multi-package build is often stale by the time npm checks it.
# One code is reused for the remaining packages; if it expires mid-run, run the
# command again — what's already published is skipped.
publish: build
	@otp="$(OTP)"; \
	for p in $(PUBLISH_PKGS); do \
		$(SKIP_IF_PUBLISHED) \
		if [ -z "$$otp" ]; then \
			printf "npm one-time password: "; \
			read -r otp || true; \
			if [ -z "$$otp" ]; then echo; echo "==> no one-time password given — nothing published from here on"; exit 1; fi; \
		fi; \
		echo "==> publish $$p $$local_v"; \
		pnpm --filter $$p publish --access public --no-git-checks --otp="$$otp" || { $(PUBLISH_FAILED_HINT); exit 1; }; \
	done
	@echo
	@$(MAKE) --no-print-directory status
