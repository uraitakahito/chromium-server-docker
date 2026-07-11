# development イメージ（凍結保管中 / mothballed）

| | |
| --- | --- |
| **状態** | ❄ 凍結（メンテナンス予定なし・削除はしない） |
| **凍結日** | 2026-07-11 |
| **最終確認** | base: `9e9be62` ＋再構築ワークツリー。`docker build -f attic/development/Dockerfile .`（OrbStack / Docker 29.x, arm64）が成功することを凍結時に確認 |
| **凍結理由** | Apple Container 移行に伴い、開発を「ホスト macOS + CDP + `debug` ターゲット」方式へ変更（docs-site の development ページ参照）。コンテナ内完結の開発環境（dotfiles / Claude Code / VS Code attach / zsh 履歴 volume / ssh-agent 転送）は当面不要になったため |

## これは何だったか

noVNC・Node.js・Claude Code・dotfiles を同梱したフル開発イメージ。
VS Code の **Attach to Running Container** でコンテナに入り、`/app` に
bind mount したソースを編集して開発する前提だった。
当時の使い方は同梱の [docs.md](./docs.md)（英語）/ [docs.ja.md](./docs.ja.md)（日本語）を参照。

このディレクトリには dev イメージ**専用**のファイルだけを置いている:

| ファイル | 役割 |
| --- | --- |
| `Dockerfile` | dev イメージ本体（COPY パスは attic 基準に修正済み） |
| `supervisord-headful.conf` | chromium + socat の supervisord 設定（VNC は desktop-lite の entrypoint が起動） |
| `start-supervised.sh` | CMD 用の supervisord 起動ラッパ |

`start-chromium.sh` と `chromium-headful.conf` は live 側
（`docker/Dockerfile` の `debug` ターゲット）と共有しているため、
リポジトリルートに残っている。

## 凍結中の扱い

- **ビルド CI（docker-build.yml）の対象外**。壊れても CI は赤くならない
- **hadolint だけは対象のまま**（`**/Dockerfile` 再帰。静的で維持コストゼロのため）
- 外部リポジトリ 3 つ（dotfiles / features / extra-utils）のコミット固定と
  Debian タグに依存しており、**時間経過でビルドが壊れる可能性は受け入れる**。
  直すのは復活作業の一部であり、凍結中の義務ではない

## 復活チェックリスト（作業量の目安: 半日〜）

- [ ] dotfiles / features / extra-utils のコミット固定を最新リリースへ更新
- [ ] ベースイメージ（`debian:bookworm` タグ）を live 側（`docker/Dockerfile`）と揃える
- [ ] リポジトリルートから `docker build -f attic/development/Dockerfile . --build-arg user_id=$(id -u) --build-arg group_id=$(id -g)` が通ることを確認
      （**Apple Container では VS Code attach が使えない** → OrbStack 等の Docker 互換環境で使うこと）
- [ ] 置き場所を `docker/development/` に戻すか判断し、戻す場合は COPY パスを再修正
- [ ] `.github/workflows/docker-build.yml` の matrix に development を復帰
      （旧設定: `file: docker/development/Dockerfile` + `build-args: user_id/group_id=1001`）
- [ ] 同梱の docs.md / docs.ja.md を docs-site の development ページとして復帰（現ページとの棲み分けを検討）
- [ ] live 側と共有している `chromium-headful.conf` / `start-chromium.sh` の差分を確認
