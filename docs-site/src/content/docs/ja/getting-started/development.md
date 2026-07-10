---
title: 開発（noVNC）
description: noVNC・Node.js・開発ツール入りのフル開発イメージを build/run する。プロセスは supervisord が管理する。
---

Development イメージは、Chromium を開発・観察するためのフル環境:

- **noVNC** でブラウザから Chromium の描画を観察できる（`http://localhost:6080/`、
  2 台目は `http://localhost:6081/`）。
- **Claude Code** がプリインストール済み。dotfiles と追加ユーティリティ入り。
- ホスト OS は macOS を想定。
- `GH_TOKEN` 環境変数をコンテナへ引き渡す。

:::caution
以下は macOS ホスト前提（ホストの SSH-agent socket を
`/run/host-services/ssh-auth.sock` にマウントする）。他のホストでは mount を調整する。
:::

## イメージを build する

```sh
PROJECT=$(basename "$PWD" | tr '[:upper:]' '[:lower:]')
docker image build -f docker/development/Dockerfile -t "$PROJECT-image:development" . \
  --build-arg user_id=`id -u` \
  --build-arg group_id=`id -g` \
  --build-arg TZ=Asia/Tokyo
```

## 初回のみのセットアップ

シェル履歴をコンテナの run をまたいで永続化する named volume を作る（dotfiles が
シェル履歴をここへ逃がす）:

```sh
docker volume create $PROJECT-zsh-history
```

共有 network を作る:

```sh
docker network create chromium-network
```

## 2 台のコンテナを run する

```sh
# chromium-server-1 — noVNC :6080, CDP :9222
docker container run -d --rm --init \
  --mount type=bind,src=/run/host-services/ssh-auth.sock,dst=/run/host-services/ssh-auth.sock \
  -e SSH_AUTH_SOCK=/run/host-services/ssh-auth.sock \
  -e GH_TOKEN=$(gh auth token) \
  --mount type=bind,src=`pwd`,dst=/app \
  --mount type=volume,source=$PROJECT-zsh-history,target=/zsh-volume \
  -p 5901:5901 -p 6080:6080 -p 9222:9222 \
  --network chromium-network --name chromium-server-1 \
  $PROJECT-image:development

# chromium-server-2 — noVNC :6081, CDP :9223
docker container run -d --rm --init \
  --mount type=bind,src=/run/host-services/ssh-auth.sock,dst=/run/host-services/ssh-auth.sock \
  -e SSH_AUTH_SOCK=/run/host-services/ssh-auth.sock \
  -e GH_TOKEN=$(gh auth token) \
  --mount type=bind,src=`pwd`,dst=/app \
  --mount type=volume,source=$PROJECT-zsh-history,target=/zsh-volume \
  -p 5902:5901 -p 6081:6080 -p 9223:9222 \
  --network chromium-network --name chromium-server-2 \
  $PROJECT-image:development
```

履歴 volume の所有者を初回だけ直す（volume ドライバが root で作るため）:

```sh
sudo chown -R $(id -u):$(id -g) /zsh-volume
```

## プロセス管理

Chromium と `socat` は **supervisord** が管理する。状態確認:

```sh
supervisorctl -c /etc/supervisor/conf.d/app.conf status
```

Chromium を再起動:

```sh
supervisorctl -c /etc/supervisor/conf.d/app.conf restart chromium
```

## CDP を確認する

```sh
curl http://localhost:9222/json/version
```

## Visual Studio Code から接続する

1. **コマンドパレット**（`Shift` + `Command` + `P`）を開く。
2. **Dev Containers: Attach to Running Container** を選ぶ。
3. `/app` ディレクトリを開く。

詳細は [VS Code のドキュメント](https://code.visualstudio.com/docs/devcontainers/attach-container#_attach-to-a-docker-container)
を参照。
