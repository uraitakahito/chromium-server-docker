#!/bin/bash
#
# Development helper for Apple Container.
#
# Builds the `debug` target (headful Chromium + VNC/noVNC) and runs one
# worker, then prints the CDP and noVNC URLs. Development happens on the
# host: edit and run your CDP client (e.g. puppeteer-core) here, and watch
# the browser render at the noVNC URL.
#
#   ./bin/dev.sh          # build + (re)start the debug worker
#
# Can be invoked from any directory: the script cd's to the repository
# root itself, so the build context is always correct.
#
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="chromium-debug"

container build --target debug -t chromium-server:debug -f docker/Dockerfile .

# A previous worker may still be running; `--rm` makes stop also delete it.
container stop "${NAME}" >/dev/null 2>&1 || true

# Apple Container VMs default to 1 GiB; Chromium wants more (measured
# ~520 MiB with a single tab, before real page weight).
container run -d --rm --cpus 4 --memory 4g --name "${NAME}" chromium-server:debug

# The VM needs a moment before the network status is populated.
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
