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
needs no port offsets and no user-defined network. Consumers that run several
workers (browserhive, capture-ledger) do so in their own compose files.

:::note
All commands assume you run them from the repository root.
Start the runtime once with `container system start`.
:::

## Build and run

The repository's `docker-compose.yml` starts one worker together with
Prometheus, Grafana and blackbox ([Monitoring stack](/getting-started/monitoring/)):

```sh
sudo container system dns create chromium-server   # once per machine
./bin/stack.sh up                                   # build + start + wait until everything answers
```

CDP is published on `127.0.0.1:9222`; `bin/cdp.sh` finds it by itself. Run one stack at a time: stop a consumer's stack (capture-ledger, browserhive) before starting this one, and vice versa.

Manual equivalent, for a worker without the monitoring tools:

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
to it. External CDP clients connect to port `9222` on the container IP (or on
the published loopback port). See [Chrome DevTools Protocol](/configuration/cdp/)
for why, and how to verify.

## Health and lifecycle

The Dockerfile's `HEALTHCHECK` is honored by Docker-compatible runtimes
(the CI smoke job uses it), but **Apple Container does not evaluate
HEALTHCHECK** — probe workers externally. The compose stack does this
continuously (blackbox → Prometheus, alert `ChromiumCdpDown`); by hand:

```sh
curl -sf --max-time 5 http://127.0.0.1:9222/json/version >/dev/null && echo OK
```

`container stop` sends SIGTERM with a **5-second** grace period (Docker
defaults to 10). supervisord forwards the signal to Chromium and socat.

```sh
./bin/stack.sh down            # stops the compose stack (containers stay until `container rm`)
container stop chromium-1      # a manually started --rm container is deleted on stop
```

## Next

- [Monitoring stack](/getting-started/monitoring/) — what Prometheus and
  Grafana show about the worker, and the alert rules.
- [Chromium flags](/configuration/chromium-flags/) — what each startup flag
  does and how to override them with a custom `.conf`.
- [Driving model &amp; dbus](/internals/driving-model/) — the one-tab-per-worker
  contract this image is built around.
