#!/bin/bash
#
# Chromium unified startup script — reads flags from $CHROMIUM_CONFIG and starts
# Chromium wrapped in dbus-run-session.
#
# Environment variables:
#   CHROMIUM_CONFIG: Path to the config file (required)
#
# Why CDP is localhost-only + socat, and why dbus-run-session (not autolaunch):
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

# Read options from config file (exclude comments and empty lines)
CHROMIUM_ARGS=$(grep -v '^[[:space:]]*#' "${CONFIG_FILE}" | grep -v '^[[:space:]]*$' | tr '\n' ' ')

echo "Starting Chromium with config: ${CONFIG_FILE}"
echo "Arguments: ${CHROMIUM_ARGS}"

# Wrap Chromium in dbus-run-session so a fresh per-process session bus exists
# before startup (silences session-bus probes). See internals/driving-model.
#
# Word splitting is intentional: each whitespace-separated token must become
# its own argv entry so chromium parses one flag per element.
# shellcheck disable=SC2086
exec dbus-run-session chromium ${CHROMIUM_ARGS}
