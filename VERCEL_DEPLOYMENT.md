# Vercel 部署指南

本项目已支持使用 **Vercel Postgres** 作为数据库后端，可在 Vercel 平台上稳定部署。

## 环境变量配置

在 Vercel 项目设置中添加以下环境变量：

### 必需的环境变量

| 变量名 | 说明 | 示例值 |
|--------|------|--------|
| `NEXT_PUBLIC_STORAGE_TYPE` | 存储类型 | `postgres` |
| `POSTGRES_URL` | Vercel Postgres 连接字符串 | `postgres://...` |
| `USERNAME` | 管理员用户名 | `admin` |
| `PASSWORD` | 管理员密码 | `your_password` |

### Vercel Postgres 连接字符串

Vercel Postgres 会自动提供以下环境变量：
- `POSTGRES_URL` - 完整连接字符串
- `POSTGRES_PRISMA_URL` - Prisma 兼容连接字符串
- `POSTGRES_URL_NON_POOLING` - 无连接池连接字符串
- `POSTGRES_USER` - 数据库用户名
- `POSTGRES_HOST` - 数据库主机
- `POSTGRES_PASSWORD` - 数据库密码
- `POSTGRES_DATABASE` - 数据库名称

通常只需要使用 `POSTGRES_URL` 即可。

## 部署步骤

### 1. 创建 Vercel Postgres 数据库

```bash
# 安装 Vercel CLI
npm i -g vercel

# 登录 Vercel
vercel login

# 创建 Postgres 数据库
vercel postgres create

# 选择数据库并连接到项目
vercel postgres connect
```

### 2. 初始化数据库表结构

```bash
# 运行数据库初始化脚本
pnpm init:postgres
```

### 3. 部署到 Vercel

```bash
# 部署项目
vercel --prod
```

## 功能限制

由于 Vercel 的 serverless 环境限制，以下功能不可用：

- **观影室** (Watch Room) - 需要 WebSocket 支持，Vercel serverless 不支持长时间运行的连接

## 存储类型对比

| 存储类型 | 部署平台 | 数据持久化 | 说明 |
|---------|---------|-----------|------|
| `localstorage` | 任意 | ❌ 浏览器本地 | 仅用于测试 |
| `d1` | Cloudflare | ✅ | Cloudflare D1 数据库 |
| `postgres` | Vercel | ✅ | Vercel Postgres 数据库 |
| `redis` | 自建服务器 | ✅ | Redis 数据库 |
| `upstash` | Vercel | ✅ | Upstash Redis |
| `kvrocks` | 自建服务器 | ✅ | Kvrocks 数据库 |

## 数据迁移

如果需要从其他存储类型迁移数据到 Vercel Postgres，请使用管理后台的数据迁移功能。

## 注意事项

1. **数据库配额**：Vercel Postgres 免费版有 256 MB 存储限制
2. **连接池**：Vercel Postgres 自动管理连接池，无需手动配置
3. **冷启动**：首次请求可能需要几秒钟冷启动时间
