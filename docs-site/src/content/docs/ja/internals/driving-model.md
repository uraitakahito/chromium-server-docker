---
title: 駆動モデルと dbus
description: このイメージが前提とする「1 worker = 1 tab」契約と、なぜ Chromium を dbus-run-session で包むのか。
---

このイメージは汎用ブラウザではなく、ひとつの駆動モデルに合わせて削り込んだ薄い CDP
コンテナである。そのモデルを理解すると、flag と dbus の選択のほとんどが腑に落ちる。

## 1 worker = 1 tab の契約

外部 worker（例: [BrowserHive](https://github.com/uraitakahito/browserhive) の
worker）は次を守ることを期待される:

- **ひとつの tab** を生存期間中ずっと使う。
- タスク間の状態リセットは、新しい tab を開くのではなく、`about:blank` への遷移と
  CDP による cookie クリアで行う。
- その `about:blank` 遷移が直前 document を**完全に破棄する**ことに依存する。

最後の点が bfcache を無効化する理由である。Back-Forward Cache が ON だと、
`about:blank` は直前 document を破棄せずメモリへ suspend し、DOM・timer・fingerprint
面をタスク境界をまたいで漏らす。詳しい理由は
[Chromium フラグ](/configuration/chromium-flags/) を参照。

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
