---
title: worker の動作確認
description: bin/cdp.sh によるワンショット CDP 確認と、chrome://inspect によるライブ目視。headless の production と debug のどちらの worker にも同じ手順が使える。
---

worker は自分の IP の `:9222` に同じ CDP エンドポイントを公開しています。
IP は `./bin/prod.sh` の出力か `container ls` で確認してください。

:::note
コマンドはリポジトリルートで実行する前提です。初回接続時に macOS が
**ローカルネットワーク**権限を求めることがあります — 接続元アプリ
（ターミナル・Chrome）と Container ランタイムの両方を許可してください。
:::

## クイック確認 — `bin/cdp.sh`（スクリプト不要）

```sh
./bin/cdp.sh smoke                   # version 確認 + ページを開く + タイトル表示
```

```text
chromium-1 (192.168.64.x): Chrome/150.0.7871.100
title: "Yahoo! JAPAN"
```

タイトルが出れば、worker VM・socat・Chromium・CDP の経路すべてが機能しています。
ほかのワンショットコマンド:

```sh
./bin/cdp.sh goto https://www.wikipedia.org   # ナビゲート（load 完了まで待つ）
./bin/cdp.sh title                            # document.title を表示
./bin/cdp.sh eval 'location.href'             # 任意の JS 式を評価
./bin/cdp.sh shot /tmp/page.png               # スクリーンショット保存（headless でも可）
./bin/cdp.sh targets                          # 開いているタブの一覧
```

対象 worker は `chromium-1`（無ければ最初の `chromium-*`）が自動選択されます。
明示するには `CDP_TARGET=chromium-2 ./bin/cdp.sh ...`。失敗はすべて
exit≠0 になるため、そのまま自動チェックにも使えます。

HTTP だけの生存確認（WebSocket を使わない最軽量プローブ）:

```sh
curl http://192.168.64.x:9222/json/version
```

## 目視で確認する — chrome://inspect（ツール追加ゼロ・headless でも映る）

ホストの Chrome で `chrome://inspect/#devices` を開き、**Configure…** に
worker のエンドポイント `192.168.64.x:9222` を追加します。登録には必ず
**IP** を使ってください（ホスト名では不可 — 理由は下の注意参照）。

**Remote Target** に worker のタブが並ぶので **inspect** をクリックすると、
DevTools が開いて**スクリーンキャストに描画がライブ表示**されます。
これは **headless の `production` ターゲットでも映ります** — 新 headless
モードは本物のレンダラとコンポジタを持つため、画面が無くても DevTools に
フレームが届きます（実測: headless worker から `Page.startScreencast` の
フレーム受信を確認済み）。ページ移動はスクリーンキャスト上部の URL バー
（または Console）で行い、Network・Elements・Console など DevTools 一式も
そのまま使えます。

:::caution
**登録は IP で。ホスト名は不可。** Chromium の CDP エンドポイント
（`/json/*`）は、リクエストの **`Host` ヘッダが「IP アドレス」でも
「localhost」でもないと拒否**します（DNS リバインディング攻撃対策）。
そのため、ホスト名（DNS/コンテナのサービス名。例 `chromium-1`。名前解決
できるものでも）だと Chromium が
`Host header is specified and is not an IP address or localhost.` を返し、
**Remote Target に何も表示されません**。受理されるのは IP（または
`localhost`）だけです。加えて `webSocketDebuggerUrl` はこの `Host` から
生成されるため、IP で問い合わせれば DevTools が実際に届く IP ベースの
ws URL が返る、という利点もあります。

これ以外の登録ミス（**ポート番号の誤り**など）でも同様にエラーは出ず、
**Remote Target に何も表示されず、inspect リンクも現れません**。ポートは
`9222` です。疎通は `curl http://<IP>:9222/json/version` で確認できます。
また worker の IP は再起動ごとに変わるため、再起動後は **Configure…** への
再登録が必要です。

inspect ページの「Open tab with url」入力欄は使わないでください。
`/json/new?url=` に依存しており、現行 Chromium では**空タブが増えるだけで
ナビゲートしません**（実測）。ページ移動は必ずスクリーンキャストの URL バーで。
:::

## 次のステップ

- [本番（headless）](/getting-started/production/) — headless worker の
  build と run。
- [Chromium フラグ](/configuration/chromium-flags/) — 各起動フラグの意味と、
  カスタム `.conf` での上書き方法。
