#
# chromium-server-docker —— 1 つの multi-stage の image。
#
#   base       : Chromium server の共通の中核（chromium・fonts・dbus・supervisor・socat）。
#                apt の package は全部、APT_SNAPSHOT の時点の snapshot.debian.org から入れ、
#                chromium は CHROMIUM_VERSION に固定する。単独では動かない。
#   exporters  : Prometheus の exporter 2 つ（node_exporter・process-exporter）を、
#                GitHub の release から取って検証する。
#   production : headless。CDP は socat 越しに :9222、Prometheus の exporter は :9100 / :9256。
#                最後の段なので、target を指定しない `build` は production を建てる
#                （安全側に倒した既定）。
#
# 以前の headful の `debug` target（VNC/noVNC）は attic/debug/ に凍結した。
# 目視の確認は、headless の worker に対する chrome://inspect の screencast で足りる
# （docs の Verifying workers のページを参照）。
#
# build（リポジトリの root で打つ。COPY がリポジトリのファイルを見られるように、
# build context の `.` はリポジトリの root でなければならない）:
#   container build --target production -t chromium-server:production -f docker/Dockerfile .
#
# docs:
#   https://uraitakahito.github.io/chromium-server-docker/
#
# このファイルは大きくしない。Apple Container の `container build` は
# Dockerfile を gRPC のヘッダで送るので、コメントも含めて約 15,000 バイトを
# 超えると "Stream unexpectedly closed" で落ちる（apple/container#735）。
# 長い説明は docs に書く（bin/dockerfile-size.test.mjs が見張る）。
#

# ---------------------------------------------------------------------------
# 固定した版（docs: configuration/chromium-version）
# ---------------------------------------------------------------------------
# Chromium とほかの apt の package は全部、この 2 つの値で固定する。
# `node bin/pin-chromium.mjs --write` が 2 つを一緒に書く。片方だけを編集しない。
#
#   CHROMIUM_VERSION : chromium・chromium-common・chromium-sandbox の Debian の版。
#                      下の install がこの版を名指すので、
#                      この版を載せていない snapshot では build が落ちる。
#   APT_SNAPSHOT     : apt が全部の package を読む snapshot.debian.org の時点。
#                      base image 自身の snapshot の時点より前ではいけない。
#                      `base` の最初の RUN がそれを確かめる。
#
# CI の smoke test・bin/check-stack.mjs・browserhive のスタックの点検は、
# CHROMIUM_VERSION を下の行から読む。だから `ARG CHROMIUM_VERSION=<version>` の形を保つ。
ARG CHROMIUM_VERSION=156.0.8078.73-1~deb12u1
ARG APT_SNAPSHOT=20261029T185537Z

# ---------------------------------------------------------------------------
# base —— Chromium server の共通の中核
# ---------------------------------------------------------------------------

# Debian bookworm の slim。digest は、両方の arch（Apple silicon の Apple Container では arm64、
# CI では amd64）の base image の中身を固定する。
# apt が入れる物は digest では固定されず、APT_SNAPSHOT が固定する。
# tag の日付は base image 自身を作った snapshot の時点で（debuerreotype）、
# image はそれを /etc/apt/sources.list.d/debian.sources に書いている。
# Dependabot は tag と digest を一緒に上げるが、上の 2 つの ARG は上げない。
# だからその PR は、同じ枝で bin/pin-chromium.mjs を走らせるまで、下の snapshot の確かめで落ちる。
FROM debian:bookworm-20261027-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3 AS base

ARG CHROMIUM_VERSION
ARG APT_SNAPSHOT

# この image は Chromium を、特権の無い system user で動かす。
# user と group は --system で作り、UID / GID を Debian の system の範囲（100-999）に収める。
# build の ARG で host の任意の UID / GID を受け渡すと衝突しうるので、それを避ける。
# （macOS の host では、`staff` group の既定の GID 20 が、
# 同じ GID の Debian の `dialout` group と衝突する。
# その host で `groupadd --gid 20` を明示すると、役に立つ診断も無く失敗する。）
#
# chromium-server のコンテナでは bind mount を意図して使わないので、
# host のファイルの所有者に合わせる必要は無い。
# （attic/ に凍結した development の image は、/app の下にソースを bind mount していたので、
# ARG で user を作る形を残した。）

# build の間は noninteractive に切り替えて、警告を避ける
ENV DEBIAN_FRONTEND=noninteractive

ARG LANG=C.UTF-8
ENV LANG="$LANG"
ARG TZ=UTC
ENV TZ="$TZ"

#
# apt の読み先を、APT_SNAPSHOT の時点の snapshot.debian.org に向ける。
#
# base image は、自分の snapshot を各 source の上のコメントに書いている
# （`# http://snapshot.debian.org/archive/debian/<time>`）。
# それより前の時点だと、base の新しい package に古い package が混ざるので断る。
# bookworm-security の Release ファイルの Valid-Until は、どの snapshot でも過ぎているので、
# Check-Valid-Until を切る。
# http のままなのは、slim の image にはまだ ca-certificates が無いから。
# apt はどのみち、署名つきの InRelease を検証する。
# Retries を入れるのは、snapshot の側がときどき 429 か 503 を返し、
# bookworm の apt が Retry-After を読まないから。
# pipe を使っていないので、hadolint の DL4006（pipefail）は当たらない。
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
# 実行時の package。apt が snapshot を読むのが 1 回で済むように、1 つの RUN にまとめる。
#
# chromium・chromium-common・chromium-sandbox: Debian の chromium（stable の channel）を、
# CHROMIUM_VERSION に固定して入れる。chromium は、まったく同じ版の chromium-common に依存する。
# クライアントが CDP で chromium を駆動する。ここで別の Chromium を download する物は無い。
#
# fonts-*: 中国語・日本語・アラビア語・ヘブライ語・タイ語と、ほかのいくつかの文字。
#
# curl: HEALTHCHECK と exporters の段が使う。refactor で黙って落ちないように、明示しておく。
# ca-certificates: コンテナが取りに行く物の TLS のため（CDP 自体は local では平文の HTTP）。
#
# ほかの道具（jq・htop・sudo・manpages など）は意図して入れない。
# この image は外から CDP で駆動する物で、`container exec` で入って場当たりの操作をする物ではない。
#
# dbus: `start-chromium.sh` は `dbus-run-session chromium ...` で、
# プロセスごとの session bus を用意する。
# Chromium は起動時に session bus を probe し、届かないと、コンテナの起動のたびに、
# probe ごとに "Failed to connect to the bus" の行が stderr に出る。
# supervisord に常駐の dbus daemon は置かない。`dbus-x11` は意図して入れず、
# system bus の daemon は意図して動かさない（理由は docs: internals/driving-model）。
#
# supervisor: プロセスの管理。
#
# socat: Chrome DevTools Protocol の口の転送。Chromium は CDP を
# 127.0.0.1:9223 でしか受けないので、外からの接続（0.0.0.0:9222）を、
# socat がそこへ転送する（理由と参考は docs: configuration/cdp）。
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
# exporters —— GitHub の release から取る Prometheus の exporter
# ---------------------------------------------------------------------------
# コンテナ network の中から production のコンテナを scrape できるように、
# 上流の binary を 2 つ同梱する（口は host に publish しない）:
#   node_exporter    (:9100)  VM / OS の値（cpu・meminfo・load・fs・net・processes）
#   process-exporter (:9256)  process の群ごとの値。chromium の --type で群に分ける
#
# 版と sha256 は docker/exporters.sha256 に在る（4 行: exporter 2 つ × amd64・arm64）。
# ARG の既定値とその 4 行を一緒に上げる。
# Dependabot は GitHub の release の asset を追わないので、これは手で行う ——
# 手順は docs の configuration/metrics のページに在る。
FROM base AS exporters

ARG NODE_EXPORTER_VERSION=1.12.1
ARG PROCESS_EXPORTER_VERSION=0.8.7

WORKDIR /tmp/exporters
COPY docker/exporters.sha256 ./exporters.sha256

# `dpkg --print-architecture` は、BuildKit の TARGETARCH に頼らずに amd64 / arm64 を返す
# （release の asset と同じ綴り）。
# `sha256sum -c --ignore-missing` は、この arch で取った 2 つの tarball だけを確かめ、
# 一覧のファイルを 1 つも確かめられなければ失敗する。
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
# production —— headless、CDP は :9222、Prometheus の exporter は :9100 / :9256
#               （既定: このファイルの最後の段）
# ---------------------------------------------------------------------------
FROM base AS production

# 固定した値。image を動かさなくても読める（`container image inspect`）。
ARG CHROMIUM_VERSION
ARG APT_SNAPSHOT
LABEL io.github.uraitakahito.chromium-server-docker.chromium-version="${CHROMIUM_VERSION}" \
      io.github.uraitakahito.chromium-server-docker.apt-snapshot="${APT_SNAPSHOT}"

# supervisor の設定と起動の設定を写す。
# 注: --chmod=644 が要る理由:
#   - コンテナは 'chromium' user（非 root）で動く
#   - chmod を明示しないと、COPY は元のファイルの権限を保つ
#   - 元のファイルの権限が 600 だと、supervisord が読めない
COPY --chmod=644 supervisord-headless.conf /etc/supervisor/conf.d/app.conf
COPY --chmod=644 chromium-headless.conf /app/chromium-headless.conf

# Prometheus の exporter（docs: configuration/metrics）。binary は上の `exporters` の段から取る。
# process-exporter の群の定義は、リポジトリの root の、Chromium の flag のファイルの隣に在る。
COPY --from=exporters --chmod=755 /tmp/exporters/node_exporter /tmp/exporters/process-exporter /usr/local/bin/
COPY --chmod=644 process-exporter.yml /app/process-exporter.yml

# 説明のためだけの宣言 —— 何を publish するかは compose が決める。9222 は socat 越しの CDP。
# 9100（node_exporter）と 9256（process-exporter）はコンテナ network の中から scrape する物で、
# host には publish しない。
EXPOSE 9222 9100 9256

# CDP が使えるかの health check。
# Docker 互換の runtime（CI の smoke の job など）は従う。
# Apple Container は HEALTHCHECK を評価しないので、
# そこでの生死は http://<container-ip>:9222/json/version への外からの probe で見る。
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:9222/json/version || exit 1

USER chromium

# headless で動かす（Xvfb は要らない）
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/app.conf"]
