#!/bin/bash
#
# stack.sh — the one entry point for the development stack (docker-compose.yml):
# the chromium worker plus Prometheus, Grafana and blackbox on Apple Container.
#
#   ./bin/stack.sh up       # preflight → container-compose up -d -b → wait until everything answers
#   ./bin/stack.sh down     # stop the containers (they stay; `container rm` deletes them)
#   ./bin/stack.sh check    # is everything answering? (add --wait to retry for up to 120 s)
#   ./bin/stack.sh reload   # tell Prometheus to re-read prometheus.yml and the rules
#
# Why a script and not a raw `container-compose up`: container-compose has no
# healthcheck (up returns before anything answers) and does not tell you when
# the DNS domain is missing (non-root containers then silently cannot resolve
# each other). Docs: getting-started/monitoring.
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN=chromium-server   # = `name:` in docker-compose.yml

case "${1:-}" in
  up)
    for cmd in container container-compose curl node; do
      command -v "$cmd" >/dev/null || { echo "error: $cmd is not installed" >&2; exit 1; }
    done
    if ! container system dns list 2>/dev/null | awk 'NR > 1 { print $1 }' | grep -qx "$DOMAIN"; then
      echo "error: DNS domain \"$DOMAIN\" is not registered. Once per machine:" >&2
      echo "  sudo container system dns create $DOMAIN" >&2
      exit 1
    fi
    # One stack at a time: the consumers' stacks publish their own chromium on
    # 127.0.0.1:9222. If that port is taken and it is not our own worker, the
    # other stack is still running — stop it first instead of starting next to it.
    if ! container ls 2>/dev/null | awk 'NR > 1 { print $1 }' | grep -qx "chromium.$DOMAIN" \
       && nc -z -G 2 127.0.0.1 9222 2>/dev/null; then
      echo "error: 127.0.0.1:9222 is already in use by another stack (capture-ledger? browserhive?)." >&2
      echo "  Stop it first (pnpm run dev:down / pnpm run stack:down), then retry. One stack at a time." >&2
      exit 1
    fi
    container-compose up -d -b
    exec node bin/check-stack.mjs --wait
    ;;
  down)
    container-compose down
    ;;
  check)
    shift
    exec node bin/check-stack.mjs "$@"
    ;;
  reload)
    # Prometheus runs with --web.enable-lifecycle; the port is published on loopback.
    curl -sf -X POST http://127.0.0.1:9090/-/reload && echo "prometheus: reloaded"
    ;;
  *)
    echo "usage: bin/stack.sh up | down | check [--wait] | reload" >&2
    exit 2
    ;;
esac
