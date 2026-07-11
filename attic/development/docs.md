---
title: Development (noVNC)
description: Build and run the full development image with noVNC, Node.js, and dev tools, managed by supervisord.
---

:::note
This is the retired development page, retreated from the docs site at freeze
time (2026-07-11). To keep it usable as instructions, **the Dockerfile path
has been adjusted to the current frozen layout (`attic/development/`)**;
everything else is as it was.
:::

The development image is a full-featured environment for working on and watching
Chromium:

- Watch Chromium render via **noVNC** in a browser at `http://localhost:6080/`
  (or `http://localhost:6081/` for a second container).
- **Claude Code** is pre-installed, along with dotfiles and extra utilities.
- Assumes the host OS is macOS.
- Forwards the `GH_TOKEN` environment variable into the container.

:::caution
These commands assume a macOS host (they mount the host SSH-agent socket at
`/run/host-services/ssh-auth.sock`). Adjust the mounts for other hosts.
:::

## Build the image

```sh
PROJECT=$(basename "$PWD" | tr '[:upper:]' '[:lower:]')
docker image build -f attic/development/Dockerfile -t "$PROJECT-image:development" . \
  --build-arg user_id=`id -u` \
  --build-arg group_id=`id -g` \
  --build-arg TZ=Asia/Tokyo
```

## One-time setup

Create a named volume so shell history persists across container runs (the
dotfiles redirect shell history there):

```sh
docker volume create $PROJECT-zsh-history
```

Create the shared network:

```sh
docker network create chromium-network
```

## Run two containers

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

Fix ownership of the history volume the first time (its files are created as
root by the volume driver):

```sh
sudo chown -R $(id -u):$(id -g) /zsh-volume
```

## Process management

Chromium and `socat` are managed by **supervisord**. Check status:

```sh
supervisorctl -c /etc/supervisor/conf.d/app.conf status
```

Restart Chromium:

```sh
supervisorctl -c /etc/supervisor/conf.d/app.conf restart chromium
```

## Verify CDP

```sh
curl http://localhost:9222/json/version
```

## Attach from Visual Studio Code

1. Open the **Command Palette** (`Shift` + `Command` + `P`).
2. Select **Dev Containers: Attach to Running Container**.
3. Open the `/app` directory.

See the [VS Code docs](https://code.visualstudio.com/docs/devcontainers/attach-container#_attach-to-a-docker-container)
for details.
