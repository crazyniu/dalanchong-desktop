#!/bin/sh
set -eu

assistant_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$assistant_dir"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# 沿用当前开发版的账号、Cookie 和采集记录。
export ASSISTANT_TEST_DATA="${ASSISTANT_TEST_DATA:-$assistant_dir/../.local/ecommerce-assistant}"
unset VITE_DEV_SERVER_URL

printf '\n检查依赖…\n'
pnpm install --frozen-lockfile

printf '\n构建最新界面…\n'
pnpm build

printf '\n启动电商助手…\n'
exec pnpm desktop
