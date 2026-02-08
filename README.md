# MoonTVPlus

<div align="center">
  <img src="public/logo.png" alt="MoonTVPlus Logo" width="120">
</div>

## ⚠️ 请某些人停止你的抄袭行为，不要我上什么功能你就抄什么，借鉴≠抄袭

> 🎬 **MoonTVPlus** 是基于 [MoonTV v100](https://github.com/MoonTechLab/LunaTV) 二次开发的增强版影视聚合播放器。它在原版基础上新增了外部播放器支持、视频超分、弹幕系统、评论抓取等实用功能，提供更强大的观影体验。

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-14-000?logo=nextdotjs)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-38bdf8?logo=tailwindcss)
![TypeScript](https://img.shields.io/badge/TypeScript-4.x-3178c6?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)
![Docker Ready](https://img.shields.io/badge/Docker-ready-blue?logo=docker)

</div>


---

## 🎉 相对原版新增内容

- 🎮 **外部播放器跳转**：支持 PotPlayer、VLC、MPV、MX Player、nPlayer、IINA 等多种外部播放器
- ✨ **视频超分 (Anime4K)**：使用 WebGPU 技术实现实时视频画质增强（支持 1.5x/2x/3x/4x 超分）
- 💬 **弹幕系统**：完整的弹幕搜索、匹配、加载功能，支持弹幕设置持久化、弹幕屏蔽
- 📝 **豆瓣评论抓取**：自动抓取并展示豆瓣电影短评，支持分页加载
- 🪒**自定义去广告**：你可以自定义你的去广告代码，实现更强力的去广告功能
- 🎭 **观影室**：支持多人同步观影、实时聊天、语音通话等功能（实验性）。
- 📥 **M3U8完整下载**：通过合并m3u8片段实现完整视频下载。
- 💾 **服务器离线下载**：支持在服务器端下载视频文件，支持断点续传，提前下载到家秒加载 。
- 📚 **私人影库**：接入 OpenList或Emby，可打造专属私人影库，亦可观看网盘资源。

## ✨ 功能特性

- 🔍 **多源聚合搜索**：一次搜索立刻返回全源结果。
- 📄 **丰富详情页**：支持剧集列表、演员、年份、简介等完整信息展示。
- ▶️ **流畅在线播放**：集成 HLS.js & ArtPlayer。
- ❤️ **收藏 + 继续观看**：支持 Kvrocks/Redis/Upstash 存储，多端同步进度。
- 📱 **PWA**：离线缓存、安装到桌面/主屏，移动端原生体验。
- 🌗 **响应式布局**：桌面侧边栏 + 移动底部导航，自适应各种屏幕尺寸。
- 👿 **智能去广告**：自动跳过视频中的切片广告，更可以自定义你的去广告代码以增强去广告功能。

### 注意：部署后项目为空壳项目，无内置播放源和直播源，需要自行收集

<details>
  <summary>点击查看项目截图</summary>
  <img src="public/screenshot1.png" alt="项目截图" style="max-width:600px">
  <img src="public/screenshot2.png" alt="项目截图" style="max-width:600px">
  <img src="public/screenshot3.png" alt="项目截图" style="max-width:600px">
</details>


### 请不要在 B站、小红书、微信公众号、抖音、今日头条或其他中国大陆社交平台发布视频或文章宣传本项目，不授权任何“科技周刊/月刊”类项目或站点收录本项目。

## 🗺 目录

- [技术栈](#技术栈)
- [部署](#部署)
- [配置文件](#配置文件)
- [自动更新](#自动更新)
- [环境变量](#环境变量)
- [外部观影室服务器部署](#外部观影室服务器部署)
- [弹幕后端部署](#弹幕后端部署)
- [超分功能说明](#超分功能说明)
- [AndroidTV 使用](#androidtv-使用)
- [TVBOX 订阅功能](#tvbox-订阅功能)
- [安全与隐私提醒](#安全与隐私提醒)
- [License](#license)
- [致谢](#致谢)



## 技术栈

| 分类      | 主要依赖                                                     |
| --------- | ------------------------------------------------------------ |
| 前端框架  | [Next.js 14](https://nextjs.org/) · App Router               |
| UI & 样式 | [Tailwind&nbsp;CSS 3](https://tailwindcss.com/)              |
| 语言      | TypeScript 4                                                 |
| 播放器    | [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) · [HLS.js](https://github.com/video-dev/hls.js/) |
| 代码质量  | ESLint · Prettier · Jest                                     |
| 部署      | Docker                                                       |

## 部署

本项目**支持 Docker、Vercel 和 Cloudflare Workers 平台** 部署。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/mtvpls/MoonTVPlus)

**一键部署到zeabur**

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/SCHCAY/deploy)



### Cloudflare Workers 部署（通过 GitHub Actions）

Cloudflare Workers 提供免费的边缘计算服务，通过 GitHub Actions 可以实现自动化部署。

#### 前置要求

1. 一个 Cloudflare 账号
2. Fork 本项目到你的 GitHub 账号
3. 准备一个 Upstash Redis 实例（推荐）

#### 配置步骤

**1. 获取 Cloudflare API Token 和 Account ID**

- 访问 [Cloudflare Dashboard](https://dash.cloudflare.com/)
- 点击右上角头像 > My Profile > API Tokens
- 点击 "Create Token"，选择 "Edit Cloudflare Workers" 模板
- 或使用自定义 Token，需要以下权限：
  - Account - Cloudflare Workers Scripts - Edit
  - Account - Cloudflare Workers KV Storage - Edit
- 创建后复制生成的 API Token
- 在 Dashboard 首页右侧可以看到你的 Account ID

**2. 配置 GitHub Secrets**

进入你 Fork 的仓库，点击 Settings > Secrets and variables > Actions > New repository secret，添加以下必需的 Secrets：

**必需配置：**

| Secret 名称                | 说明                  | 示例值                   |
| -------------------------- | --------------------- | ------------------------ |
| `CLOUDFLARE_API_TOKEN`     | Cloudflare API Token  | `your_api_token_here`    |
| `CLOUDFLARE_ACCOUNT_ID`    | Cloudflare Account ID | `abc123def456`           |
| `USERNAME`                 | 站长账号              | `admin`                  |
| `PASSWORD`                 | 站长密码              | `your_secure_password`   |
| `NEXT_PUBLIC_STORAGE_TYPE` | 存储类型              | `upstash`                |
| `UPSTASH_URL`              | Upstash Redis URL     | `https://xxx.upstash.io` |
| `UPSTASH_TOKEN`            | Upstash Redis Token   | `your_upstash_token`     |
| `PROJECT_NAME`            | 自定义项目名称（用于 wrangler.toml） | `moontv-plus`          |
| `D1_DATABASE_NAME`        | 自定义 D1 数据库名称（用于 wrangler.toml） | `moontvplus`           |

**3. 触发部署**

配置完成后，有两种方式触发部署：

**方式一：手动触发**

- 进入仓库的 Actions 页面
- 选择 "Deploy to Cloudflare" workflow
- 点击 "Run workflow" 按钮
- 选择分支（通常是 main 或 dev）
- 点击 "Run workflow" 开始部署

**方式二：自动触发（可选）**

如果想要在推送代码时自动部署，可以修改 `.github/workflows/cloudflare-deploy.yml` 文件：

```yaml
on:
  push:
    branches:
      - main  # 或你的主分支名称
  workflow_dispatch:
```

**4. 查看部署状态**

- 在 Actions 页面可以看到部署进度
- 部署成功后，访问 `https://your-project-name.your-account.workers.dev`
- 也可以在 Cloudflare Dashboard 的 Workers & Pages 中查看部署的应用

**5. 绑定自定义域名（可选）**

- 在 Cloudflare Dashboard 中进入你的 Worker
- 点击 Settings > Triggers > Custom Domains
- 添加你的自定义域名

**6. 使用 D1 数据库（可选）**

如果想使用 Cloudflare D1 数据库代替 Upstash Redis，需要进行以下配置：

1. 在 Cloudflare Dashboard 中创建一个 D1 数据库
2. 复制数据库 ID
3. 在 GitHub Secrets 中配置：
   - 将 `NEXT_PUBLIC_STORAGE_TYPE` 设置为 `d1`
   - 添加 `D1_DATABASE_ID` 并填入你的数据库 ID
   - 无需配置 `UPSTASH_URL` 和 `UPSTASH_TOKEN`

**7. 配置外部定时任务（可选）**

可使用外部定时请求/api/cron/mtvpls端点以触发定时任务，或新建一个workers请求触发，推荐每小时请求一次。

---

### Docker 部署

#### Kvrocks 存储（推荐）

```yml
services:
  moontv-core:
    image: ghcr.io/mtvpls/moontvplus:latest
    container_name: moontv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=kvrocks
      - KVROCKS_URL=redis://moontv-kvrocks:6666
    networks:
      - moontv-network
    depends_on:
      - moontv-kvrocks
  moontv-kvrocks:
    image: apache/kvrocks
    container_name: moontv-kvrocks
    restart: unless-stopped
    volumes:
      - kvrocks-data:/var/lib/kvrocks
    networks:
      - moontv-network
networks:
  moontv-network:
    driver: bridge
volumes:
  kvrocks-data:
```

### Redis 存储（有一定的丢数据风险）

```yml
services:
  moontv-core:
    image: ghcr.io/mtvpls/moontvplus:latest
    container_name: moontv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=redis
      - REDIS_URL=redis://moontv-redis:6379
    networks:
      - moontv-network
    depends_on:
      - moontv-redis
  moontv-redis:
    image: redis:alpine
    container_name: moontv-redis
    restart: unless-stopped
    networks:
      - moontv-network
    # 请开启持久化，否则升级/重启后数据丢失
    volumes:
      - ./data:/data
networks:
  moontv-network:
    driver: bridge
```

### Upstash 存储

1. 在 [upstash](https://upstash.com/) 注册账号并新建一个 Redis 实例，名称任意。
2. 复制新数据库的 **HTTPS ENDPOINT 和 TOKEN**
3. 使用如下 docker compose

```yml
services:
  moontv-core:
    image: ghcr.io/mtvpls/moontvplus:latest
    container_name: moontv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=upstash
      - UPSTASH_URL=上面 https 开头的 HTTPS ENDPOINT
      - UPSTASH_TOKEN=上面的 TOKEN
```

## 配置文件

完成部署后为空壳应用，无播放源，需要站长在管理后台的配置文件设置中填写配置文件，本版本已不支持无数据库运行。

配置文件示例如下：

```json
{
  "cache_time": 7200,
  "api_site": {
    "dyttzy": {
      "api": "http://xxx.com/api.php/provide/vod",
      "name": "示例资源",
      "detail": "http://xxx.com"
    }
    // ...更多站点
  },
  "custom_category": [
    {
      "name": "华语",
      "type": "movie",
      "query": "华语"
    }
  ]
}
```

- `cache_time`：接口缓存时间（秒）。
- `api_site`：你可以增删或替换任何资源站，字段说明：
  - `key`：唯一标识，保持小写字母/数字。
  - `api`：资源站提供的 `vod` JSON API 根地址。
  - `name`：在人机界面中展示的名称。
  - `detail`：（可选）部分无法通过 API 获取剧集详情的站点，需要提供网页详情根 URL，用于爬取。
- `custom_category`：自定义分类配置，用于在导航中添加个性化的影视分类。以 type + query 作为唯一标识。支持以下字段：
  - `name`：分类显示名称（可选，如不提供则使用 query 作为显示名）
  - `type`：分类类型，支持 `movie`（电影）或 `tv`（电视剧）
  - `query`：搜索关键词，用于在豆瓣 API 中搜索相关内容

custom_category 支持的自定义分类已知如下：

- movie：热门、最新、经典、豆瓣高分、冷门佳片、华语、欧美、韩国、日本、动作、喜剧、爱情、科幻、悬疑、恐怖、治愈
- tv：热门、美剧、英剧、韩剧、日剧、国产剧、港剧、日本动画、综艺、纪录片

也可输入如 "哈利波特" 效果等同于豆瓣搜索

MoonTV 支持标准的苹果 CMS V10 API 格式。

## 自动更新

可借助 [watchtower](https://github.com/containrrr/watchtower) 自动更新镜像容器

dockge/komodo 等 docker compose UI 也有自动更新功能

## 环境变量

| 变量                                     | 说明                                                         | 可选值                      | 默认值                                                       |
| ---------------------------------------- | ------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------ |
| USERNAME                                 | 站长账号                                                     | 任意字符串                  | 无默认，必填字段                                             |
| PASSWORD                                 | 站长密码                                                     | 任意字符串                  | 无默认，必填字段                                             |
| CRON_PASSWORD                            | 定时任务 API 访问密码（用于保护 /api/cron 端点）             | 任意字符串                  | mtvpls                                                       |
| SITE_BASE                                | 站点 url                                                     | 形如 https://example.com    | 空                                                           |
| NEXT_PUBLIC_SITE_NAME                    | 站点名称                                                     | 任意字符串                  | MoonTV                                                       |
| ANNOUNCEMENT                             | 站点公告                                                     | 任意字符串                  | 本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。 |
| NEXT_PUBLIC_STORAGE_TYPE                 | 播放记录/收藏的存储方式                                      | redis、kvrocks、upstash、d1 | 无默认，必填字段                                             |
| KVROCKS_URL                              | kvrocks 连接 url                                             | 连接 url                    | 空                                                           |
| REDIS_URL                                | redis 连接 url                                               | 连接 url                    | 空                                                           |
| UPSTASH_URL                              | upstash redis 连接 url                                       | 连接 url                    | 空                                                           |
| UPSTASH_TOKEN                            | upstash redis 连接 token                                     | 连接 token                  | 空                                                           |
| NEXT_PUBLIC_SEARCH_MAX_PAGE              | 搜索接口可拉取的最大页数                                     | 1-50                        | 5                                                            |
| NEXT_PUBLIC_DOUBAN_PROXY_TYPE            | 豆瓣数据源请求方式                                           | 见下方                      | direct                                                       |
| NEXT_PUBLIC_DOUBAN_PROXY                 | 自定义豆瓣数据代理 URL                                       | url prefix                  | (空)                                                         |
| NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE      | 豆瓣图片代理类型                                             | 见下方                      | direct                                                       |
| NEXT_PUBLIC_DOUBAN_IMAGE_PROXY           | 自定义豆瓣图片代理 URL                                       | url prefix                  | (空)                                                         |
| NEXT_PUBLIC_DISABLE_YELLOW_FILTER        | 关闭色情内容过滤                                             | true/false                  | false                                                        |
| NEXT_PUBLIC_FLUID_SEARCH                 | 是否开启搜索接口流式输出                                     | true/ false                 | true                                                         |
| NEXT_PUBLIC_PROXY_M3U8_TOKEN             | M3U8 代理 API 鉴权 Token（外部播放器跳转时的鉴权token，不填为无鉴权） | 任意字符串                  | (空)                                                         |
| NEXT_PUBLIC_DANMAKU_CACHE_EXPIRE_MINUTES | 弹幕缓存失效时间（分钟数，设为 0 时不缓存）                  | 0 或正整数                  | 4320（3天）                                                  |
| ENABLE_TVBOX_SUBSCRIBE                   | 是否启用 TVBOX 订阅功能                                      | true/false                  | false                                                        |
| TVBOX_SUBSCRIBE_TOKEN                    | TVBOX 订阅 API 访问 Token，如启用TVBOX功能必须设置该项       | 任意字符串                  | (空)                                                         |
| TVBOX_BLOCKED_SOURCES                    | TVBOX 订阅屏蔽源列表（多个源用逗号分隔，匹配视频源的 key）   | 逗号分隔的源 key            | (空)                                                         |
| WATCH_ROOM_ENABLED                       | 是否启用观影室功能（vercel部署不支持该功能，可使用外部服务器） | true/false                  | false                                                        |
| WATCH_ROOM_SERVER_TYPE                   | 观影室服务器类型                                             | internal/external           | internal                                                     |
| WATCH_ROOM_EXTERNAL_SERVER_URL           | 外部观影室服务器地址（当 SERVER_TYPE 为 external 时必填）    | WebSocket URL               | (空)                                                         |
| WATCH_ROOM_EXTERNAL_SERVER_AUTH          | 外部观影室服务器认证令牌（当 SERVER_TYPE 为 external 时必填） | 任意字符串                  | (空)                                                         |
| NEXT_PUBLIC_VOICE_CHAT_STRATEGY          | 观影室语音聊天策略                                           | webrtc-fallback/server-only | webrtc-fallback                                              |
| NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD      | 是否启用服务器离线下载功能（开启后也仅管理员和站长可用）     | true/false                  | false                                                        |
| OFFLINE_DOWNLOAD_DIR                     | 离线下载文件存储目录                                         | 任意有效路径                | /data                                                        |
| VIDEOINFO_CACHE_MINUTES                  | 私人影库视频信息在内存中的缓存时长（分钟）                   | 正整数                      | 1440（1天）                                                  |
| NEXT_PUBLIC_ENABLE_SOURCE_SEARCH         | 是否开启源站寻片功能                                         | true/false                  | true                                                         |
| MAX_PLAY_RECORDS_PER_USER                | 单个用户播放记录清理阈值（超过此数量将自动清理旧记录）       | 正整数                      | 100                                                          |
| INIT_CONFIG                              | 初始配置（JSON 格式，包含 api_site、custom_category、lives 等） | JSON 字符串                 | (空)                                                         |
| CONFIG_SUBSCRIPTION_URL                  | 配置订阅 URL（Base58 编码的配置文件地址，优先级高于 INIT_CONFIG） | URL                         | (空)                                                         |
| TMDB_API_KEY                             | TMDB API 密钥                                                | 任意字符串                  | (空)                                                         |
| TMDB_PROXY                               | TMDB 代理地址                                                | URL                         | (空)                                                         |
| TMDB_REVERSE_PROXY                       | TMDB 反向代理地址                                            | URL                         | (空)                                                         |
| DANMAKU_API_BASE                         | 弹幕 API 地址                                                | URL                         | http://localhost:9321                                        |
| DANMAKU_API_TOKEN                        | 弹幕 API Token                                               | 任意字符串                  | 87654321                                                     |

NEXT_PUBLIC_DOUBAN_PROXY_TYPE 选项解释：

- direct: 由服务器直接请求豆瓣源站
- cors-proxy-zwei: 浏览器向 cors proxy 请求豆瓣数据，该 cors proxy 由 [Zwei](https://github.com/bestzwei) 搭建
- cmliussss-cdn-tencent: 浏览器向豆瓣 CDN 请求数据，该 CDN 由 [CMLiussss](https://github.com/cmliu) 搭建，并由腾讯云 cdn 提供加速
- cmliussss-cdn-ali: 浏览器向豆瓣 CDN 请求数据，该 CDN 由 [CMLiussss](https://github.com/cmliu) 搭建，并由阿里云 cdn 提供加速
- custom: 用户自定义 proxy，由 NEXT_PUBLIC_DOUBAN_PROXY 定义

NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE 选项解释：

- direct：由浏览器直接请求豆瓣分配的默认图片域名
- server：由服务器代理请求豆瓣分配的默认图片域名
- img3：由浏览器请求豆瓣官方的精品 cdn（阿里云）
- cmliussss-cdn-tencent：由浏览器请求豆瓣 CDN，该 CDN 由 [CMLiussss](https://github.com/cmliu) 搭建，并由腾讯云 cdn 提供加速
- cmliussss-cdn-ali：由浏览器请求豆瓣 CDN，该 CDN 由 [CMLiussss](https://github.com/cmliu) 搭建，并由阿里云 cdn 提供加速
- custom: 用户自定义 proxy，由 NEXT_PUBLIC_DOUBAN_IMAGE_PROXY 定义

NEXT_PUBLIC_VOICE_CHAT_STRATEGY 选项解释：

- webrtc-fallback：使用 WebRTC P2P 连接，失败时自动回退到服务器中转（推荐）
- server-only：仅使用服务器中转（适用于无法建立 P2P 连接的网络环境）

### 外部观影室服务器部署

如果您在 Vercel 等无法运行 WebSocket 服务器的平台部署，或希望将观影室服务器独立部署，可以使用外部观影室服务器。

推荐使用由 [tgs9915](https://github.com/tgs9915) 开发的 [watch-room-server](https://github.com/tgs9915/watch-room-server) 项目进行部署。

**配置步骤：**

1. 按照 [watch-room-server](https://github.com/tgs9915/watch-room-server) 的文档部署外部服务器

2. 在 MoonTVPlus 中设置以下环境变量：

   ```env
   WATCH_ROOM_ENABLED=true
   WATCH_ROOM_SERVER_TYPE=external
   WATCH_ROOM_EXTERNAL_SERVER_URL=wss://your-watch-room-server.com
   WATCH_ROOM_EXTERNAL_SERVER_AUTH=your_secure_token
   ```

3. 重启应用即可使用外部观影室服务器



## 弹幕后端部署

要使用弹幕功能，需要额外部署弹幕 API 后端服务。

### 部署步骤

1. 按照[danmu_api](https://github.com/huangxd-/danmu_api.git)教程部署后端
2. 建议配置SOURCE_ORDER或PLATFORM_ORDER环境变量，默认弹幕源很少
3. 在管理面板设置后端地址




##  超分功能说明

超分功能需要浏览器支持webgpu并且你的浏览器环境不能是http（如非要在http中使用，需要在浏览器端设置允许不安全的内容）




## AndroidTV 使用

目前该项目可以配合 [OrionTV](https://github.com/zimplexing/OrionTV) 在 Android TV 上使用，可以直接作为 OrionTV 后端

已实现播放记录和网页端同步

## TVBOX 订阅功能

本项目支持生成 TVBOX 格式的订阅链接，方便在 TVBOX 应用中使用。

### 配置步骤

1. 在环境变量中设置以下配置：

   ```env
   # 启用 TVBOX 订阅功能
   ENABLE_TVBOX_SUBSCRIBE=true
   # 设置订阅访问 Token（请使用强密码）
   TVBOX_SUBSCRIBE_TOKEN=your_secure_random_token
   # 可选：屏蔽特定视频源（多个源用逗号分隔，填写视频源的 key）
   TVBOX_BLOCKED_SOURCES=source1,source2
   ```

2. 重启应用后，登录网站，点击用户菜单中的"订阅"按钮

3. 复制生成的订阅链接到 TVBOX 应用中使用

## 安全与隐私提醒

### 请设置密码保护并关闭公网注册

为了您的安全和避免潜在的法律风险，我们要求在部署时**强烈建议关闭公网注册**：

### 部署要求

1. **设置环境变量 `PASSWORD`**：为您的实例设置一个强密码
2. **仅供个人使用**：请勿将您的实例链接公开分享或传播
3. **遵守当地法律**：请确保您的使用行为符合当地法律法规

### 重要声明

- 本项目仅供学习和个人使用
- 请勿将部署的实例用于商业用途或公开服务
- 如因公开分享导致的任何法律问题，用户需自行承担责任
- 项目开发者不对用户的使用行为承担任何法律责任
- 本项目不在中国大陆地区提供服务。如有该项目在向中国大陆地区提供服务，属个人行为。在该地区使用所产生的法律风险及责任，属于用户个人行为，与本项目无关，须自行承担全部责任。特此声明

## License

[MIT](LICENSE) © 2025 MoonTV & Contributors

## 致谢

- [ts-nextjs-tailwind-starter](https://github.com/theodorusclarence/ts-nextjs-tailwind-starter) — 项目最初基于该脚手架。
- [MoonTV](https://github.com/MoonTechLab/LunaTV)— 由此启发，再次站在巨人的肩膀上。
- [LibreTV](https://github.com/LibreSpark/LibreTV) — 由此启发，站在巨人的肩膀上。
- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) — 提供强大的网页视频播放器。
- [HLS.js](https://github.com/video-dev/hls.js) — 实现 HLS 流媒体在浏览器中的播放支持。
- [Zwei](https://github.com/bestzwei) — 提供获取豆瓣数据的 cors proxy
- [CMLiussss](https://github.com/cmliu) — 提供豆瓣 CDN 服务
- 感谢所有提供免费影视接口的站点。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=mtvpls/moontvplus&type=Date)](https://www.star-history.com/#mtvpls/moontvplus&Date)