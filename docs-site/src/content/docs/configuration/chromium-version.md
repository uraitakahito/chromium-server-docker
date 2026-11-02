---
title: Chromium version
description: How the image pins Chromium and every other apt package, how to read the version that runs, and how to move the pin.
---

The image installs Debian's `chromium` (the stable channel). Two values in
[`docker/Dockerfile`](https://github.com/uraitakahito/chromium-server-docker/blob/main/docker/Dockerfile)
decide exactly which build goes in:

| Value | What it fixes |
| --- | --- |
| `ARG CHROMIUM_VERSION` | The Debian version of `chromium`, `chromium-common` and `chromium-sandbox`. The install names it, so a snapshot that does not list it fails the build. |
| `ARG APT_SNAPSHOT` | The [snapshot.debian.org](https://snapshot.debian.org/) time apt reads **every** package from: the fonts, `dbus`, `supervisor`, `socat`, `curl` and `ca-certificates` as well. |

Rebuilding the image installs the same package versions every time, on both
architectures (arm64 under Apple Container, amd64 in CI). The base image's
digest pins only the base image; apt reads the snapshot, not deb.debian.org.

## Reading the running version

```sh
curl -s http://localhost:9222/json/version                 # "Browser": "Chrome/<upstream version>"
container image inspect chromium-server:production         # labels …chromium-version and …apt-snapshot
```

`<upstream version>` is `CHROMIUM_VERSION` without the Debian revision
(`156.0.8078.73-1~deb12u1` → `156.0.8078.73`). Three checks compare the two:

- the CI smoke test, on both architectures (and the installed `dpkg` version);
- `./bin/check-stack.mjs` for the [monitoring stack](/getting-started/monitoring/);
- BrowserHive's stack check, for each of its workers.

A mismatch means the container runs an image built before the current pin.
Rebuild it.

## Why not the base image's date

The base image (`debian:bookworm-<YYYYMMDD>-slim`) was itself built from
snapshot.debian.org at that date, and records it in
`/etc/apt/sources.list.d/debian.sources`. Reading packages from the same time
looks natural, but a new base image appears only every one to five weeks,
while Debian ships a chromium update about every week. On 2026-10-27, the
base's own snapshot held `156.0.8078.47`; `156.0.8078.73` reached the archive
two days later.

So `APT_SNAPSHOT` is a value of its own. The first `RUN` refuses only a time
*earlier* than the base's, which would mix older packages with the base's
newer ones.

## Moving the pin

```sh
node bin/pin-chromium.mjs                                   # the current pin and the newest one
node bin/pin-chromium.mjs --write                           # write the newest into docker/Dockerfile
node bin/pin-chromium.mjs --write 156.0.8078.73-1~deb12u1   # or a given version
```

The helper needs Node 22+ and `xz` on `PATH`. It asks snapshot.debian.org for:

1. the newest chromium for the base image's codename (bookworm: `~deb12u…`),
   unless a version is given;
2. the earliest debian-security import whose index lists that version for
   **both** amd64 and arm64, and which is not earlier than the base's time.

The architectures can disagree for a while after a Debian upload. At 18:00 UTC
on 2026-10-29, the arm64 index already listed `156.0.8078.73`, and the amd64
index still listed `.47`. The helper checks the index itself, not only when
the packages reached the archive.

The first build after moving the pin downloads every package from
snapshot.debian.org, which serves each file separately: 223 MB took about five
minutes on 2026-11-02. A rebuild of the same pin took seconds, from the
service's cache and from the build cache.

### When Dependabot bumps the base image

Dependabot checks the base image every week. It bumps the tag and the digest
together, but never the two `ARG`s, so its pull request fails the build:

```
APT_SNAPSHOT=… is earlier than the base image's snapshot …; run: node bin/pin-chromium.mjs --write
```

Check out the pull request's branch, run `node bin/pin-chromium.mjs --write`,
commit `docker/Dockerfile` and push. CI builds both architectures again, and
Chromium moves in the same pull request.

### Security updates

A Chromium security update reaches the image only when the pin moves. Debian
ships chromium point releases about two days after upstream, and new major
versions after about a week. Run the helper whenever a Debian chromium update
is out. There is no need to wait for a new base image.

## Not pinned here

- **The exporters** have their own version `ARG`s and
  `docker/exporters.sha256` (see [Metrics](/configuration/metrics/)).
- **`attic/`** Dockerfiles are not built, and they still install whatever apt
  serves on the day.
