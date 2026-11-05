#
# ❄ 凍結（2026-07-11） —— build できる形で残すが、メンテナンスはしない。
#
# 開発は「host ＋ CDP ＋ debug target」の形に移った
# （当時の手順は attic/debug/docs.ja.md を参照。debug target も同じ日に凍結した）。
# この image は、復活するときのために残す。
# 凍結の告知と復活の手順は、このディレクトリの README.md を参照。
#
# リポジトリの root から build する（Docker/OrbStack で。Apple Container ではない ——
# この image の要点は VS Code の attach だった）:
#   docker build -f attic/development/Dockerfile . \
#     --build-arg user_id=1001 --build-arg group_id=1001
#
# chromium-server-docker —— 開発用の image
# （noVNC・Node.js・開発の道具。プロセスは supervisord が管理する）。
#
# 元の docs（引退した写し）: ./docs.md / ./docs.ja.md
#

# Debian 12.13
FROM debian:bookworm-20260518

ARG user_name=developer
ARG user_id
ARG group_id
# https://github.com/uraitakahito/dotfiles/releases/tag/1.1.9
ARG dotfiles_repository="https://github.com/uraitakahito/dotfiles.git"
ARG dotfiles_commit="89501545e6d91811f549d031f65244cd7e0df87a"
# https://github.com/uraitakahito/features/releases/tag/2.0.1
ARG features_repository="https://github.com/uraitakahito/features.git"
ARG features_commit="9f7e672e27207f374d56e5da7f862b0b5b110b3f"
# https://github.com/uraitakahito/extra-utils/releases/tag/1.3.0
ARG extra_utils_repository="https://github.com/uraitakahito/extra-utils.git"
ARG extra_utils_commit="f975dbcb18f44b518cc181cedad57fd790d9894a"

# build の間は noninteractive に切り替えて、警告を避ける
ENV DEBIAN_FRONTEND=noninteractive

ARG LANG=C.UTF-8
ENV LANG="$LANG"
ARG TZ=UTC
ENV TZ="$TZ"

#
# Git
#
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends \
        ca-certificates \
        git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

#
# features を clone する
#
RUN cd /usr/src && \
    git clone ${features_repository} && \
    cd features && \
    git checkout ${features_commit}

#
# user を足し、共通の道具を入れる。
#
# 入る package の一覧は次を参照:
#   https://github.com/uraitakahito/features/blob/9f7e672e27207f374d56e5da7f862b0b5b110b3f/src/common-utils/main.sh#L35-L79
#
RUN USERNAME=${user_name} \
    USERUID=${user_id} \
    USERGID=${group_id} \
    CONFIGUREZSHASDEFAULTSHELL=true \
    UPGRADEPACKAGES=false \
    # Docker の中で ssh-agent を使うときは、mount した socket に確実に触れるように、
    # user を root の group に足す。
    #   https://github.com/uraitakahito/features/blob/9f7e672e27207f374d56e5da7f862b0b5b110b3f/src/common-utils/main.sh#L490-L495
    ADDUSERTOROOTGROUP=true \
        /usr/src/features/src/common-utils/install.sh

#
# 追加の道具を入れる。
#
RUN cd /usr/src && \
    git clone ${extra_utils_repository} && \
    cd extra-utils && \
    git checkout ${extra_utils_commit} && \
    ADDEZA=true \
    ADDGRPCURL=true \
    ADDHADOLINT=true \
    \
    ADDCLAUDECODE=true \
    # Claude Code は $HOME の下に入るので、username を指定しなければならない。
    USERNAME=${user_name} \
    \
    UPGRADEPACKAGES=false \
        /usr/src/extra-utils/utils/install.sh

# 最新の chrome の dev の package と、主な文字のフォントを入れる
# （中国語・日本語・アラビア語・ヘブライ語・タイ語ほか）。
# 注: Puppeteer が入れる同梱の Chromium を動かすのに要る library も、これで入る。
# https://zenn.dev/tom1111/articles/0dc7cde5c8e9bf
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

#
# session bus で包むための dbus daemon
#
# Chromium は起動時に、いくつかの subsystem（Notifications・ScreenSaver・AT-SPI）のために、
# dbus の session bus を probe する。session bus に届かないと、コンテナを起動するたびに、
# probe ごとに "Failed to connect to the bus" の行が stderr に出る。
#
# `dbus` を入れるのは、`start-chromium.sh` が `dbus-run-session chromium ...` を呼ぶから。
# `dbus` に入っているこの helper は、プロセスごとに新しい session bus を起こし、
# 包んだコマンドに DBUS_SESSION_BUS_ADDRESS を渡し、SIGHUP/SIGTERM/SIGINT を子に転送し、
# chromium が終わると daemon を片付ける。
# supervisord に常駐の dbus daemon を置く必要は無い。
#
# `dbus-x11` と DBUS_SESSION_BUS_ADDRESS=autolaunch にしない理由:
# `dbus-x11` の `dbus-launch --autolaunch` は $DISPLAY を要求する
# （daemon どうしの調整に X11 の atom を使う）ので、無いと起動を断る。
# このような完全に headless のコンテナでは実際に動かないので、`dbus-x11` は意図して入れない。
#
# 範囲: 黙るのは session bus のエラーだけ。
# system bus の probe（UPower・NetworkManager・BlueZ）は失敗したまま。
# `dbus-daemon --system` を意図して動かしていないから ——
# 動かすと常駐の root の daemon が要り、この image の「薄い CDP コンテナ」という方針に反する。
# 残る system bus の stderr のノイズは、承知のうえで、ログを集める層の filter に任せる。
#
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        dbus && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

#
# プロセスの管理のための supervisor
#
RUN apt-get update && \
    apt-get install -y --no-install-recommends supervisor && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

#
# Chrome DevTools Protocol の口を転送する socat
#
# socat が要る理由:
#   Chromium の --remote-debugging-address=0.0.0.0 は、security の理由で、
#   最近の版では無効になったか消された。Chromium の開発陣は、この flag について
#   "presents a security issue and should not be used" と述べ、
#   "no plans to implement it in the new headless mode." としている。
#
#   回避策として、socat が外からの接続（0.0.0.0:9222）を、
#   Chromium の localhost だけの debugging の口（127.0.0.1:9223）へ転送する。
#
# 参考:
#   - https://issues.chromium.org/issues/40261787
#   - https://issues.chromium.org/issues/40279369
#
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        socat && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Puppeteer の環境変数（開発のときだけ。自動化のスクリプトを走らせるため）
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

##############################
#  VNC の対応はここから      #
##############################
#
# desktop-lite
# installsAfter: common-utils
# https://github.com/uraitakahito/features/blob/0e14fce20c1008c837ac6b31b04297bd35108f9e/src/desktop-lite/devcontainer-feature.json#L58
#
RUN /usr/src/features/src/desktop-lite/install.sh
##############################
#  VNC の対応はここまで      #
##############################

RUN usermod -aG audio ${user_name} && \
    usermod -aG video ${user_name}

USER ${user_name}

#
# dotfiles
#
RUN cd /home/${user_name} && \
    git clone ${dotfiles_repository} && \
    cd dotfiles && \
    git checkout ${dotfiles_commit} && \
    ./install.sh

####################################
#  Puppeteer の対応はここから      #
####################################
#
# 警告: ここで 9222 の口を EXPOSE しない。
#
# VS Code の "Attach to Running Container" がこのコンテナに繋ぐと、EXPOSE された口を自動で見つけ、
# Mac の localhost からコンテナへの転送を張る。これが "Auto Forward Ports" の機能である。
#
# Mac の host でサーバ（CDP のサーバなど）が動き、
# コンテナが `--add-host=<hostname>:host-gateway` でそこへ繋ぐプロジェクトでは、
# ここで同じ口を EXPOSE すると衝突する。
#
# この口を EXPOSE すると、VS Code は Mac の localhost:<port> を、
# コンテナの localhost:<port> へ転送する。これが Mac の host のサーバ宛ての接続を横取りするので、
# WebSocket や HTTP の接続がいつまでも止まる。
#
# 症状:
#   - TCP の接続は成功する（handshake は終わる）
#   - しかしデータが届かず、接続はやがて timeout する
#   - VS Code が attach する前は動き、attach した後に失敗する
#
# VS Code の自動の転送を切るには、settings.json に次を足してもよい:
#   "remote.autoForwardPorts": false
# または、特定の口だけを無視する:
#   "remote.portsAttributes": { "3000": { "onAutoForward": "ignore" } }
#
# EXPOSE 9222
#
####################################
#  Puppeteer の対応はここまで      #
####################################

##############################
#  VNC の対応はここから      #
##############################
#
# desktop-lite
# https://github.com/uraitakahito/features/blob/0e14fce20c1008c837ac6b31b04297bd35108f9e/src/desktop-lite/install.sh#L296-L417
#
ENV USERNAME=${user_name}
ENV VNC_PORT=5901
ENV NOVNC_PORT=6080
WORKDIR /app

# supervisor の設定と起動スクリプトを写す。
# 注: --chmod=644 が要る理由:
#   - コンテナは 'developer' user（非 root）で動く
#   - chmod を明示しないと、COPY は元のファイルの権限を保つ
#   - 元のファイルの権限が 600 だと、supervisord が読めない
#
# 警告: bind mount を使うと、/app に写したファイルは上書きされる:
#   --mount type=bind,src=`pwd`,dst=/app
# そのときは、写したファイルではなく host のファイルが使われる。
# パスはリポジトリの root（build context）からの相対。
# supervisord-headful.conf・start-supervised.sh・chromium-headful.conf は、
# どれもこのディレクトリに在る（自己完結した凍結ユニット ——
# chromium-headful.conf は、2026-07-11 に debug target を attic/debug/ へ凍結したときに、
# ここへ写した）。
# start-chromium.sh はいまも live で、root に在る（production が使う）。
COPY --chmod=644 attic/development/supervisord-headful.conf /etc/supervisor/conf.d/app.conf
COPY --chmod=755 start-chromium.sh /app/start-chromium.sh
COPY --chmod=644 attic/development/chromium-headful.conf /app/chromium-headful.conf
COPY --chmod=755 attic/development/start-supervised.sh /usr/local/bin/start-supervised.sh

# CDP が使えるかの health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:9222/json/version || exit 1

ENTRYPOINT ["/usr/local/share/desktop-init.sh"]
CMD ["/usr/local/bin/start-supervised.sh"]
##############################
#  VNC の対応はここまで      #
##############################
