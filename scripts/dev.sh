#!/usr/bin/env bash
set -e

# AI 阅读工作台 · 本地开发启动
# 纯前端 PWA 应用：启动 Vite dev server（端口 8080）
# 停止：Ctrl+C

cd "$(dirname "$0")/.."
NODE_ENV=development vite --config vite.config.ts
