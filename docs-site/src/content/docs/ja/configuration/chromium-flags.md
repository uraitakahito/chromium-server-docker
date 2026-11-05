---
title: Chromium フラグ
description: このイメージが設定する Chromium 起動 flag の一覧・理由と、独自の .conf で上書きする方法。
---

Chromium の起動 flag は plain な設定ファイルに置く。Production（ヘッドレス）は
`chromium-headless.conf`。各行が 1 オプションで、空行と `#` で始まる行は無視される。
`start-chromium.sh` がファイルを読み、コメントを除き、残った flag で Chromium を
exec する。

（ヘッドフル用の `chromium-headful.conf` は凍結ユニットとともに `attic/` 配下へ
移動した。flag 自体は下表で引き続き解説する。）

## flag を上書きする

`container run` は単一ファイルの bind-mount を断る（`path '…' is not a directory`）ので、ディレクトリを `/app` に被せる。このリポジトリの checkout から、イメージが `/app` に置くファイルをコピーし、`.conf` を編集する:

```sh
mkdir custom-app
cp chromium-headless.conf start-chromium.sh process-exporter.yml custom-app/
# custom-app/chromium-headless.conf を編集してから:
container run \
  --mount type=bind,source="$PWD/custom-app",target=/app,readonly \
  ...
```

## flag リファレンス

| Flag | 理由 |
| ---- | ---- |
| `--headless` | ヘッドレス（production）イメージ。凍結中のヘッドフル（`attic/`）では省略し、VNC ディスプレイへ描画する。 |
| `--remote-debugging-port=9223` | コンテナ**内**の CDP エンドポイントのポート。Chromium は localhost のみに bind し、公開ポート `9222` を `socat` が橋渡しする（[CDP](/configuration/cdp/) 参照）。 |
| `--remote-debugging-address=127.0.0.1` | CDP を localhost に bind。Chromium は `0.0.0.0` への bind を security 上の理由で廃止したため、外部アクセスは `socat` 経由。 |
| `--no-first-run`, `--no-default-browser-check` | 初回起動 UI と既定ブラウザ確認をスキップ。 |
| `--disable-background-networking` | variations 取得や更新 ping などの background 通信を止め、捕獲のノイズを減らす。 |
| `--disable-dev-shm-usage` | `/dev/shm` の代わりに `/tmp` を使う。コンテナ既定の `/dev/shm` は小さく Chromium が crash するため。 |
| `--disable-gpu` | コンテナに GPU は無い。 |
| `--no-sandbox`, `--disable-setuid-sandbox` | 隔離境界はコンテナ側が担う。setuid sandbox は本イメージが与えない権限を要求する。 |
| `--password-store=basic` | credential store を `basic` に固定し keychain 自動検出を抑止する — 下記参照。 |
| `--disable-blink-features=AutomationControlled` | `AutomationControlled` Blink 機能を外し、automation の fingerprint を目立たなくする。 |
| `--disable-back-forward-cache` | bfcache を無効化し、履歴で戻るときも CDP から見える要求が出るようにする — 下記参照。 |
| `--disk-cache-size=1073741824` | 1 GiB の disk cache。int32 の最大値（`2147483647`）未満に収める必要がある。超えると Chromium は黙って拒否する。 |
| `--user-data-dir=/tmp/chrome-profile` | プロファイルディレクトリを `/tmp` 下に置く。 |
| `--start-maximized` | 凍結中のヘッドフル conf のみ — VNC ディスプレイでウィンドウを最大化。 |

## なぜ `--password-store=basic` か

Linux の Chromium は、desktop environment から credential backend を 1 つ選ぶ。KDE なら KWallet、それ以外は Secret Service（`org.freedesktop.secrets`。GNOME Keyring が提供する）。選んだものが無ければ `basic`（user data dir 下の暗号化ファイル）へフォールバックする。

このイメージ（Debian slim・desktop environment 無し）にはどちらも無いので、flag が無いと Chromium は起動時に session bus で Secret Service を探し、`basic` へフォールバックする。`basic` を強制すると、その問い合わせを省き、コンテナの環境で backend が変わらないように固定できる。session bus がある限り、flag の有無で stderr は変わらない。

ここで安全なのは、イメージが自動捕獲のために CDP で駆動され、ユーザーにパスワード
保存を求めることが無いから。`basic` の弱いオンディスク暗号化は問題にならない。
ヘッドレスの conf も凍結中のヘッドフル conf も、同じ理由でこの flag を持つ。

## なぜ `--disable-back-forward-cache` か

Back-Forward Cache（bfcache）は、直前 document をメモリに凍らせて残し、戻る/進むのときに通信なしで復元する仕組み。既定で ON。

CDP で駆動するパイプラインでは、これが要求を隠す。bfcache が ON だと、履歴で戻っても document は要求なしで復元され、CDP の `Fetch` にも `Network` にも何も映らない。この flag があれば document は作り直され、その要求は両方を通る。

bfcache の利点（戻る/進むの即時復元）は、人手の介在が無い CDP 駆動のパイプラインには当てはまらない。Playwright と browsertrix-crawler も同じ flag を付けている。そうしないと `page.goBack()` のときに主要求を横取りできないからである。
