#!/usr/bin/env sh
set -eu

: "${DOCS_DEPLOY_HOOK_URL:?Set DOCS_DEPLOY_HOOK_URL in the protected webhook environment}"
curl -fsSL -X POST "$DOCS_DEPLOY_HOOK_URL"
