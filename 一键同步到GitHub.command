#!/bin/bash
# AI 阅读工作台 · 一键同步到 GitHub
# 用法：双击运行，或在终端执行 ./一键同步到GitHub.command

set -u
cd "$(dirname "$0")" || { echo "❌ 无法进入脚本所在文件夹"; exit 1; }

REPO_URL="https://github.com/1781257620-star/studious-bassoon"

echo "======================================"
echo "  AI 阅读工作台 · 一键同步到 GitHub"
echo "======================================"
echo ""

if [ ! -d .git ]; then
  echo "❌ 这个文件夹不是 Git 仓库，已退出。"
  read -n 1 -s -r -p "按任意键关闭..."
  exit 1
fi

echo "【第 1 步】检查并保存本地改动"
git add -A
if git diff --cached --quiet; then
  echo "   没有新改动，跳过保存。"
else
  COMMIT_MSG="同步：$(date '+%Y-%m-%d %H:%M')"
  if git commit -m "$COMMIT_MSG" >/dev/null; then
    echo "   ✅ 已保存：$COMMIT_MSG"
  else
    echo "   ❌ 保存失败，请把上面的提示发给 AI 排查。"
    read -n 1 -s -r -p "按任意键关闭..."
    exit 1
  fi
fi

echo ""
echo "【第 2 步】检查 GitHub 上有没有你本地没有的内容"
if ! git fetch origin >/dev/null 2>&1; then
  echo "   ❌ 连不上 GitHub（可能是网络问题，或访问令牌失效）。"
  echo "   请把这条提示发给 AI 处理。"
  read -n 1 -s -r -p "按任意键关闭..."
  exit 1
fi

REMOTE_ONLY=$(git rev-list --count main..origin/main 2>/dev/null || echo 0)
if [ "$REMOTE_ONLY" -gt 0 ]; then
  echo "   GitHub 上有 $REMOTE_ONLY 个新提交，先拉下来对齐..."
  if ! git pull --rebase origin main >/tmp/ai-reader-sync.log 2>&1; then
    echo "   ❌ 对齐过程中出现冲突，已停止。"
    echo "   这不是坏消息：内容都还在，只需要人工合并一次。"
    echo "   请把下面的信息发给 AI："
    tail -12 /tmp/ai-reader-sync.log
    read -n 1 -s -r -p "按任意键关闭..."
    exit 1
  fi
  echo "   ✅ 已与 GitHub 对齐"
else
  echo "   ✅ 本地已是最新起点，无需拉取"
fi

echo ""
echo "【第 3 步】上传到 GitHub"
if git push origin main --tags; then
  echo ""
  echo "✅ 同步完成！"
  echo "   在线查看：$REPO_URL"
else
  echo ""
  echo "❌ 上传失败，请把上面的报错发给 AI。"
fi

echo ""
read -n 1 -s -r -p "按任意键关闭窗口..."
echo ""
