# 漫画 Mock 服务

独立的 Suwayomi mock，只有 Node.js 18+ 的运行要求，无需安装依赖。

在项目根目录启动：

```sh
pnpm mock:manga
```

也可以单独复制此目录，在目录里运行 `npm start` 或 `node server.mjs`。默认地址为 `http://127.0.0.1:4568`，使用 Ctrl+C 停止。

在项目管理端的 Suwayomi 配置中启用漫画，服务地址填 `http://127.0.0.1:4568`，认证选择“无”，语言选择 `zh`。通过环境变量配置时使用：

```dotenv
SUWAYOMI_ENABLED=true
SUWAYOMI_URL=http://127.0.0.1:4568
SUWAYOMI_AUTH_MODE=none
SUWAYOMI_DEFAULT_LANG=zh
```

启动项目后打开 `/manga`，或者在漫画搜索中输入“恋人”“星港”“漫画”。已有管理端配置会优先于环境变量，切换地址时应更新当前生效的配置。

服务包含 5 个中文来源、20 部样本漫画，以及不同来源的独立版本。首部漫画在漫画之家有 108 话，在如漫画有 112 话。推荐每页 8 部，支持热门、最新和关键词搜索；目录、封面和每话 6–8 页漫画图片都有本地数据。样本中还包含完结、少量章节、空目录和不同部数的作品。

来源的搜索和推荐请求按到达顺序依次返回，每个请求等待前一个返回后再延迟 2 秒。一次五源搜索会在约 2、4、6、8、10 秒收到各来源结果。`GET /health` 中的 `sourceResponseIntervalMs` 为 `2000`。

项目继续使用现有的书架和阅读历史存储，mock 提供来源、作品、章节和图片。封面与漫画页为本地生成的演示图。

`POST /api/graphql` 支持项目使用的 `sources`、`fetchSourceManga`、`manga`、`fetchChapters` 和 `fetchChapterPages` 操作，参数使用 `variables`。`GET /api/graphql` 可用 `query` 和 `variables` 查询参数请求；`GET /health` 查看状态和示例 ID。无效 ID、页码和未知操作返回 GraphQL 错误，图片不存在时返回 404。

修改监听地址或端口：

```sh
node mocks/suwayomi/server.mjs --host 0.0.0.0 --port 4568
```

也可设置 `MANGA_MOCK_HOST`、`MANGA_MOCK_PORT`。项目运行在 Docker 中时，服务地址应使用容器能访问的宿主机地址。

如需验证认证流程，可设置 `MANGA_MOCK_AUTH_MODE=basic_auth` 或 `simple_login`，并设置 `MANGA_MOCK_USERNAME`、`MANGA_MOCK_PASSWORD`；未设置时演示账号为 `demo` / `demo`。简单登录使用 `/login.html`，会返回会话 Cookie。项目中的认证配置应与 mock 一致。
