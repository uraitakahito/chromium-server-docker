---
title: Chromium flags
description: Every Chromium startup flag this image sets, why it is set, and how to override them with a custom .conf file.
---

Chromium's startup flags live in a plain config file — `chromium-headless.conf`
for the production (headless) image. Each line is one option; blank lines and
lines starting with `#` are ignored. `start-chromium.sh` reads the file, strips
comments, and execs Chromium with the remaining flags.

(The headful counterpart, `chromium-headful.conf`, now lives with the
mothballed units under `attic/` — its flags are still documented below.)

## Override the flags

`container run` refuses to bind-mount a single file (`path '…' is not a directory`),
so bind-mount a directory over `/app` instead. From a checkout of this repository,
copy the files the image keeps in `/app`, then edit the `.conf`:

```sh
mkdir custom-app
cp chromium-headless.conf start-chromium.sh process-exporter.yml custom-app/
# edit custom-app/chromium-headless.conf, then:
container run \
  --mount type=bind,source="$PWD/custom-app",target=/app,readonly \
  ...
```

## Flag reference

| Flag | Why |
| ---- | --- |
| `--headless` | Headless (production) image. The mothballed headful units (`attic/`) omit it so Chromium renders to the VNC display. |
| `--remote-debugging-port=9223` | CDP endpoint port **inside** the container. Chromium binds it to localhost only; `socat` bridges the published `9222` to it (see [CDP](/configuration/cdp/)). |
| `--remote-debugging-address=127.0.0.1` | Bind CDP to localhost. Chromium removed support for binding `0.0.0.0` for security, so external access goes through `socat`. |
| `--no-first-run`, `--no-default-browser-check` | Skip first-run UI and default-browser prompts. |
| `--disable-background-networking` | Stop background fetches (variations, update pings) that add noise to a capture. |
| `--disable-dev-shm-usage` | Use `/tmp` instead of `/dev/shm`; the default `/dev/shm` is tiny in containers and crashes Chromium. |
| `--disable-gpu` | No GPU in the container. |
| `--no-sandbox`, `--disable-setuid-sandbox` | The container is the isolation boundary; the setuid sandbox needs privileges this image does not grant. |
| `--password-store=basic` | Pin the credential store to `basic` to suppress keychain auto-detection — see below. |
| `--disable-blink-features=AutomationControlled` | Drop the `AutomationControlled` Blink feature so the automation fingerprint is less obvious. |
| `--disable-back-forward-cache` | Disable bfcache so going back through history issues requests that CDP can see — see below. |
| `--disk-cache-size=1073741824` | 1 GiB disk cache. Must stay under the int32 max (`2147483647`); Chromium silently rejects larger values. |
| `--user-data-dir=/tmp/chrome-profile` | Profile directory under `/tmp`. |
| `--start-maximized` | Mothballed headful conf only — maximise the window on the VNC display. |

## Why `--password-store=basic`

On Linux, Chromium picks one credential store from the desktop environment:
KWallet under KDE, the Secret Service (`org.freedesktop.secrets`, which GNOME
Keyring provides) otherwise. If the store it picked is not there, it falls back
to `basic` (an encrypted file under the user data dir).

This image (Debian slim, no desktop environment) has neither, so without the flag
Chromium looks for the Secret Service on the session bus at startup and falls back
to `basic`. Forcing `basic` skips that lookup, and keeps the store from changing
with the environment the container runs in. With the session bus in place, stderr
is the same with or without the flag.

It is safe here because the image is driven over CDP for automated capture and
never asks a user to save passwords, so the weaker on-disk encryption `basic`
uses is moot. The headless conf and the mothballed headful conf both carry the
flag for the same reason.

## Why `--disable-back-forward-cache`

The Back-Forward Cache (bfcache) freezes the previous document in memory and, when
a user goes back or forward, restores it without touching the network. It is on by
default.

For a CDP-driven pipeline that hides requests. With bfcache on, going back through
history restores the document with no request at all, so neither CDP's `Fetch`
domain nor its `Network` domain sees anything. With the flag, the document is
rebuilt and its request goes through both.

bfcache's upside (instant back/forward) does not apply to a CDP-driven pipeline
with no human interaction. Playwright and browsertrix-crawler set the same flag,
because a main request cannot be intercepted during `page.goBack()` otherwise.
