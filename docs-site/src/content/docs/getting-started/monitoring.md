---
title: Monitoring stack
description: docker-compose.yml brings up the worker with Prometheus, Grafana and blackbox on Apple Container; bin/stack.sh is the only entry point.
---

The repository ships a development stack that runs the worker **together with
the tools that read its metrics**: Prometheus scrapes the exporters bundled in
the image ([Metrics](/configuration/metrics/)), blackbox probes CDP, and Grafana
shows a provisioned dashboard. Everything lives in `docker-compose.yml` and
`monitoring/`, and is started by one script.

| Service | Image | Reached at |
| --- | --- | --- |
| `chromium` | built from `docker/Dockerfile` | `127.0.0.1:29222` (CDP, for `bin/cdp.sh`; 9222 on the host belongs to the consumers' stacks) |
| `prometheus` | `prom/prometheus:v3.15.1` | `127.0.0.1:9090` |
| `grafana` | `grafana/grafana:13.2.5` | `127.0.0.1:3000` (anonymous Viewer) |
| `blackbox` | `prom/blackbox-exporter:v0.29.1` | inside the stack only |

The exporter ports `9100` / `9256` are **not** published; Prometheus reads them
as `chromium.chromium-server:9100` and `:9256` inside the container network.

## Once per machine

The compose project name `chromium-server` doubles as the DNS domain. Register
it once (needs sudo):

```sh
sudo container system dns create chromium-server
```

Without it, container-compose silently falls back to editing `/etc/hosts`
inside each container, which fails for the non-root images, and Prometheus
cannot resolve the worker. `bin/stack.sh up` refuses to start until the domain
exists.

## Start, check, stop

```sh
./bin/stack.sh up       # preflight → container-compose up -d -b → waits until everything answers
./bin/stack.sh check    # the same checks again (add --wait to retry for up to 60 s)
./bin/stack.sh reload   # Prometheus re-reads prometheus.yml and the rules
./bin/stack.sh down     # stops the containers; they stay until `container rm`
```

`check` verifies three layers: the three published ports (3000, 9090, 29222) answer, every
Prometheus scrape target is `up`, and process-exporter inside the worker counts
exactly one parent `chromium`. A failing line is named, and the script exits
non-zero.

Then open Grafana at <http://127.0.0.1:3000/d/chromium> — the dashboard
`chromium-server` needs no login — and Prometheus at
<http://127.0.0.1:9090/targets>.

## What is on the dashboard

| Panel | Query | Reads |
| --- | --- | --- |
| liveness | `up{job=~"chromium-.*"}`, `probe_success` | the exporters answer; CDP answers |
| RSS per process group | `namedprocess_namegroup_memory_bytes{memtype="resident"}` | which group (renderer, browser, utility, …) holds the memory |
| CPU per process group | `rate(namedprocess_namegroup_cpu_seconds_total[1m])` | how heavy a capture is |
| process count | `namedprocess_namegroup_num_procs` | `chromium-browser` is always 1; renderers that never go away |
| VM memory | `node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes` | distance to the 4 GiB limit |
| open fds, disk, load, network | `namedprocess_namegroup_open_filedesc`, `node_filesystem_avail_bytes`, `node_load1`, `node_network_*` | the rest of the VM |

The dashboard is provisioned from `monitoring/grafana/dashboards/chromium.json`
and is read-only in the UI (`allowUiUpdates: false`). To change it, edit in the
UI, export the JSON, commit it; Grafana picks up the file within 30 seconds.

## Alerts

`monitoring/prometheus/rules/chromium.yml` defines five rules, evaluated by
Prometheus and visible at <http://127.0.0.1:9090/alerts> and in Grafana's
Alerting view. There is no Alertmanager in this stack; where alerts should be
delivered is a separate decision.

| Alert | Fires when |
| --- | --- |
| `ChromiumCdpDown` | blackbox gets no 2xx from `/json/version` for 1 min |
| `ChromiumBrowserMissing` | `chromium-browser` is not exactly 1 for 1 min |
| `ChromiumExporterDown` | a `chromium-*` scrape job is down for 2 min |
| `ChromiumRendererMemoryHigh` | renderer RSS above 1.5 GB for 5 min |
| `ChromiumVmMemoryLow` | less than 512 MB available in the VM for 5 min |

## Why the stack looks the way it does

- **`user: "0"` on Prometheus and Grafana.** Named volumes are root-owned on
  Apple Container (measured): Grafana (uid 472) dies with
  `mkdir /var/lib/grafana/plugins: Permission denied`, Prometheus (nobody)
  never starts. Running as root inside a VM that only listens on the host's
  loopback is the pragmatic fix for a development tool.
- **The Prometheus URL is in a provisioning file, not in `environment:`.**
  container-compose may rewrite an environment value that equals a service
  name into that service's IP, silently.
- **`build.target` is ignored** by container-compose; the Dockerfile's last
  stage is `production`, so the same image is built.
- **No `container_name:`** — it would suppress the `<service>.chromium-server`
  DNS naming.
- **The blackbox probe sends `Host: localhost`.** Chromium's DevTools HTTP
  endpoint answers `500 Host header is specified and is not an IP address or
  localhost` to any other Host (DNS-rebinding protection), so a probe that
  simply used the DNS name reported CDP as down while it was fine.

## Reusing the scrape config elsewhere

A stack that runs several workers (browserhive, capture-ledger) can copy the
two `chromium-*` jobs from `monitoring/prometheus/prometheus.yml` and list its
own container names, for example `chromium-1.browserhive:9100`. Where that
Prometheus lives is that project's decision.
