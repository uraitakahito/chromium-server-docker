---
title: Chromium flags
description: Every Chromium startup flag this image sets, why it is set, and how to override them with a custom .conf file.
---

Chromium's startup flags live in a plain config file — `chromium-headless.conf`
for the production (headless) image and `chromium-headful.conf` for the
development (headful) image. Each line is one option; blank lines and lines
starting with `#` are ignored. `start-chromium.sh` reads the file, strips
comments, and execs Chromium with the remaining flags.

## Override the flags

Copy a `.conf`, edit it, and bind-mount it over the one in the image:

```sh
docker container run \
  --mount type=bind,src=/path/to/custom.conf,dst=/app/chromium-headless.conf,readonly \
  ...
```

## Flag reference

| Flag | Why |
| ---- | --- |
| `--headless` | Headless image only. The headful image omits it so Chromium renders to the VNC display. |
| `--remote-debugging-port=9223` | CDP endpoint port **inside** the container. Chromium binds it to localhost only; `socat` bridges the published `9222` to it (see [CDP](/configuration/cdp/)). |
| `--remote-debugging-address=127.0.0.1` | Bind CDP to localhost. Chromium removed support for binding `0.0.0.0` for security, so external access goes through `socat`. |
| `--no-first-run`, `--no-default-browser-check` | Skip first-run UI and default-browser prompts. |
| `--disable-background-networking` | Stop background fetches (variations, update pings) that add noise to a capture. |
| `--disable-dev-shm-usage` | Use `/tmp` instead of `/dev/shm`; the default `/dev/shm` is tiny in containers and crashes Chromium. |
| `--disable-gpu` | No GPU in the container. |
| `--no-sandbox`, `--disable-setuid-sandbox` | The container is the isolation boundary; the setuid sandbox needs privileges this image does not grant. |
| `--password-store=basic` | Pin the credential store to `basic` to suppress keychain auto-detection — see below. |
| `--disable-blink-features=AutomationControlled` | Drop the `AutomationControlled` Blink feature so the automation fingerprint is less obvious. |
| `--disable-back-forward-cache` | Disable bfcache so `about:blank` truly tears down the previous document — see below. |
| `--disk-cache-size=1073741824` | 1 GiB disk cache. Must stay under the int32 max (`2147483647`); Chromium silently rejects larger values. |
| `--user-data-dir=/tmp/chrome-profile` | Profile directory under `/tmp`. |
| `--start-maximized` | Headful image only — maximise the window on the VNC display. |

## Why `--password-store=basic`

On Linux, Chromium probes credential backends at startup in the order:

1. GNOME Keyring (libsecret)
2. KWallet (over D-Bus)
3. `basic` (an encrypted file under the user data dir)

This image (Debian slim, no desktop environment) has neither (1) nor (2), so the
probes always fail and emit noise to stderr on every launch. Forcing `basic`
skips the probe path entirely.

It is safe here because the image is driven over CDP for automated capture and
never asks a user to save passwords, so the weaker on-disk encryption `basic`
uses is moot. Both the headless and headful variants carry the flag for the same
reason.

## Why `--disable-back-forward-cache`

The Back-Forward Cache (bfcache) keeps the previous document's DOM, JS execution
context, timers, and event listeners alive in memory so a user pressing
back/forward sees an instant restore. It is on by default in Chromium 86+.

This image is driven over CDP by an external worker that owns **one persistent
tab** for its whole lifetime and resets state between tasks by navigating to
`about:blank` and clearing cookies over CDP. With bfcache on, that `about:blank`
navigation does **not** destroy the previous document — the tab is suspended into
the cache instead, leaving DOM, timers, and listeners alive across the task
boundary. That defeats the inter-task isolation the driver is trying to achieve
and lets state, fingerprint surfaces, and resource usage bleed between captures.

bfcache's upside (instant back/forward) does not apply to a CDP-driven pipeline
with no human interaction. Playwright, Puppeteer, and browsertrix-crawler all
disable bfcache by default for the same reason.
