# FoxAI 品牌定制说明

## 🎨 已完成的优化

### 1. 品牌标识更新
- ✅ 侧边栏 Logo 更新为 FoxAI 渐变设计
- ✅ 主页添加 Hero Section 展示 FoxAI 品牌
- ✅ 创建自定义 SVG Logo (`/public/foxai-logo.svg`)
- ✅ 更新默认站点名称为 "FoxAI"

### 2. 视觉优化
- ✅ 使用紫色-蓝色-青色渐变配色方案
- ✅ 所有模块标题添加渐变色效果
- ✅ 优化按钮样式，添加悬停动画
- ✅ Hero Section 添加背景渐变和动画效果

### 3. 用户体验提升
- ✅ 主页功能按钮集中展示（直链播放、源站寻片、AI问片）
- ✅ 优化移动端响应式布局
- ✅ 添加平滑过渡动画效果

## 🎯 配色方案

```css
主色调：
- 紫色: #9333ea (purple-600)
- 蓝色: #3b82f6 (blue-600)
- 青色: #06b6d4 (cyan-600)

渐变组合：
- 热门电影: purple-600 → blue-600
- 热播短剧: blue-600 → cyan-600
- 新番放送: cyan-600 → purple-600
- 热门剧集: purple-600 → pink-600
- 热门综艺: pink-600 → orange-600
- 即将上映: orange-600 → red-600
```

## 📝 环境变量配置

在 `.env` 或 Docker Compose 中设置：

```bash
NEXT_PUBLIC_SITE_NAME=FoxAI
ANNOUNCEMENT=欢迎使用 FoxAI 影视聚合平台！本站提供智能影视搜索服务，所有内容均来自第三方网站。
```

## 🚀 部署说明

1. 构建项目：
```bash
pnpm install
pnpm build
```

2. 启动服务：
```bash
pnpm start
```

3. Docker 部署：
```bash
docker-compose up -d
```

## 🎨 进一步定制建议

### 替换 Logo 图标
将你的 Logo 文件放置在：
- `/public/logo.png` - 主 Logo
- `/public/icons/icon-*.png` - PWA 图标（多尺寸）
- `/public/favicon.ico` - 浏览器图标

### 自定义主题色
编辑 `/src/styles/themes.ts` 文件，修改主题配色。

### 修改 Hero Section
编辑 `/src/app/page.tsx` 中的 Hero Section 部分，自定义标语和布局。

## 📱 移动端优化

- Hero Section 在移动端自动调整字体大小
- 按钮在小屏幕上自动换行
- Logo 在移动端缩小显示

## 🔧 技术栈

- Next.js 14 (App Router)
- TailwindCSS 3
- TypeScript
- Framer Motion (动画)

## 📄 许可证

基于 MoonTVPlus 项目进行定制，遵循 MIT 许可证。
