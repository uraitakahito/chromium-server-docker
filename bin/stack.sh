#!/bin/bash
#
# stack.sh —— 開発スタック（docker-compose.yml）のただ 1 つの入口。
# Apple Container の上の、chromium の worker と Prometheus・Grafana・blackbox。
#
#   ./bin/stack.sh up       # preflight → container-compose up -d -b → 全部が答えるまで待つ
#   ./bin/stack.sh down     # コンテナを止める（残る。消すのは `container rm`）
#   ./bin/stack.sh check    # 全部が答えているか（--wait を付けると最大 120 秒やり直す）
#   ./bin/stack.sh reload   # Prometheus に prometheus.yml と rules を読み直させる
#
# 生の `container-compose up` でなくスクリプトにする理由:
# docker-compose.yml に healthcheck を書いていないので、up は何も答えないうちに戻る。
# DNS ドメインが無くても、container-compose は教えてくれない（そのとき非 root のコンテナは、
# 黙って互いの名前を引けない）。docs: getting-started/monitoring。
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN=chromium-server   # = docker-compose.yml の `name:`

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
    # 同時に起こすのは 1 つだけ:
    # 利用者のスタックは、自分の chromium を 127.0.0.1:9222 に publish する。
    # このポートが塞がっていて自分の worker でなければ、ほかのスタックがまだ動いている ——
    # 並べて起こさず、先にそれを止める。
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
    # Prometheus は --web.enable-lifecycle で動いていて、ポートは loopback に publish してある。
    curl -sf -X POST http://127.0.0.1:9090/-/reload && echo "prometheus: reloaded"
    ;;
  *)
    echo "usage: bin/stack.sh up | down | check [--wait] | reload" >&2
    exit 2
    ;;
esac
