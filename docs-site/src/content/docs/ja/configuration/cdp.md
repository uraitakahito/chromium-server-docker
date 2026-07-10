---
title: Chrome DevTools Protocol
description: CDP を socat 経由でどう公開しているか、到達確認の方法。
---

このイメージは **Chrome DevTools Protocol (CDP)** で駆動するために存在する。
エンドポイントはポート `9222` に公開する。

## なぜ socat が Chromium の前段にいるのか

かつては `--remote-debugging-address=0.0.0.0` でコンテナ外からの CDP 接続を許可
できた。この flag は近年の Chromium で security 上の理由から無効化/削除され、
Chromium は **`127.0.0.1` のみで listen** するようになった。

それでも外部の CDP クライアントを受けられるよう、Chromium はコンテナ内で CDP を
`127.0.0.1:9223` に bind し、`socat` が公開ポートをそこへ転送する:

```
CDP クライアント ──▶ :9222（公開）
                      │  socat
                      ▼
                   127.0.0.1:9223（chromium）
```

参考:

- <https://issues.chromium.org/issues/40261787>
- <https://issues.chromium.org/issues/40279369>

## CDP の到達確認

```sh
curl http://localhost:9222/json/version
```

主なエンドポイント:

| エンドポイント | 返すもの |
| ------------- | -------- |
| `/json/version` | ブラウザのビルド情報とトップレベルの `webSocketDebuggerUrl`。 |
| `/json/list` | inspect 可能な target（tab）一覧と、その WebSocket URL。 |

CDP クライアント（Puppeteer・Playwright、または BrowserHive のような独自 worker）は
`webSocketDebuggerUrl` に接続して tab を駆動する。
