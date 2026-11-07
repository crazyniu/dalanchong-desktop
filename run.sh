#!/bin/sh
# AI file map
# Purpose: launch the local Tauri development app using the established project data root.
# Entry: invoke manually from the repository; the script changes to its own directory.
# Flow: set tool PATH, preserve or default ASSISTANT_TEST_DATA, install locked dependencies,
# and exec pnpm desktop. The override chooses stored account data, not hardware identity.
# Side effects: installs dependencies and starts an app using real data unless an isolated
# path was explicitly supplied. Do not execute as an automatic annotation check.

set -eu

assistant_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$assistant_dir"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Preserve the established data root; Tauri sessions remain separate and legacy files are not deleted.
export ASSISTANT_TEST_DATA="${ASSISTANT_TEST_DATA:-$assistant_dir/../.local/ecommerce-assistant}"

printf '\n检查依赖…\n'
pnpm install --frozen-lockfile

printf '\n启动大懒虫（Tauri 2）…\n'
exec pnpm desktop
