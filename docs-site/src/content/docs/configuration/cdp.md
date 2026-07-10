---
title: Chrome DevTools Protocol
description: How CDP is exposed through socat, and how to check it is reachable.
---

The image exists to be driven over the **Chrome DevTools Protocol (CDP)**. The
endpoint is published on port `9222`.

## Why socat sits in front of Chromium

Historically `--remote-debugging-address=0.0.0.0` let Chromium accept CDP
connections from outside the container. That flag has been disabled/removed in
recent Chromium versions for security reasons, so Chromium now listens **only on
`127.0.0.1`**.

To still allow external CDP clients, Chromium binds CDP to `127.0.0.1:9223`
inside the container, and `socat` forwards the published port to it:

```
CDP client ──▶ :9222 (published)
                 │  socat
                 ▼
              127.0.0.1:9223 (chromium)
```

References:

- <https://issues.chromium.org/issues/40261787>
- <https://issues.chromium.org/issues/40279369>

## Check CDP availability

```sh
curl http://localhost:9222/json/version
```

Useful endpoints:

| Endpoint | Returns |
| -------- | ------- |
| `/json/version` | Browser build and the top-level `webSocketDebuggerUrl`. |
| `/json/list` | The list of inspectable targets (tabs) and their WebSocket URLs. |

A CDP client (Puppeteer, Playwright, or a custom worker such as BrowserHive)
connects to the `webSocketDebuggerUrl` to drive the tab.
