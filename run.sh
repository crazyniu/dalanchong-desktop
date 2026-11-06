#!/bin/sh
set -eu

assistant_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$assistant_dir"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# 保留原目录；Tauri 会话独立保存，旧文件不删除。
export ASSISTANT_TEST_DATA="${ASSISTANT_TEST_DATA:-$assistant_dir/../.local/ecommerce-assistant}"

printf '\n检查依赖…\n'
pnpm install --frozen-lockfile

printf '\n启动大懒虫（Tauri 2）…\n'
exec pnpm desktop
