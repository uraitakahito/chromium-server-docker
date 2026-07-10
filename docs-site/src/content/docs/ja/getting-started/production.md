---
title: 本番（ヘッドレス）
description: CDP で外部駆動する最小ヘッドレス Chromium イメージの build と run。CDP は 9222 に公開する。
---

Production イメージは **ヘッドレス** Chromium を最小構成（Node.js なし・開発ツール
なし、Debian slim ベース）で動かす。CDP は `socat` 経由で `9222` に公開する。

:::note
コマンドはリポジトリのルートで実行する前提。`PROJECT` はディレクトリ名から導出し、
イメージ tag をプロジェクトに合わせる。
:::

## イメージを build する

```sh
PROJECT=$(basename "$PWD" | tr '[:upper:]' '[:lower:]')
docker image build -f docker/production/Dockerfile -t "$PROJECT-image:production" .
```

## network を作成する（初回のみ）

同じ network 上の CDP クライアントがコンテナ名で到達できるよう、user-defined bridge
network に接続する。

```sh
docker network create chromium-network
```

## コンテナを run する

```sh
docker container run -d --rm --init \
  --network chromium-network \
  -p 9222:9222 \
  --name chromium-server-1 \
  $PROJECT-image:production
```

Chromium 自身は `127.0.0.1:9223` でしか listen しない。公開ポート `9222` はそこへ
`socat` が橋渡しする。CDP クライアントは `9222` に接続する。理由と確認方法は
[Chrome DevTools Protocol](/configuration/cdp/) を参照。

## CDP を確認する

```sh
curl http://localhost:9222/json/version
```

Chromium のビルド情報と `webSocketDebuggerUrl` を含む JSON が返れば CDP に到達
できている。

## 次に

- [Chromium フラグ](/configuration/chromium-flags/) — 各起動 flag の意味と、独自の
  `.conf` で上書きする方法。
- [駆動モデルと dbus](/internals/driving-model/) — このイメージが前提とする
  「1 worker = 1 tab」契約。
