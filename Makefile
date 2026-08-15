# helmsmith — release targets
#
# Why a Makefile and not `pnpm release`: the root `release` script runs
# `changeset publish`, which does NOT publish only what has changesets. It
# publishes every non-private package whose local version is absent from the
# registry — currently ten @helmsmith/* names that have never been released
# (gitradar, gittyup, mech-pencil, pritty, taskmaster, timetracker, toolz,
# cli-kit, workspace, skillzkit). Claiming a name on npm is irreversible, so
# publishing goes through an explicit allowlist instead.
#
#   make status                 what would publish, local vs npm
#   make version                apply changesets + build (pre-publish)
#   make publish-dry            pack and inspect, no upload
#   make publish OTP=123456     publish the allowlist, in order

# Order matters: flow-spec first — flow-designer pins it at an exact version,
# so publishing the dependent first leaves it briefly unresolvable.
PUBLISH_PKGS ?= @helmsmith/flow-spec @helmsmith/flow-designer

.DEFAULT_GOAL := help
.PHONY: help status version build publish publish-dry require-otp

help:
	@echo "helmsmith release targets"
	@echo
	@echo "  make status              show local vs published versions"
	@echo "  make version             apply pending changesets, then build"
	@echo "  make publish-dry         pack each package and list contents"
	@echo "  make publish OTP=123456  publish the allowlist below, in order"
	@echo
	@echo "  allowlist: $(PUBLISH_PKGS)"

status:
	@echo "package                          local      npm"
	@echo "-------------------------------- ---------- ----------"
	@for p in $(PUBLISH_PKGS); do \
		local_v=$$(pnpm --filter $$p exec node -p "require('./package.json').version" 2>/dev/null | tail -1); \
		npm_v=$$(npm view $$p version 2>/dev/null || echo "-"); \
		printf "%-32s %-10s %-10s\n" "$$p" "$$local_v" "$$npm_v"; \
	done
	@echo
	@pnpm changeset status 2>/dev/null | grep -A 4 "bumped at" || echo "no pending changesets"

version:
	pnpm changeset:version
	$(MAKE) build

build:
	@for p in $(PUBLISH_PKGS); do \
		echo "==> build $$p"; \
		pnpm --filter $$p run build || exit 1; \
	done

publish-dry: build
	@for p in $(PUBLISH_PKGS); do \
		echo "==> pack $$p"; \
		pnpm --filter $$p pack --pack-destination /tmp/helmsmith-pack || exit 1; \
	done
	@echo
	@echo "tarballs in /tmp/helmsmith-pack:"
	@ls -la /tmp/helmsmith-pack/*.tgz 2>/dev/null || true

# Guard runs BEFORE build so a missing OTP fails in a second, not after a
# full rebuild. Listed first among the prerequisites, which make runs in order.
require-otp:
	@test -n "$(OTP)" || { \
		echo "OTP is required — 2FA is enabled on this npm account."; \
		echo "Usage: make publish OTP=123456   (codes expire in ~30s)"; \
		exit 1; \
	}

publish: require-otp build
	@for p in $(PUBLISH_PKGS); do \
		echo "==> publish $$p"; \
		pnpm --filter $$p publish --access public --no-git-checks --otp=$(OTP) || exit 1; \
	done
	@echo
	@$(MAKE) --no-print-directory status
