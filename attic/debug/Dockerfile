#
# ❄ 凍結（2026-07-11） —— build できる形で残すが、メンテナンスはしない。
#
# headful の debug target（VNC/noVNC）。
# 凍結した理由は、headless の production の worker に対する、
# chrome://inspect の DevTools の screencast で、目視の確認が足りるから
# （実測 —— docs の Verifying workers のページを参照）。
# 凍結の告知と復活の手順は、このディレクトリの README.md を参照。
#
# このファイルは自己完結のスナップショット:
# 下の `base` の段は、凍結の日の docker/Dockerfile の base の段の写しなので、
# 後で live の Dockerfile を変えても、この凍結ユニットは壊れない。
#
# リポジトリの root から build する（Apple Container。Docker でも動く）:
#   container build -f attic/debug/Dockerfile --target debug -t chromium-server:debug .
# または ./attic/debug/dev.sh を走らせるだけでよい。
#

# ---------------------------------------------------------------------------
# base —— Chromium server の共通の中核（凍結した写し）
# ---------------------------------------------------------------------------

# Debian 12.14 の slim。tag は、人が出どころを読めるように残す。
# 実際に解決する中身は、multi-arch の manifest list の digest が固定する
# （Apple silicon の Apple Container では arm64、CI では amd64）。
FROM debian:bookworm-20260623-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df AS base

# この image は Chromium を、特権の無い system user で動かす。
# user と group は --system で作り、UID / GID を Debian の system の範囲（100-999）に収める。
# build の ARG で host の任意の UID / GID を受け渡すと衝突しうるので、それを避ける。

# build の間は noninteractive に切り替えて、警告を避ける
ENV DEBIAN_FRONTEND=noninteractive

ARG LANG=C.UTF-8
ENV LANG="$LANG"
ARG TZ=UTC
ENV TZ="$TZ"

# 特権の無い user を作り、実行に欠かせない物を入れる。
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl && \
    groupadd --system chromium && \
    useradd --system --gid chromium \
            --create-home --shell /bin/bash chromium && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Chromium と、主な文字のフォント（中国語・日本語・アラビア語・ヘブライ語・タイ語）。
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

# session bus で包むための dbus（start-chromium.sh が dbus-run-session を走らせる。
# 理由の全部は docs: internals/driving-model を参照）。
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        dbus && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# プロセスの管理のための supervisor
RUN apt-get update && \
    apt-get install -y --no-install-recommends supervisor && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# socat: 0.0.0.0:9222 を、Chromium の localhost だけの CDP の口 9223 へ転送する
# （--remote-debugging-address=0.0.0.0 は上流で無効。参考は docs: configuration/cdp を参照）。
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        socat && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# start-chromium.sh はいまも live で、リポジトリの root に在る（production が使う）。
COPY --chmod=755 start-chromium.sh /app/start-chromium.sh

# ---------------------------------------------------------------------------
# debug —— headful と VNC/noVNC。開発中に Chromium の描画を見るための物。
# production とまったく同じく CDP で駆動する。
# 足したのは、仮想ディスプレイと、それを VNC で配る物だけ。
#
#   xvfb       : 仮想の X server（メモリ上の framebuffer、display :1）
#   fluxbox    : 最小の window manager（ブラウザのウィンドウの枠と題）
#   x11vnc     : display :1 を :5901 の VNC で配る
#   novnc      : ブラウザで動く VNC クライアントのページ
#   websockify : noVNC のために、VNC（:5901）を WebSocket（:6080）へ橋渡しする
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

# パスは attic/debug/ 基準（この凍結ユニットは自己完結している）。
# （--chmod=644: コンテナは非 root の 'chromium' user で動く。
# chmod を明示しないと COPY は元の権限を保ち、元が 600 だと supervisord がファイルを読めない。）
COPY --chmod=644 attic/debug/supervisord-debug.conf /etc/supervisor/conf.d/app.conf
COPY --chmod=644 attic/debug/chromium-headful.conf /app/chromium-headful.conf

# production と同じ probe: 契約は CDP の口で、VNC は見るための補助にすぎない。
# Docker 互換の runtime が評価する。Apple Container は HEALTHCHECK を無視する（外から probe する）。
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:9222/json/version || exit 1

USER chromium

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/app.conf"]
