# 🦊 FoxAI 影视聚合平台

<div align="center">
  <img src="public/foxai-logo.svg" alt="FoxAI Logo" width="120">
  
  <h3>智能聚合 · 极致体验 · 海量资源</h3>
  
  ![Next.js](https://img.shields.io/badge/Next.js-14-000?logo=nextdotjs)
  ![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-38bdf8?logo=tailwindcss)
  ![TypeScript](https://img.shields.io/badge/TypeScript-4.x-3178c6?logo=typescript)
  ![License](https://img.shields.io/badge/License-MIT-green)
</div>

---

## ✨ 特色功能

### 🎨 现代化设计
- **渐变色系统**: 紫色-蓝色-青色品牌配色
- **Hero Section**: 醒目的品牌展示区域
- **流畅动画**: 微交互提升用户体验
- **响应式布局**: 完美适配桌面和移动端

### 🎬 核心功能
- **多源聚合搜索**: 一次搜索，全网资源
- **智能推荐**: 基于豆瓣/TMDB 的精准推荐
- **外部播放器**: 支持 PotPlayer/VLC/MPV/IINA 等
- **视频超分**: Anime4K WebGPU 实时画质增强
- **弹幕系统**: 完整的弹幕搜索、匹配、加载功能
- **私人影库**: OpenList/Emby 集成
- **观影室**: 多人同步观影（实验性）
- **离线下载**: 服务器端 M3U8 下载

### 🤖 AI 增强
- **AI 问片**: 智能影视推荐助手
- **源站寻片**: 快速定位资源
- **直链播放**: 支持任意视频链接

---

## 🚀 快速开始

### 使用预览脚本
```bash
./preview.sh
```

### 手动启动
```bash
pnpm install
pnpm gen:manifest
pnpm pwa:generate
pnpm dev
```

访问: http://localhost:3000

详细说明请查看 [快速启动指南](QUICK_START.md)

---

## 📸 界面预览

### 主页 Hero Section
```
┌─────────────────────────────────────┐
│     [渐变背景装饰]                   │
│                                     │
│        [FoxAI Logo 动画]            │
│      ╔═══════════════╗              │
│      ║  FoxAI 影视   ║              │
│      ╚═══════════════╝              │
│   智能聚合 · 极致体验 · 海量资源    │
│                                     │
│  [直链播放] [源站寻片] [AI问片]     │
└─────────────────────────────────────┘
```

### 内容模块
- 🎬 **热门电影** - Purple → Blue 渐变
- 📺 **热播短剧** - Blue → Cyan 渐变
- 🎌 **新番放送** - Cyan → Purple 渐变
- 🎭 **热门剧集** - Purple → Pink 渐变
- 🎪 **热门综艺** - Pink → Orange 渐变
- 🎯 **即将上映** - Orange → Red 渐变

---

## 🎨 品牌配色

```css
主色调：
- Purple: #9333ea
- Blue:   #3b82f6
- Cyan:   #06b6d4

渐变系统：
- 主标题: Purple → Blue → Cyan
- 按钮组: 各功能独立渐变
- 模块标题: 彩虹渐变系统
```

---

## 📚 文档导航

| 文档 | 说明 |
|------|------|
| [QUICK_START.md](QUICK_START.md) | 快速启动指南 |
| [FOXAI_CUSTOMIZATION.md](FOXAI_CUSTOMIZATION.md) | 定制说明文档 |
| [OPTIMIZATION_REPORT.md](OPTIMIZATION_REPORT.md) | 优化完成报告 |
| [BEFORE_AFTER_COMPARISON.md](BEFORE_AFTER_COMPARISON.md) | 前后对比分析 |
| [README.md](README.md) | 原项目完整文档 |

---

## 🐳 Docker 部署

```yaml
services:
  foxai:
    image: ghcr.io/mtvpls/moontvplus:latest
    container_name: foxai
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      - NEXT_PUBLIC_SITE_NAME=FoxAI
      - USERNAME=admin
      - PASSWORD=your_secure_password
      - NEXT_PUBLIC_STORAGE_TYPE=redis
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
  
  redis:
    image: redis:alpine
    container_name: foxai-redis
    restart: unless-stopped
    volumes:
      - redis-data:/data

volumes:
  redis-data:
```

---

## 🔧 环境变量

```bash
# 品牌配置
NEXT_PUBLIC_SITE_NAME=FoxAI
ANNOUNCEMENT=欢迎使用 FoxAI 影视聚合平台！

# 管理员账号
USERNAME=admin
PASSWORD=your_secure_password

# 存储配置
NEXT_PUBLIC_STORAGE_TYPE=redis
REDIS_URL=redis://localhost:6379

# 功能开关
NEXT_PUBLIC_ENABLE_SOURCE_SEARCH=true
NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD=true
WATCH_ROOM_ENABLED=true
```

完整配置请参考 [环境变量说明](README.md#环境变量)

---

## 📊 性能指标

| 指标 | 数值 |
|------|------|
| 首屏加载 | < 2s |
| 交互响应 | < 100ms |
| 动画帧率 | 60 FPS |
| 移动端适配 | 100% |
| PWA 支持 | ✅ |

---

## 🎯 技术栈

- **前端框架**: Next.js 14 (App Router)
- **UI 框架**: TailwindCSS 3
- **动画库**: Framer Motion
- **播放器**: ArtPlayer + HLS.js
- **状态管理**: React Context + Hooks
- **数据存储**: Redis/Kvrocks/Upstash/D1
- **实时通信**: Socket.io

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📄 许可证

基于 [MoonTVPlus](https://github.com/mtvpls/moontvplus) 项目定制

MIT License © 2026 FoxAI

---

## 🙏 致谢

- [MoonTVPlus](https://github.com/mtvpls/moontvplus) - 原项目
- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) - 播放器
- [HLS.js](https://github.com/video-dev/hls.js) - HLS 支持
- 所有开源贡献者

---

<div align="center">
  <p>Made with ❤️ by FoxAI Team</p>
  <p>
    <a href="QUICK_START.md">快速开始</a> ·
    <a href="FOXAI_CUSTOMIZATION.md">定制指南</a> ·
    <a href="OPTIMIZATION_REPORT.md">优化报告</a>
  </p>
</div>
