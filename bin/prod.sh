#!/bin/bash
#
# Production helper for Apple Container.
#
# Builds the `production` target (headless) and runs N workers named
# chromium-1 .. chromium-N. Every worker exposes CDP on :9222 of its own
# container IP — no host port offsets needed. Prints one CDP URL per worker.
#
#   ./bin/prod.sh         # build + run 1 worker
#   ./bin/prod.sh 3       # build + run 3 workers
#
# Can be invoked from any directory: the script cd's to the repository
# root itself, so the build context is always correct.
#
set -euo pipefail
cd "$(dirname "$0")/.."

COUNT="${1:-1}"

container build --target production -t chromium-server:production -f docker/Dockerfile .

for i in $(seq 1 "${COUNT}"); do
    name="chromium-${i}"
    container stop "${name}" >/dev/null 2>&1 || true
    container run -d --rm --cpus 4 --memory 4g --name "${name}" chromium-server:production
done

# The VMs need a moment before their network status is populated.
sleep 3
echo
for i in $(seq 1 "${COUNT}"); do
    name="chromium-${i}"
    ip="$(container inspect "${name}" | python3 -c '
import json, sys
d = json.load(sys.stdin)
d = d[0] if isinstance(d, list) else d
print(d["status"]["networks"][0]["ipv4Address"].split("/")[0])')"
    echo "${name}: http://${ip}:9222"
done
echo
echo "Stop with: container stop chromium-1 ... (or: container stop --all)"
