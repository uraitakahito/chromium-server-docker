---
title: 開発（ホスト + CDP）
description: macOS ホスト側で開発し、debug ターゲットの Chromium コンテナを CDP で駆動。noVNC や chrome://inspect で描画を観察する。
---

開発は**ホスト側**で行います。エディタ・Node.js などのツール一式は
macOS 上で動かし、Chromium は単一 multi-stage `docker/Dockerfile` の `debug`
ターゲットから作ったコンテナで動かします — headful で、仮想ディスプレイを
VNC/noVNC 越しに観察できます。

ランタイムは [Apple Container](https://github.com/apple/container)
（macOS 26 以降・Apple Silicon）。コンテナ＝軽量 VM が**それぞれ固有の IP**を持ち、
どの worker も自分のアドレスの `:9222`（CDP）と `:6080`（noVNC）を公開します。
ホスト側のポートマッピングは不要で、2 台目のポートずらしもありません。

:::note
このページのコマンドはすべて**リポジトリルートで実行**する前提です
（ビルドコンテキストが `.` であり、`bin/` のヘルパも相対パスで呼び出すため）。

以前の「コンテナ内完結」開発環境（Node.js・dotfiles・Claude Code・VS Code attach）は
`attic/development/` に**凍結保管**しています。経緯と復活手順は
`attic/development/README.md` を参照してください。
:::

## 初回のみのセットアップ

```sh
container system start
```

## debug worker を build して起動する

```sh
./bin/dev.sh
```

スクリプトが `debug` ターゲットをビルドし、`chromium-debug` という worker を
（再）起動して URL を表示します:

```text
CDP  : http://192.168.64.x:9222/json/version
noVNC: http://192.168.64.x:6080/vnc.html
```

:::caution
初回接続時に macOS が**ローカルネットワーク**権限を求めることがあります。
接続元アプリ（ターミナル・ブラウザ）と Container ランタイムの**両方**を許可してください。
許可漏れは empty reply やハングとして現れます。
:::

## 目視で確認する

`./bin/dev.sh` が表示した noVNC の URL を開き **Connect** を押します:

```text
http://192.168.64.x:6080/vnc.html
```

fluxbox の枠付き headful Chromium が、CDP クライアントの操作どおりに動く様子が見えます。

ツール追加ゼロで **headless** worker にも使える代替手段 —
`chrome://inspect` の DevTools スクリーンキャスト — は
[worker の動作確認](/getting-started/verify/) を参照してください。

## プロセス管理

コンテナ内の全プロセス（`xvfb`・`fluxbox`・`x11vnc`・`novnc`・`chromium`・`socat`）は
`supervisord` が管理します:

```sh
container exec -it chromium-debug supervisorctl -c /etc/supervisor/conf.d/app.conf status
container exec -it chromium-debug supervisorctl -c /etc/supervisor/conf.d/app.conf restart chromium
```

## 次のステップ

- [Chromium フラグ](/ja/configuration/chromium-flags/) — 各起動フラグの意味と、
  カスタム `.conf` での上書き方法。
- [駆動モデルと dbus](/ja/internals/driving-model/) — このイメージが前提とする
  one-tab-per-worker の契約。
