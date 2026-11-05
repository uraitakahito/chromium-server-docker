#!/bin/bash
#
# ❄ 凍結（2026-07-11） —— 動く形で残すが、メンテナンスはしない。README.md を参照。
#
# 凍結した debug target（headful の Chromium と VNC/noVNC）のための、開発用の helper。
# attic/debug/Dockerfile を build して worker を 1 つ動かし、CDP と noVNC の URL を出す。
#
#   ./attic/debug/dev.sh
#
# どのディレクトリからでも呼べる: スクリプト自身がリポジトリの root へ cd するので、
# build context はいつも正しい。
#
set -euo pipefail
cd "$(dirname "$0")/../.."

NAME="chromium-debug"

container build -f attic/debug/Dockerfile --target debug -t chromium-server:debug .

# 前の worker がまだ動いているかもしれない。`--rm` を付けてあるので、止めると消える。
container stop "${NAME}" >/dev/null 2>&1 || true

# Apple Container の VM の既定は 1 GiB で、Chromium にはもっと要る
# （実測で tab 1 つで約 520 MiB。実際のページの重さを除いて）。
container run -d --rm --cpus 4 --memory 4g --name "${NAME}" chromium-server:debug

# VM のネットワークの状態が埋まるまで、少し掛かる。
sleep 3
ip="$(container inspect "${NAME}" | python3 -c '
import json, sys
d = json.load(sys.stdin)
d = d[0] if isinstance(d, list) else d
print(d["status"]["networks"][0]["ipv4Address"].split("/")[0])')"

echo
echo "CDP  : http://${ip}:9222/json/version"
echo "noVNC: http://${ip}:6080/vnc.html"
echo
echo "Stop with: container stop ${NAME}"
