---
title: Chromium フラグ
description: このイメージが設定する Chromium 起動 flag の一覧・理由と、独自の .conf で上書きする方法。
---

Chromium の起動 flag は plain な設定ファイルに置く。Production（ヘッドレス）は
`chromium-headless.conf`、Development（ヘッドフル）は `chromium-headful.conf`。
各行が 1 オプションで、空行と `#` で始まる行は無視される。`start-chromium.sh` が
ファイルを読み、コメントを除き、残った flag で Chromium を exec する。

## flag を上書きする

`.conf` をコピーして編集し、イメージ内のものに bind-mount で被せる:

```sh
docker container run \
  --mount type=bind,src=/path/to/custom.conf,dst=/app/chromium-headless.conf,readonly \
  ...
```

## flag リファレンス

| Flag | 理由 |
| ---- | ---- |
| `--headless` | ヘッドレスイメージのみ。ヘッドフルでは省略し、VNC ディスプレイへ描画する。 |
| `--remote-debugging-port=9223` | コンテナ**内**の CDP エンドポイントのポート。Chromium は localhost のみに bind し、公開ポート `9222` を `socat` が橋渡しする（[CDP](/configuration/cdp/) 参照）。 |
| `--remote-debugging-address=127.0.0.1` | CDP を localhost に bind。Chromium は `0.0.0.0` への bind を security 上の理由で廃止したため、外部アクセスは `socat` 経由。 |
| `--no-first-run`, `--no-default-browser-check` | 初回起動 UI と既定ブラウザ確認をスキップ。 |
| `--disable-background-networking` | variations 取得や更新 ping などの background 通信を止め、捕獲のノイズを減らす。 |
| `--disable-dev-shm-usage` | `/dev/shm` の代わりに `/tmp` を使う。コンテナ既定の `/dev/shm` は小さく Chromium が crash するため。 |
| `--disable-gpu` | コンテナに GPU は無い。 |
| `--no-sandbox`, `--disable-setuid-sandbox` | 隔離境界はコンテナ側が担う。setuid sandbox は本イメージが与えない権限を要求する。 |
| `--password-store=basic` | credential store を `basic` に固定し keychain 自動検出を抑止する — 下記参照。 |
| `--disable-blink-features=AutomationControlled` | `AutomationControlled` Blink 機能を外し、automation の fingerprint を目立たなくする。 |
| `--disable-back-forward-cache` | bfcache を無効化し、`about:blank` が直前 document を確実に破棄するようにする — 下記参照。 |
| `--disk-cache-size=1073741824` | 1 GiB の disk cache。int32 の最大値（`2147483647`）未満に収める必要がある。超えると Chromium は黙って拒否する。 |
| `--user-data-dir=/tmp/chrome-profile` | プロファイルディレクトリを `/tmp` 下に置く。 |
| `--start-maximized` | ヘッドフルのみ — VNC ディスプレイでウィンドウを最大化。 |

## なぜ `--password-store=basic` か

Linux では Chromium は起動時に credential backend を次の順で probe する:

1. GNOME Keyring（libsecret）
2. KWallet（D-Bus 経由）
3. `basic`（user data dir 下の暗号化ファイル）

このイメージ（Debian slim・desktop environment 無し）には (1) も (2) も無いので、
probe は毎回失敗して起動ごとに stderr へノイズを出す。`basic` を強制すると probe の
経路自体をスキップできる。

ここで安全なのは、イメージが自動捕獲のために CDP で駆動され、ユーザーにパスワード
保存を求めることが無いから。`basic` の弱いオンディスク暗号化は問題にならない。
ヘッドレス／ヘッドフルどちらの variant も同じ理由でこの flag を持つ。

## なぜ `--disable-back-forward-cache` か

Back-Forward Cache（bfcache）は、直前 document の DOM・JS 実行コンテキスト・timer・
event listener をメモリに保持し、戻る/進むで即座に復元させる仕組み。Chromium 86+ で
既定 ON。

このイメージは、**ひとつの永続 tab** を生存期間中ずっと持つ外部 worker が CDP で駆動
し、タスク間の状態リセットを `about:blank` への遷移と CDP による cookie クリアで行う。
bfcache が ON だと、その `about:blank` 遷移は直前 document を**破棄せず** cache へ
suspend するだけになり、DOM・timer・listener がタスク境界をまたいで生き残る。これは
driver が目指すタスク間の隔離を損ない、状態・fingerprint 面・リソース使用が捕獲間で
漏れる原因になる。

bfcache の利点（戻る/進むの即時復元）は、人手の介在が無い CDP 駆動のパイプラインには
当てはまらない。Playwright・Puppeteer・browsertrix-crawler も同じ理由で既定で bfcache
を無効化している。
