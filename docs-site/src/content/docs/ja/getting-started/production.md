---
title: 本番（headless）
description: 単一 multi-stage Dockerfile の production ターゲットを Apple Container で build/run し、ポート 9222 の CDP で駆動する。
---

Production イメージは、単一 multi-stage `docker/Dockerfile` の `production`
ターゲット（既定）から作る、最小構成の **headless** Chromium です。
CDP は `socat` 経由でポート `9222` に公開されます。

ランタイムは [Apple Container](https://github.com/apple/container)
（macOS 26 以降・Apple Silicon）。worker ＝軽量 VM がそれぞれ固有の IP を持つため、
**どの worker も自分のアドレスの `:9222` で CDP を公開**します —
スケールアウトにポートずらしもユーザー定義ネットワークも不要です。

:::note
コマンドはすべてリポジトリルートで実行する前提です。
ランタイムは `container system start` で一度だけ起動しておきます。
:::

## worker を build して起動する

```sh
./bin/prod.sh        # 1 台  (chromium-1)
./bin/prod.sh 3      # 3 台  (chromium-1 .. chromium-3)
```

スクリプトが `production` ターゲットをビルドし、worker ごとの CDP URL を表示します:

```text
chromium-1: http://192.168.64.x:9222
chromium-2: http://192.168.64.y:9222
```

手動でやる場合:

```sh
container build --target production -t chromium-server:production -f docker/Dockerfile .
container run -d --rm --cpus 4 --memory 4g --name chromium-1 chromium-server:production
container ls   # IP 列を参照
```

:::caution
VM のリソースは明示的に指定してください。Apple Container の既定は 1 コンテナ
1 GiB で、Chromium には窮屈です（空タブ 1 枚で実測 約 520 MiB）。
ヘルパは `--cpus 4 --memory 4g` を指定しています。
:::

Chromium 自体は `127.0.0.1:9223` だけを listen し、`socat` が `:9222` へ
橋渡しします。外部の CDP クライアントはコンテナ IP のポート `9222` に接続します。
理由と確認方法は [Chrome DevTools Protocol](/ja/configuration/cdp/) を参照してください。

## CDP を確認する

```sh
curl http://192.168.64.x:9222/json/version
```

Chromium のビルド情報と `webSocketDebuggerUrl` を含む JSON が返れば、
CDP に到達できています。

## ヘルスとライフサイクル

Dockerfile の `HEALTHCHECK` は Docker 互換ランタイム（CI の smoke ジョブ）では
機能しますが、**Apple Container は HEALTHCHECK を評価しません** —
worker のヘルスは外部からプローブします:

```sh
curl -sf --max-time 5 http://192.168.64.x:9222/json/version >/dev/null && echo OK
```

`container stop` は SIGTERM を送り、猶予は **5 秒**です（Docker の既定は 10 秒）。
supervisord がシグナルを Chromium と socat へ転送します。

```sh
container stop chromium-1      # --rm 付きなので停止と同時に削除される
container stop --all
```

## 次のステップ

- [Chromium フラグ](/ja/configuration/chromium-flags/) — 各起動フラグの意味と、
  カスタム `.conf` での上書き方法。
- [駆動モデルと dbus](/ja/internals/driving-model/) — このイメージが前提とする
  one-tab-per-worker の契約。
