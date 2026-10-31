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
スケールアウトにポートずらしもユーザー定義ネットワークも不要です。worker を複数台
動かす利用者（browserhive・capture-ledger）は、それぞれ自分の compose で並べます。

:::note
コマンドはすべてリポジトリルートで実行する前提です。
ランタイムは `container system start` で一度だけ起動しておきます。
:::

## build して起動する

リポジトリの `docker-compose.yml` が、worker 1 台を Prometheus・Grafana・blackbox と一緒に
起こします（[監視スタック](/ja/getting-started/monitoring/)）:

```sh
sudo container system dns create chromium-server   # マシンごとに 1 回
./bin/stack.sh up                                   # build → 起動 → 全部が答えるまで待つ
```

CDP は `127.0.0.1:29222` に publish されます（host の 9222 は、自分の worker をそこに publish する利用者の stack に譲る）。`bin/cdp.sh` は自分でそれを見つけます。

監視の道具なしで worker だけを手で起こす場合:

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
橋渡しします。外部の CDP クライアントはコンテナ IP のポート `9222`（または publish した
loopback のポート）に接続します。理由と確認方法は
[Chrome DevTools Protocol](/ja/configuration/cdp/) を参照してください。

## ヘルスとライフサイクル

Dockerfile の `HEALTHCHECK` は Docker 互換ランタイム（CI の smoke ジョブ）では
機能しますが、**Apple Container は HEALTHCHECK を評価しません** —
worker のヘルスは外部からプローブします。compose スタックはこれを常時やります
（blackbox → Prometheus、alert `ChromiumCdpDown`）。手でやるなら:

```sh
curl -sf --max-time 5 http://127.0.0.1:29222/json/version >/dev/null && echo OK
```

`container stop` は SIGTERM を送り、猶予は **5 秒**です（Docker の既定は 10 秒）。
supervisord がシグナルを Chromium と socat へ転送します。

```sh
./bin/stack.sh down            # compose スタックを止める（コンテナは `container rm` まで残る）
container stop chromium-1      # 手で起こした --rm 付きのコンテナは停止と同時に削除される
```

## 次のステップ

- [監視スタック](/ja/getting-started/monitoring/) — Prometheus と Grafana が worker について
  何を見せるか、alert の規則。
- [Chromium フラグ](/ja/configuration/chromium-flags/) — 各起動フラグの意味と、
  カスタム `.conf` での上書き方法。
- [駆動モデルと dbus](/ja/internals/driving-model/) — このイメージが前提とする
  one-tab-per-worker の契約。
