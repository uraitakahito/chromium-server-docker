---
title: Production (headless)
description: Build and run the minimal headless Chromium image on Apple Container, driven over CDP on port 9222.
---

The production image runs **headless** Chromium with a minimal footprint,
built from the `production` target (the default) of the single multi-stage
`docker/Dockerfile`. CDP is exposed on port `9222` via `socat`.

The runtime is [Apple Container](https://github.com/apple/container)
(macOS 26+, Apple silicon). Each worker is a lightweight VM with its own IP,
so **every worker exposes CDP on `:9222` of its own address** — scaling out
needs no port offsets and no user-defined network.

:::note
All commands assume you run them from the repository root.
Start the runtime once with `container system start`.
:::

## Build and run workers

```sh
./bin/prod.sh        # 1 worker  (chromium-1)
./bin/prod.sh 3      # 3 workers (chromium-1 .. chromium-3)
```

The script builds the `production` target and prints one CDP URL per worker:

```text
chromium-1: http://192.168.64.x:9222
chromium-2: http://192.168.64.y:9222
```

Manual equivalent:

```sh
container build --target production -t chromium-server:production -f docker/Dockerfile .
container run -d --rm --cpus 4 --memory 4g --name chromium-1 chromium-server:production
container ls   # IP column
```

:::caution
Size the VM explicitly. Apple Container defaults to 1 GiB per container,
which is tight for Chromium (measured ~520 MiB with a single empty tab);
the helper uses `--cpus 4 --memory 4g`.
:::

Chromium itself listens only on `127.0.0.1:9223`; `socat` bridges `:9222`
to it. External CDP clients connect to port `9222` on the container IP. See
[Chrome DevTools Protocol](/configuration/cdp/) for why, and how to verify.

## Health and lifecycle

The Dockerfile's `HEALTHCHECK` is honored by Docker-compatible runtimes
(the CI smoke job uses it), but **Apple Container does not evaluate
HEALTHCHECK** — probe workers externally:

```sh
curl -sf --max-time 5 http://192.168.64.x:9222/json/version >/dev/null && echo OK
```

`container stop` sends SIGTERM with a **5-second** grace period (Docker
defaults to 10). supervisord forwards the signal to Chromium and socat.

```sh
container stop chromium-1      # --rm containers are deleted on stop
container stop --all
```

## Next

- [Chromium flags](/configuration/chromium-flags/) — what each startup flag
  does and how to override them with a custom `.conf`.
- [Driving model &amp; dbus](/internals/driving-model/) — the one-tab-per-worker
  contract this image is built around.
