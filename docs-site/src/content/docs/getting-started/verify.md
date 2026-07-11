---
title: Verifying workers
description: One-shot CDP checks with bin/cdp.sh and live viewing via chrome://inspect — works identically for headless production and debug workers.
---

Every worker — the **headless `production` target and the headful `debug`
target alike** — exposes the same CDP endpoint on `:9222` of its own IP, so
the checks on this page work identically against both. Get the IP from the
`./bin/prod.sh` / `./bin/dev.sh` output, or from `container ls`.

:::note
Commands assume the repository root. On the first connection macOS may ask
for **Local Network** permission — allow it for both the connecting app
(terminal, Chrome) and the Container runtime.
:::

## Quick checks — `bin/cdp.sh` (no scripts needed)

```sh
./bin/cdp.sh smoke                   # version + open a page + print its title
```

```text
chromium-1 (192.168.64.x): Chrome/150.0.7871.100
title: "Yahoo! JAPAN"
```

If that prints a title, the whole path — worker VM, socat, Chromium, CDP —
is working. More one-shot commands:

```sh
./bin/cdp.sh goto https://www.wikipedia.org   # navigate (waits for load)
./bin/cdp.sh title                            # print document.title
./bin/cdp.sh eval 'location.href'             # evaluate any JS expression
./bin/cdp.sh shot /tmp/page.png               # save a page screenshot (headless too)
./bin/cdp.sh targets                          # list open tabs
```

The worker defaults to `chromium-debug`, then `chromium-1`; pick one
explicitly with `CDP_TARGET=chromium-2 ./bin/cdp.sh ...`. Every failure
exits non-zero, so the commands can back automated checks as-is.

For an HTTP-only liveness probe (no WebSocket involved):

```sh
curl http://192.168.64.x:9222/json/version
```

## Watching rendering — chrome://inspect (zero tooling, headless too)

Open `chrome://inspect/#devices` in the host Chrome, press **Configure…**
and add the worker endpoint `192.168.64.x:9222`.

The worker's tabs appear under **Remote Target**; click **inspect** to open
DevTools with a **live screencast** of the page. This works for the
**headless `production` target as well** — the new headless mode has a real
renderer and compositor, so DevTools receives frames even though no display
exists (measured: `Page.startScreencast` delivers frames from a headless
worker). Navigate using the URL bar at the top of the screencast (or the
Console), and use the full DevTools (Network, Elements, Console) as usual.

:::caution
If the endpoint is registered incorrectly (e.g. a **wrong port number**),
there is no error — **nothing appears under Remote Target and no inspect
link shows up**. The port is `9222`; check reachability with
`curl http://<IP>:9222/json/version`. Worker IPs also change across
restarts, so re-add the endpoint in **Configure…** after restarting a worker.

Do not use the "Open tab with url" field on the inspect page: it relies on
`/json/new?url=`, which on current Chromium creates an **empty tab without
navigating** (measured). Navigate from the screencast URL bar instead.
:::

## Next

- [Production (headless)](/getting-started/production/) — build and run
  headless workers.
- [Development (host + CDP)](/getting-started/development/) — the debug
  target and watching it render via noVNC.
