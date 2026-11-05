---
title: Driving model & dbus
description: Who decides how tabs are used, and why Chromium is wrapped in dbus-run-session.
---

This image is a thin CDP container: it starts Chromium, exposes CDP, and leaves
the rest to the CDP client. This page covers what is left to the client and what
the image takes care of itself.

## The CDP client decides

How many tabs and browser contexts to use, and how to keep one task's state from
reaching the next, is up to the CDP client. The image neither enforces nor assumes
a particular pattern.

Chromium starts with a tab already open. A client may drive that tab (as
[`bin/cdp.sh`](/getting-started/verify/) does) or ignore it and open its own tabs
in its own browser contexts.

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
