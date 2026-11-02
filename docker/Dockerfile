#
# chromium-server-docker — single multi-stage image.
#
#   base       : shared Chromium server core (chromium, fonts, dbus,
#                supervisor, socat). Every apt package comes from
#                snapshot.debian.org at APT_SNAPSHOT, and chromium is pinned
#                to CHROMIUM_VERSION. Not runnable on its own.
#   exporters  : fetches the two Prometheus exporters (node_exporter,
#                process-exporter) from GitHub releases and verifies them.
#   production : headless, CDP on :9222 via socat, Prometheus exporters on
#                :9100 / :9256. Last stage, so an untargeted `build` yields
#                production (fail-safe default).
#
# The former headful `debug` target (VNC/noVNC) is mothballed under
# attic/debug/ — the chrome://inspect screencast covers visual verification
# against headless workers (see the Verifying workers docs page).
#
# Build (run from the repository root — the build context `.` must be the
# repo root so that COPY can see the *.conf / *.sh files there):
#   container build --target production -t chromium-server:production -f docker/Dockerfile .
#
# Docs:
#   https://uraitakahito.github.io/chromium-server-docker/
#

# ---------------------------------------------------------------------------
# Pinned versions (docs: configuration/chromium-version)
# ---------------------------------------------------------------------------
# Chromium and every other apt package are pinned by these two values.
# `node bin/pin-chromium.mjs --write` writes them together; do not edit one
# without the other.
#
#   CHROMIUM_VERSION : the Debian version of chromium, chromium-common and
#                      chromium-sandbox. The install below names it, so a
#                      snapshot that does not list it fails the build.
#   APT_SNAPSHOT     : the snapshot.debian.org time apt reads every package
#                      from. It must not be earlier than the base image's own
#                      snapshot time; the first RUN of `base` checks that.
#
# The CI smoke test, bin/check-stack.mjs and browserhive's stack check read
# CHROMIUM_VERSION from the line below, so keep the form
# `ARG CHROMIUM_VERSION=<version>`.
ARG CHROMIUM_VERSION=156.0.8078.73-1~deb12u1
ARG APT_SNAPSHOT=20261029T185537Z

# ---------------------------------------------------------------------------
# base — shared Chromium server core
# ---------------------------------------------------------------------------

# Debian bookworm, slim variant. The digest pins the base image's bits for
# both architectures (arm64 under Apple Container on Apple silicon, amd64 in
# CI). It does not pin what apt installs; APT_SNAPSHOT does. The tag's date
# is the snapshot time the base image itself was built from (debuerreotype),
# and the image records it in /etc/apt/sources.list.d/debian.sources.
# Dependabot bumps the tag and digest together but never the two ARGs above,
# so its PR fails the snapshot check below until bin/pin-chromium.mjs is run
# on the same branch.
FROM debian:bookworm-20261027-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3 AS base

ARG CHROMIUM_VERSION
ARG APT_SNAPSHOT

# The image runs Chromium as an unprivileged system user. The user / group
# are created with --system so their UID / GID land in the Debian system
# range (100-999), avoiding collisions with arbitrary host UID / GID values
# that build-time ARGs would have to pass through. (macOS hosts default to
# GID 20 for the `staff` group, which collides with Debian's `dialout`
# group at the same GID; an explicit `groupadd --gid 20` fails on those
# hosts with no useful diagnostic.)
#
# Bind mounts are intentionally NOT used on chromium-server containers, so
# matching host file ownership is not a requirement here. (The mothballed
# development image in attic/ kept ARG-based user creation because it did
# bind-mount source code under /app.)

# Avoid warnings by switching to noninteractive for the build process
ENV DEBIAN_FRONTEND=noninteractive

ARG LANG=C.UTF-8
ENV LANG="$LANG"
ARG TZ=UTC
ENV TZ="$TZ"

#
# Point apt at snapshot.debian.org at APT_SNAPSHOT.
#
# The base image names its own snapshot in a comment above each source
# (`# http://snapshot.debian.org/archive/debian/<time>`). A time earlier than
# that would mix older packages with the base's newer ones, so it is refused.
# The Release file of bookworm-security carries a Valid-Until date that has
# passed in any snapshot, hence Check-Valid-Until. Plain http: the slim image
# has no ca-certificates yet, and apt verifies the signed InRelease anyway.
# Retries because the snapshot service sometimes answers 429 or 503, and
# bookworm's apt does not read Retry-After. No pipes, so hadolint's DL4006
# (pipefail) does not apply.
#
RUN set -eu; \
    src=/etc/apt/sources.list.d/debian.sources; \
    case "$APT_SNAPSHOT" in \
      [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;; \
      *) echo "APT_SNAPSHOT=$APT_SNAPSHOT is not a snapshot time (YYYYMMDDTHHMMSSZ)" >&2; exit 1 ;; \
    esac; \
    base="$(sed -n 's|^# http://snapshot.debian.org/archive/debian/\([0-9]\{8\}T[0-9]\{6\}Z\)$|\1|p' "$src")"; \
    [ -n "$base" ] || { echo "the base image does not name its snapshot in $src" >&2; exit 1; }; \
    if expr "$APT_SNAPSHOT" \< "$base" >/dev/null; then \
      echo "APT_SNAPSHOT=$APT_SNAPSHOT is earlier than the base image's snapshot $base; run: node bin/pin-chromium.mjs --write" >&2; \
      exit 1; \
    fi; \
    sed -i \
      -e "s|^URIs: http://deb.debian.org/debian\$|URIs: http://snapshot.debian.org/archive/debian/$APT_SNAPSHOT|" \
      -e "s|^URIs: http://deb.debian.org/debian-security\$|URIs: http://snapshot.debian.org/archive/debian-security/$APT_SNAPSHOT|" \
      "$src"; \
    [ "$(grep -c '^URIs: http://snapshot.debian.org/' "$src")" -eq 2 ] \
      || { echo "expected two snapshot URIs in $src" >&2; cat "$src" >&2; exit 1; }; \
    printf 'Acquire::Check-Valid-Until "false";\nAcquire::Retries "5";\n' > /etc/apt/apt.conf.d/99snapshot

RUN groupadd --system chromium && \
    useradd --system --gid chromium \
            --create-home --shell /bin/bash chromium

#
# Runtime packages, in one RUN so apt reads the snapshot once.
#
# chromium, chromium-common, chromium-sandbox: Debian's chromium (the stable
# channel), pinned to CHROMIUM_VERSION. chromium depends on exactly the same
# chromium-common version. Browser clients drive it over CDP; nothing here
# downloads another Chromium.
#
# fonts-*: Chinese, Japanese, Arabic, Hebrew, Thai and a few other scripts.
#
# curl: the HEALTHCHECK and the exporters stage use it; keep it explicit so a
# refactor cannot silently drop it. ca-certificates: TLS for anything the
# container fetches (CDP itself is plain HTTP locally).
#
# We intentionally do NOT pull in a wider utility set (jq, htop, sudo,
# manpages, etc.). This image is driven externally over CDP and is not
# meant to be `container exec`-ed into for ad-hoc operations.
#
# dbus: Chromium probes the dbus session bus at startup for several
# subsystems (Notifications, ScreenSaver, AT-SPI). Without any session bus
# reachable, each probe emits a "Failed to connect to the bus" line to stderr
# on every container launch. `start-chromium.sh` invokes
# `dbus-run-session chromium ...`. That helper, shipped in `dbus`, spawns a
# fresh per-process session bus, exports DBUS_SESSION_BUS_ADDRESS for the
# wrapped command, forwards SIGHUP/SIGTERM/SIGINT to the child, and tears the
# daemon down when chromium exits. No long-lived dbus daemon is needed in
# supervisord.
#
#   Why NOT `dbus-x11` + DBUS_SESSION_BUS_ADDRESS=autolaunch:
#   `dbus-launch --autolaunch` (from `dbus-x11`) requires $DISPLAY — it uses
#   an X11 atom to coordinate daemons — and refuses to spawn without it.
#   Empirically broken in fully-headless containers like this one, so
#   `dbus-x11` is deliberately NOT installed.
#
#   Scope: this silences SESSION-bus errors only. SYSTEM-bus probes (UPower,
#   NetworkManager, BlueZ) still fail because `dbus-daemon --system` is
#   intentionally not running — running it would require a long-lived root
#   daemon and contradict this image's "thin CDP container" stance. Remaining
#   system-bus stderr noise is acknowledged and left for
#   log-aggregation-layer filtering.
#
# supervisor: process management.
#
# socat: Chrome DevTools Protocol port forwarding.
#   Chromium's --remote-debugging-address=0.0.0.0 flag has been disabled or
#   removed in recent versions for security reasons. The Chromium team has
#   stated this flag "presents a security issue and should not be used" and
#   there are "no plans to implement it in the new headless mode."
#   As a workaround, socat forwards external connections (0.0.0.0:9222) to
#   Chromium's localhost-only debugging port (127.0.0.1:9223).
#   References:
#     - https://issues.chromium.org/issues/40261787
#     - https://issues.chromium.org/issues/40279369
#
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        "chromium=${CHROMIUM_VERSION}" \
        "chromium-common=${CHROMIUM_VERSION}" \
        "chromium-sandbox=${CHROMIUM_VERSION}" \
        fonts-ipafont-gothic \
        fonts-wqy-zenhei \
        fonts-thai-tlwg \
        fonts-kacst \
        fonts-freefont-ttf \
        ca-certificates \
        curl \
        dbus \
        supervisor \
        socat && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --chmod=755 start-chromium.sh /app/start-chromium.sh

# ---------------------------------------------------------------------------
# exporters — Prometheus exporters fetched from GitHub releases
# ---------------------------------------------------------------------------
# Two upstream binaries are bundled so the production container can be scraped
# from inside the container network (the ports are not published to the host):
#   node_exporter    (:9100)  VM / OS level metrics (cpu, meminfo, load, fs, net)
#   process-exporter (:9256)  per-process-group metrics, grouped by chromium --type
#
# Versions and sha256 live in docker/exporters.sha256 (4 lines: both exporters,
# amd64 and arm64). Bump the ARG defaults and those 4 lines together. Dependabot
# does not track GitHub release assets, so this is a manual step — the docs page
# configuration/metrics has the procedure.
FROM base AS exporters

ARG NODE_EXPORTER_VERSION=1.12.1
ARG PROCESS_EXPORTER_VERSION=0.8.7

WORKDIR /tmp/exporters
COPY docker/exporters.sha256 ./exporters.sha256

# `dpkg --print-architecture` yields amd64 / arm64 — the same spelling the
# release assets use — without relying on BuildKit's TARGETARCH.
# `sha256sum -c --ignore-missing` checks only the two tarballs present for this
# architecture and fails if none of the listed files could be verified.
RUN set -eu; \
    arch="$(dpkg --print-architecture)"; \
    ne="node_exporter-${NODE_EXPORTER_VERSION}.linux-${arch}"; \
    pe="process-exporter-${PROCESS_EXPORTER_VERSION}.linux-${arch}"; \
    curl -fsSL --retry 3 -o "${ne}.tar.gz" "https://github.com/prometheus/node_exporter/releases/download/v${NODE_EXPORTER_VERSION}/${ne}.tar.gz"; \
    curl -fsSL --retry 3 -o "${pe}.tar.gz" "https://github.com/ncabatoff/process-exporter/releases/download/v${PROCESS_EXPORTER_VERSION}/${pe}.tar.gz"; \
    sha256sum -c --ignore-missing exporters.sha256; \
    tar -xzf "${ne}.tar.gz" --strip-components=1 "${ne}/node_exporter"; \
    tar -xzf "${pe}.tar.gz" --strip-components=1 "${pe}/process-exporter"

# ---------------------------------------------------------------------------
# production — headless, CDP :9222 + Prometheus exporters :9100 / :9256
#              (DEFAULT: last stage in this file)
# ---------------------------------------------------------------------------
FROM base AS production

# The pin, readable without running the image (`container image inspect`).
ARG CHROMIUM_VERSION
ARG APT_SNAPSHOT
LABEL io.github.uraitakahito.chromium-server-docker.chromium-version="${CHROMIUM_VERSION}" \
      io.github.uraitakahito.chromium-server-docker.apt-snapshot="${APT_SNAPSHOT}"

# Copy supervisor configuration and startup config
# Note: --chmod=644 is required because:
#   - The container runs as 'chromium' user (non-root)
#   - Without explicit chmod, COPY preserves the source file's permissions
#   - If the source file has 600 permissions, supervisord cannot read it
COPY --chmod=644 supervisord-headless.conf /etc/supervisor/conf.d/app.conf
COPY --chmod=644 chromium-headless.conf /app/chromium-headless.conf

# Prometheus exporters (docs: configuration/metrics). The binaries come from the
# `exporters` stage above; the process-exporter group definitions live in the
# repo root next to the Chromium flag file.
COPY --from=exporters --chmod=755 /tmp/exporters/node_exporter /tmp/exporters/process-exporter /usr/local/bin/
COPY --chmod=644 process-exporter.yml /app/process-exporter.yml

# Documentation only — compose decides what gets published. 9222 is CDP (via
# socat); 9100 (node_exporter) and 9256 (process-exporter) are meant to be
# scraped from inside the container network and stay unpublished on the host.
EXPOSE 9222 9100 9256

# Health check for CDP availability.
# Honored by Docker-compatible runtimes (e.g. the CI smoke job); Apple
# Container does not evaluate HEALTHCHECK, so operational health there is
# an external probe against http://<container-ip>:9222/json/version.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:9222/json/version || exit 1

USER chromium

# Headless mode execution (Xvfb not required)
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/app.conf"]
