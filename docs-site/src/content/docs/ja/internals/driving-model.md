---
title: 駆動モデルと dbus
description: tab の使い方を誰が決めるかと、なぜ Chromium を dbus-run-session で包むのか。
---

このイメージは薄い CDP コンテナである。Chromium を起動して CDP を公開し、残りは CDP クライアントに任せる。このページは、クライアントに任せることと、イメージ自身が受け持つことを説明する。

## CDP クライアントが決める

tab と BrowserContext をいくつ使うか、タスクの状態を次へ持ち越さないようにどうするかは、CDP クライアントが決める。イメージは特定の形を強制も前提もしない。

Chromium は tab を 1 枚開いた状態で起動する。クライアントはその tab を駆動してもよいし（[`bin/cdp.sh`](/getting-started/verify/) はそうする）、使わずに自分の BrowserContext と tab を開いてもよい。

## desktop environment を持たない

コンテナは desktop environment を持たないので、OS 連携の probe（keychain,
gnome-keyring, KWallet, …）は話しかける相手がいない。放置すると失敗して起動ごとに
stderr を汚すため、抑止している — credential store は `--password-store=basic`、
D-Bus は scope を絞った session bus で対処する。

## なぜ Chromium を `dbus-run-session` で包むのか

`start-chromium.sh` は Chromium を `dbus-run-session` 経由で exec する。これは
**プロセスごとに新しい session** の D-Bus daemon を起動し、Chromium 開始前に
`DBUS_SESSION_BUS_ADDRESS` を export する。これにより、Chromium が起動時に出す
session-bus probe（Notifications, ScreenSaver, AT-SPI）を、supervisord に常駐 dbus
daemon を置くことなく黙らせられる。

### なぜ `dbus-launch --autolaunch` ではないのか

`autolaunch`（`dbus-x11` 由来）は `$DISPLAY` が未設定だと daemon の起動を拒否する —
X11 atom で協調するため、完全ヘッドレスのコンテナでは使えない。`dbus-run-session`
（`dbus` パッケージ由来）はそうした X11 依存が無く、`SIGHUP`/`SIGTERM`/`SIGINT` を
子プロセスへ転送し（supervisord の graceful shutdown が Chromium に届く）、Chromium
終了時に daemon を自動で片付ける。

### scope は session bus のみ

提供するのは **session** bus だけ。**system** bus の probe（UPower,
NetworkManager, BlueZ）は意図的に抑止しない — `dbus-daemon --system` を動かすと常駐
root daemon が必要になり、本イメージの「薄い CDP コンテナ」という方針に反するため。
残る stderr ノイズは既知ノイズとして扱い、必要ならログ集約層で filter する。
