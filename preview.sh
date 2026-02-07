#!/bin/bash

echo "🦊 FoxAI 影视平台 - 启动预览"
echo "================================"
echo ""
echo "📦 安装依赖..."
pnpm install

echo ""
echo "🎨 生成 manifest..."
pnpm gen:manifest

echo ""
echo "🚀 启动开发服务器..."
echo ""
echo "✨ 访问地址: http://localhost:3000"
echo "================================"
pnpm dev
