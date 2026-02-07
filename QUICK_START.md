# 🚀 FoxAI 快速启动指南

## 📋 前置要求

- Node.js 18+ 
- pnpm (推荐) 或 npm
- 数据库: Redis/Kvrocks/Upstash/D1

## ⚡ 快速启动

### 方式一：使用预览脚本（推荐）

```bash
./preview.sh
```

### 方式二：手动启动

```bash
# 1. 安装依赖
pnpm install

# 2. 生成 manifest
pnpm gen:manifest

# 3. 生成 PWA 资源（Service Worker + Web Manifest）
pnpm pwa:generate

# 4. 启动开发服务器
pnpm dev
```

访问: http://localhost:3000

## 🔧 环境配置

创建 `.env.local` 文件：

```bash
# 站点配置
NEXT_PUBLIC_SITE_NAME=FoxAI
ANNOUNCEMENT=欢迎使用 FoxAI 影视聚合平台！

# 管理员账号
USERNAME=admin
PASSWORD=your_secure_password

# 存储配置（选择一种）
NEXT_PUBLIC_STORAGE_TYPE=redis
REDIS_URL=redis://localhost:6379

# 或使用 Upstash
# NEXT_PUBLIC_STORAGE_TYPE=upstash
# UPSTASH_URL=https://xxx.upstash.io
# UPSTASH_TOKEN=your_token
```

## 🐳 Docker 部署

### 使用 Docker Compose

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
      - PASSWORD=admin_password
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

启动：
```bash
docker-compose up -d
```

## 📱 功能配置

### 1. 配置视频源

登录管理后台: http://localhost:3000/admin

在"配置文件"中添加视频源：

```json
{
  "cache_time": 7200,
  "api_site": {
    "example": {
      "api": "http://example.com/api.php/provide/vod",
      "name": "示例资源",
      "detail": "http://example.com"
    }
  }
}
```

### 2. 启用功能

在环境变量中配置：

```bash
# AI 功能
AI_ENABLED=true

# 观影室
WATCH_ROOM_ENABLED=true

# 离线下载
NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD=true

# 源站寻片
NEXT_PUBLIC_ENABLE_SOURCE_SEARCH=true
```

## 🎨 自定义品牌

### 替换 Logo

1. 准备你的 Logo 图片
2. 替换以下文件：
   - `/public/logo.png` (主 Logo)
   - `/public/icons/icon-192x192.png`
   - `/public/icons/icon-256x256.png`
   - `/public/icons/icon-384x384.png`
   - `/public/icons/icon-512x512.png`

### 修改配色

编辑 `/src/app/page.tsx`，修改渐变色类名：

```tsx
// 主标题
from-purple-600 via-blue-600 to-cyan-600

// 按钮
from-purple-500 to-blue-500
```

### 修改标语

在 Hero Section 中修改：

```tsx
<p className='text-lg sm:text-xl text-gray-600 dark:text-gray-400 mb-6'>
  你的自定义标语
</p>
```

## 📊 性能优化

### 生产构建

```bash
pnpm build
pnpm start
```

### 启用缓存

在配置文件中设置：

```json
{
  "cache_time": 7200
}
```

### CDN 配置

使用 Cloudflare 或其他 CDN 加速静态资源。

## 🔒 安全配置

### 1. 修改默认密码

首次登录后立即修改管理员密码。

### 2. 关闭公开注册

```bash
ENABLE_REGISTRATION=false
```

### 3. 启用 HTTPS

使用 Nginx 反向代理：

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 📚 常见问题

### Q: 如何添加视频源？
A: 登录管理后台 → 配置文件 → 添加 api_site 配置

### Q: 如何启用弹幕功能？
A: 需要部署弹幕后端服务，参考 README.md

### Q: 如何备份数据？
A: 备份 Redis/数据库数据即可

### Q: 如何更新版本？
A: 
```bash
docker-compose pull
docker-compose up -d
```

## 🆘 获取帮助

- 查看完整文档: `README.md`
- 优化说明: `FOXAI_CUSTOMIZATION.md`
- 对比报告: `BEFORE_AFTER_COMPARISON.md`
- 技术报告: `OPTIMIZATION_REPORT.md`

## 📄 许可证

基于 MoonTVPlus 项目，遵循 MIT 许可证。

---

**祝你使用愉快！** 🎉
