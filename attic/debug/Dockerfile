#
# ❄ MOTHBALLED (2026-07-11) — kept buildable but UNMAINTAINED.
#
# The headful debug target (VNC/noVNC). Frozen because the chrome://inspect
# DevTools screencast covers visual verification against headless production
# workers (measured — see the Verifying workers docs page). See README.md in
# this directory for the freeze notice and revival checklist.
#
# This file is a self-contained snapshot: the `base` stage below is a copy
# of docker/Dockerfile's base stage as of the freeze date, so later changes
# to the live Dockerfile cannot break this frozen unit.
#
# Build from the repository root (Apple Container; Docker works too):
#   container build -f attic/debug/Dockerfile --target debug -t chromium-server:debug .
# Or simply run ./attic/debug/dev.sh
#

# ---------------------------------------------------------------------------
# base — shared Chromium server core (frozen copy)
# ---------------------------------------------------------------------------

# Debian 12.14 slim variant. Tag retained for human-readable provenance;
# multi-arch manifest list digest pins the actual bits we resolve to
# (arm64 under Apple Container on Apple silicon, amd64 in CI).
FROM debian:bookworm-20260623-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df AS base

# The image runs Chromium as an unprivileged system user. The user / group
# are created with --system so their UID / GID land in the Debian system
# range (100-999), avoiding collisions with arbitrary host UID / GID values
# that build-time ARGs would have to pass through.

# Avoid warnings by switching to noninteractive for the build process
ENV DEBIAN_FRONTEND=noninteractive

ARG LANG=C.UTF-8
ENV LANG="$LANG"
ARG TZ=UTC
ENV TZ="$TZ"

# Create unprivileged user + install runtime essentials.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl && \
    groupadd --system chromium && \
    useradd --system --gid chromium \
            --create-home --shell /bin/bash chromium && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Chromium and fonts for major charsets (Chinese, Japanese, Arabic, Hebrew, Thai).
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        chromium \
        chromium-sandbox \
        fonts-ipafont-gothic \
        fonts-wqy-zenhei \
        fonts-thai-tlwg \
        fonts-kacst \
        fonts-freefont-ttf && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# dbus for session-bus wrapping (start-chromium.sh runs dbus-run-session;
# see the live docker/Dockerfile for the full rationale).
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        dbus && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# supervisor for process management
RUN apt-get update && \
    apt-get install -y --no-install-recommends supervisor && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# socat: forwards 0.0.0.0:9222 to Chromium's localhost-only CDP port 9223
# (--remote-debugging-address=0.0.0.0 is disabled upstream; see the live
# docker/Dockerfile for references).
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        socat && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# start-chromium.sh is still live at the repository root (production uses it).
COPY --chmod=755 start-chromium.sh /app/start-chromium.sh

# ---------------------------------------------------------------------------
# debug — headful + VNC/noVNC, for watching Chromium render during
# development. Driven over CDP exactly like production; the only additions
# are a virtual display and its VNC delivery.
#
#   xvfb       : virtual X server (in-memory framebuffer, display :1)
#   fluxbox    : minimal window manager (frames/titles for the browser window)
#   x11vnc     : serves display :1 over VNC on :5901
#   novnc      : browser-based VNC client pages
#   websockify : bridges VNC (:5901) to WebSocket (:6080) for noVNC
# ---------------------------------------------------------------------------
FROM base AS debug

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        xvfb \
        x11vnc \
        fluxbox \
        novnc \
        websockify && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Paths are attic/debug/ based (this frozen unit is self-contained).
# (--chmod=644: the container runs as the non-root 'chromium' user; without
# an explicit chmod, COPY preserves source permissions and a 600 source
# would make the file unreadable for supervisord.)
COPY --chmod=644 attic/debug/supervisord-debug.conf /etc/supervisor/conf.d/app.conf
COPY --chmod=644 attic/debug/chromium-headful.conf /app/chromium-headful.conf

# Same probe as production: the CDP endpoint is the contract, VNC is only
# a viewing aid. Evaluated by Docker-compatible runtimes; Apple Container
# ignores HEALTHCHECK (probe externally).
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:9222/json/version || exit 1

USER chromium

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/app.conf"]
