# skillzkit-api Docker image. Designed to be hosted alongside the
# agentx-platform controlplane in docker-compose, with controlplane
# reverse-proxying /api/skillz/* to this container on port 3000.
#
# Storage backend chosen via SKILLZKIT_STORAGE env var at runtime — the
# image itself is storage-agnostic. Recommended deploys:
#
#   - controlplane Docker compose (this image's primary use case):
#       SKILLZKIT_STORAGE=fs-persistent:/data + a docker volume on /data
#   - serverless (build separately for Lambda — see server/lambda.ts):
#       SKILLZKIT_STORAGE=s3:my-bucket-name
#
# Bun runs the TypeScript directly — no compile step, smaller image.

FROM oven/bun:1.3-alpine

WORKDIR /app

# Catalog data + source. The image bundles the read-only catalog so a
# fresh deploy works out of the box; persistent backends override this
# at runtime via the storage env var.
COPY package.json ./
COPY catalog.json ./
COPY TAGS.md ./
COPY .claude/ ./.claude/
COPY lib/ ./lib/
COPY server/ ./server/
COPY node_modules/hono ./node_modules/hono
COPY node_modules/gray-matter ./node_modules/gray-matter
COPY node_modules/cac ./node_modules/cac

# Install deps. In a clean build environment without the workspace
# resolution issue, this is `bun install --production` instead.
# (Adjust once the repo's npm workspace deps are sorted.)

ENV PORT=3000
ENV SKILLZKIT_STORAGE=fs:auto

EXPOSE 3000

CMD ["bun", "server/bun.ts"]
