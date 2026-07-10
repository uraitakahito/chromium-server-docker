---
title: Driving model & dbus
description: The one-tab-per-worker contract the image is built around, and why Chromium is wrapped in dbus-run-session.
---

This image is not a general-purpose browser — it is a thin CDP container shaped
around one specific driving model. Understanding that model explains most of the
flag and dbus choices.

## The one-tab-per-worker contract

An external worker (for example a [BrowserHive](https://github.com/uraitakahito/browserhive)
worker) is expected to:

- Own **one tab** for its entire lifetime.
- Reset state between tasks by navigating to `about:blank` and clearing cookies
  over CDP — **not** by opening new tabs.
- Rely on that `about:blank` navigation to **fully tear down** the previous
  document.

The last point is why bfcache is disabled: with the Back-Forward Cache on,
`about:blank` would suspend the previous document into memory instead of
destroying it, leaking DOM, timers, and fingerprint surfaces across the task
boundary. See [Chromium flags](/configuration/chromium-flags/) for the full
rationale.

## No desktop environment

The container has no desktop environment, so OS-integration probes (keychain,
gnome-keyring, KWallet, …) have nothing to talk to. Left alone they fail and spam
stderr on every launch, so they are suppressed — `--password-store=basic` for the
credential store, and a scoped session bus for D-Bus.

## Why Chromium is wrapped in `dbus-run-session`

`start-chromium.sh` execs Chromium through `dbus-run-session`. That spawns a
fresh **per-process session** D-Bus daemon and exports
`DBUS_SESSION_BUS_ADDRESS` before Chromium starts, which silences the
session-bus probes Chromium emits at startup (Notifications, ScreenSaver,
AT-SPI) — without needing a long-lived dbus daemon under supervisord.

### Why not `dbus-launch --autolaunch`

`autolaunch` (from `dbus-x11`) refuses to spawn a daemon when `$DISPLAY` is
unset — it coordinates through an X11 atom, which makes it unusable in a
fully-headless container. `dbus-run-session` (from the `dbus` package) has no
such X11 dependency, forwards `SIGHUP`/`SIGTERM`/`SIGINT` to its child (so
supervisord's graceful shutdown still reaches Chromium), and tears the daemon
down automatically when Chromium exits.

### Scope: session bus only

Only the **session** bus is provided. **System**-bus probes (UPower,
NetworkManager, BlueZ) are left unsuppressed by design — running
`dbus-daemon --system` would require a long-lived root daemon and contradict
this image's "thin CDP container" stance. The residual stderr noise from those
probes is treated as known noise and filtered at the log-aggregation layer if
needed.
