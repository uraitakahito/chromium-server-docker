# debug ターゲット（凍結保管中 / mothballed）

| | |
| --- | --- |
| **状態** | ❄ 凍結（メンテナンス予定なし・削除はしない） |
| **凍結日** | 2026-07-11 |
| **最終確認** | 凍結時に `./attic/debug/dev.sh`（Apple Container）で build → run → `bin/cdp.sh smoke` → noVNC HTTP 200 を確認 |
| **凍結理由** | `chrome://inspect` の DevTools スクリーンキャストが **headless の production worker に対して機能する**ことを実測確認（docs の Verifying workers ページ参照）。クローリングの様子の目視確認に headful + VNC が不要になったため |

## これは何だったか

`docker/Dockerfile` にあった `debug` ターゲット — headful Chromium に
Xvfb / fluxbox / x11vnc / noVNC(websockify) を足し、全プロセスを
supervisord（`supervisord-debug.conf`）で管理する目視確認用イメージ。
当時の使い方は同梱の [docs.md](./docs.md)（英語）/ [docs.ja.md](./docs.ja.md)（日本語）を参照。

この Dockerfile は**自己完結スナップショット**になっている: `base` ステージは
凍結時点の `docker/Dockerfile` の base の複製であり、以後 live 側がどう変わっても
この凍結ユニットは影響を受けない。

| ファイル | 役割 |
| --- | --- |
| `Dockerfile` | base（凍結時点の複製）+ debug の自己完結 multi-stage |
| `supervisord-debug.conf` | xvfb / fluxbox / x11vnc / novnc / chromium / socat の supervisord 設定 |
| `chromium-headful.conf` | headful 用の Chromium 起動フラグ |
| `dev.sh` | build + run + URL 表示のヘルパ（`./attic/debug/dev.sh` で今も動く） |

`start-chromium.sh` は live 側（production）と共用のため、リポジトリルートに残っている。

## 使い方（凍結時点の動作確認済み手順）

```console
% ./attic/debug/dev.sh
CDP  : http://192.168.64.x:9222/json/version
noVNC: http://192.168.64.x:6080/vnc.html
% ./bin/cdp.sh smoke          # chromium-debug は chromium-* フォールバックで拾われる
% container stop chromium-debug
```

## 凍結中の扱い

- **ビルド CI（docker-build.yml）の対象外**。壊れても CI は赤くならない
- **hadolint だけは対象のまま**（`**/Dockerfile` 再帰。静的で維持コストゼロのため）
- Debian pin（base スナップショット）は凍結時点のまま。**時間経過でビルドが壊れる可能性は受け入れる**。直すのは復活作業の一部

## 復活チェックリスト

- [ ] base スナップショットの Debian pin を live（`docker/Dockerfile`）と揃えるか判断
- [ ] `container build -f attic/debug/Dockerfile --target debug .` が通ることを確認
- [ ] debug ステージを `docker/Dockerfile` に戻すか、attic のまま使うか判断
      （戻す場合: COPY パスをルート基準に再修正し、conf 2 枚もルートへ）
- [ ] `dev.sh` を `bin/` に戻すか判断
- [ ] `bin/cdp.sh` の worker 自動選択に `chromium-debug` 優先を復活させるか判断
      （現状でも `chromium-*` フォールバックで拾える）
- [ ] `.github/workflows/docker-build.yml` の matrix に debug を復帰
- [ ] docs.md / docs.ja.md を docs-site の development ページとして復帰（サイドバー含む）
- [ ] verify ページの記述を「debug も対象」に戻す
