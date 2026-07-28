#!/usr/bin/env sh

set -eu

APP_VERSION="$(node -p "require('./package.json').version")"
BUILD_COMMIT="$(git rev-parse --short=7 HEAD 2>/dev/null || printf '%s' unknown)"
BUILD_TIME="$(node -p "new Date().toISOString()")"

export APP_VERSION
export BUILD_COMMIT
export BUILD_TIME

docker compose up -d --build "$@"
