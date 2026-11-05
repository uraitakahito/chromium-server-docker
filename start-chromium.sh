#!/bin/bash
#
# Chromium の共通の起動スクリプト —— $CHROMIUM_CONFIG から flag を読み、
# dbus-run-session で包んで Chromium を起動する。
#
# 環境変数:
#   CHROMIUM_CONFIG: 設定ファイルのパス（必須）
#
# CDP を localhost だけにして socat を挟む理由と、autolaunch でなく dbus-run-session を使う理由:
#   https://uraitakahito.github.io/chromium-server-docker/configuration/cdp/
#   https://uraitakahito.github.io/chromium-server-docker/internals/driving-model/

set -e

if [[ -z "${CHROMIUM_CONFIG}" ]]; then
    echo "Error: CHROMIUM_CONFIG environment variable is not set" >&2
    exit 1
fi

CONFIG_FILE="${CHROMIUM_CONFIG}"

if [[ ! -f "${CONFIG_FILE}" ]]; then
    echo "Error: Configuration file not found: ${CONFIG_FILE}" >&2
    exit 1
fi

# 設定ファイルからオプションを読む（コメントと空行は除く）
CHROMIUM_ARGS=$(grep -v '^[[:space:]]*#' "${CONFIG_FILE}" | grep -v '^[[:space:]]*$' | tr '\n' ' ')

echo "Starting Chromium with config: ${CONFIG_FILE}"
echo "Arguments: ${CHROMIUM_ARGS}"

# 起動の前にプロセスごとの新しい session bus が在るように、Chromium を dbus-run-session で包む
# （session bus の probe を黙らせる）。internals/driving-model を参照。
#
# 単語の分割は意図したもの: chromium が要素ごとに flag を 1 つ読めるように、
# 空白で区切ったトークンをそれぞれ別の argv の要素にする。
# shellcheck disable=SC2086
exec dbus-run-session chromium ${CHROMIUM_ARGS}
