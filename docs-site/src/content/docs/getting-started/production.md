---
title: Production (headless)
description: Build and run the minimal headless Chromium image, driven over CDP on port 9222.
---

The production image runs **headless** Chromium with a minimal footprint (no
Node.js, no development tools), based on a Debian slim variant. CDP is exposed on
port `9222` via `socat`.

:::note
All commands assume you run them from the repository root. `PROJECT` is derived
from the directory name so the image tag matches the project.
:::

## Build the image

```sh
PROJECT=$(basename `pwd`)
docker image build -f docker/production/Dockerfile -t $PROJECT-image:production .
```

## Create the network (first time only)

The container attaches to a user-defined bridge network so a CDP client on the
same network can reach it by container name.

```sh
docker network create chromium-network
```

## Run the container

```sh
docker container run -d --rm --init \
  --network chromium-network \
  -p 9222:9222 \
  --name chromium-server-1 \
  $PROJECT-image:production
```

Chromium itself listens only on `127.0.0.1:9223`; `socat` bridges the published
port `9222` to it. External CDP clients connect to port `9222`. See
[Chrome DevTools Protocol](/configuration/cdp/) for why, and how to verify.

## Verify CDP

```sh
curl http://localhost:9222/json/version
```

A JSON payload with the Chromium build and the `webSocketDebuggerUrl` means CDP
is reachable.

## Next

- [Chromium flags](/configuration/chromium-flags/) — what each startup flag does
  and how to override them with a custom `.conf`.
- [Driving model &amp; dbus](/internals/driving-model/) — the one-tab-per-worker
  contract this image is built around.
