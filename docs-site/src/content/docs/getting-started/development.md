---
title: Development (host + CDP)
description: Develop on the macOS host and drive a debug-target Chromium container over CDP, watching it render via noVNC or chrome://inspect.
---

Development happens **on the host**: your editor, Node.js, and all other
tooling run on macOS, while Chromium runs in a container built from
the `debug` target of the single multi-stage `docker/Dockerfile` — headful,
with its virtual display served over VNC/noVNC so you can watch pages render.

The runtime is [Apple Container](https://github.com/apple/container)
(macOS 26+, Apple silicon). Each container is a lightweight VM with its own IP:
every worker exposes CDP on `:9222` and noVNC on `:6080` of its **own address**,
so there is no host port mapping and no port offsets for a second worker.

:::note
All commands on this page assume you run them **from the repository root**
(the build context is `.`, and the `bin/` helpers are invoked by relative path).

The previous containerized development environment (Node.js, dotfiles,
Claude Code, VS Code attach) is **mothballed** under `attic/development/`.
See `attic/development/README.md` for why, and for the revival checklist.
:::

## One-time setup

```sh
container system start
```

## Build and run the debug worker

```sh
./bin/dev.sh
```

The script builds the `debug` target, (re)starts a worker named
`chromium-debug`, and prints its URLs:

```text
CDP  : http://192.168.64.x:9222/json/version
noVNC: http://192.168.64.x:6080/vnc.html
```

:::caution
On the first connection macOS may ask for **Local Network** permission.
Allow it for both the connecting app (terminal, browser) and the Container
runtime; a missing grant surfaces as empty replies / hangs.
:::

## Watch it render

Open the noVNC URL printed by `./bin/dev.sh` and press **Connect**:

```text
http://192.168.64.x:6080/vnc.html
```

You will see the headful Chromium window (with a fluxbox frame) executing
whatever your CDP client does.

For a zero-tooling alternative that also works for **headless** workers —
the DevTools screencast via `chrome://inspect` — see
[Verifying workers](/getting-started/verify/).

## Process management

`supervisord` manages the whole process tree inside the container
(`xvfb`, `fluxbox`, `x11vnc`, `novnc`, `chromium`, `socat`):

```sh
container exec -it chromium-debug supervisorctl -c /etc/supervisor/conf.d/app.conf status
container exec -it chromium-debug supervisorctl -c /etc/supervisor/conf.d/app.conf restart chromium
```

## Next

- [Chromium flags](/configuration/chromium-flags/) — what each startup flag
  does and how to override them with a custom `.conf`.
- [Driving model &amp; dbus](/internals/driving-model/) — the one-tab-per-worker
  contract this image is built around.
