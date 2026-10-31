---
title: Metrics
description: The two Prometheus exporters bundled in the image, what they expose on :9100 and :9256, and how to scrape and verify them.
---

The production image bundles two upstream Prometheus exporters so the state
*inside* the container can be scraped without installing an agent per
deployment. Both run as `supervisord` programs next to Chromium and `socat`.

| Port | Program | What it exposes |
| --- | --- | --- |
| `9100` | [node_exporter](https://github.com/prometheus/node_exporter) 1.12.1 | VM / OS level metrics: `cpu`, `meminfo`, `loadavg`, `filesystem`, `netdev`, `processes` (collectors are opt-in; everything else is disabled) |
| `9256` | [process-exporter](https://github.com/ncabatoff/process-exporter) 0.8.7 | Per-process-group CPU, RSS, threads and file descriptors, grouped by Chromium's `--type=` (`namedprocess_namegroup_*`) |

Neither port is published to the host by the compose files that consume this
image. They are meant to be scraped **from inside the container network**, by
the container's DNS name (for example `chromium-1.capture-ledger:9256`).
`9222` (CDP via socat) is unchanged.

## Process groups

`process-exporter.yml` in the repository root defines the groups. The first
matching rule wins, so the `--type=` rule comes before the catch for the parent
browser process:

| `groupname` | Matches |
| --- | --- |
| `chromium-renderer`, `chromium-gpu-process`, `chromium-utility`, `chromium-zygote`, … | a `chromium` process carrying `--type=<type>` |
| `chromium-browser` | the parent `chromium` process (no `--type`) |
| `chrome_crashpad` | the crashpad handler |
| `supervisord`, `socat` | the two other long-running programs |

There is deliberately no catch-all rule: with `{{.Comm}}` + `.+` every
transient `sh` or `curl` spawned during a scrape becomes its own group and the
series count balloons. Processes that match no rule (`dbus-run-session`,
`dbus-daemon`, the start script) are not counted at all (`-children=false`).

The parent is matched by `comm`, not by its path: process-exporter assigns a
process to a group the first time it sees it. Chromium starts through Debian's
`/usr/bin/chromium` wrapper, which `exec()`s the real binary under the same pid,
so an exporter that starts together with Chromium sees the wrapper first. A rule
anchored on `/usr/lib/chromium/chromium` misses it for good; `comm` is `chromium`
for both.

Useful series:

```
namedprocess_namegroup_num_procs{groupname="chromium-renderer"}
namedprocess_namegroup_memory_bytes{groupname="chromium-browser",memtype="resident"}
namedprocess_namegroup_cpu_seconds_total{groupname="chromium-utility",mode="user"}
namedprocess_namegroup_open_filedesc{groupname="chromium-browser"}
```

## Scraping

The repository's own development stack already does this —
[Monitoring stack](/getting-started/monitoring/) — with the targets
`chromium.chromium-server:9100` and `:9256`. A Prometheus running inside
another compose project's network lists that project's container names:

```yaml
scrape_configs:
  - job_name: chromium-node
    static_configs: [{ targets: ["chromium-1.capture-ledger:9100", "chromium-2.capture-ledger:9100"] }]
  - job_name: chromium-process
    static_configs: [{ targets: ["chromium-1.capture-ledger:9256", "chromium-2.capture-ledger:9256"] }]
```

## Verifying

From the host, the exporter ports are not reachable (not published), so ask
the container itself:

```sh
container exec chromium-1 sh -c 'curl -sf localhost:9100/metrics | grep -c -v "^#"'
container exec chromium-1 sh -c 'curl -sf localhost:9256/metrics | grep namedprocess_namegroup_num_procs'
container exec chromium-1 supervisorctl -c /etc/supervisor/conf.d/app.conf status
```

Expected: `chromium-browser` is `1`, `chromium-renderer` is present, and all
four programs (`chromium`, `socat`, `node-exporter`, `process-exporter`) report
`RUNNING`. The CI smoke job performs the same three checks against the amd64
image with Docker.

## Reading node_exporter correctly

`node_exporter` reports what the kernel it runs on sees:

- Under **Apple Container** every container is its own lightweight VM, so
  `node_memory_*`, `node_cpu_*` and `node_filesystem_*` describe that VM: the
  4 GiB memory limit, the VM's root disk, its `eth0`.
- Under **Docker** (shared kernel) the same series describe the **host**, not
  the container. Use cAdvisor or the runtime's own stats for container-level
  resources there, and treat `node_exporter` as host context.

`process-exporter` has no such ambiguity: it only reads `/proc` entries that
belong to the container's PID namespace.

## Bumping the exporter versions

Dependabot does not track GitHub release assets, so the bump is manual:

1. Pick the release and download its checksum file (`sha256sums.txt` for
   node_exporter, `checksums.txt` for process-exporter).
2. Replace the four lines in `docker/exporters.sha256` (`linux-amd64` and
   `linux-arm64` for both exporters).
3. Change the `ARG NODE_EXPORTER_VERSION` / `ARG PROCESS_EXPORTER_VERSION`
   defaults in `docker/Dockerfile`.
4. Build. A stale or mistyped checksum fails the `exporters` stage with
   `sha256sum: WARNING: 1 computed checksum did NOT match`.
