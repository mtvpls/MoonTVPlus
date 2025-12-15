# TVBOX 网盘源工作原理详解

## 一、TVBOX 网盘源的完整工作流程

### 1. 配置层 - TVBOX 订阅格式

```json
{
  "sites": [
    {
      "key": "quark",
      "name": "夸克网盘",
      "type": 3,  // type=3 表示使用 Spider（爬虫）解析
      "api": "csp_QuarkCloud",  // Spider 类名
      "ext": "夸克分享链接集合",  // 配置文件路径或直接配置
      "jar": "http://xxx.com/spider.jar"  // Spider jar 包地址
    },
    {
      "key": "ali",
      "name": "阿里云盘",
      "type": 3,
      "api": "csp_AliYunDrive",
      "ext": "阿里云盘配置",
      "jar": "http://xxx.com/spider.jar"
    }
  ],
  "spider": "http://xxx.com/spider.jar"  // 全局 Spider jar
}
```

### 2. Spider 机制 - 核心处理层

**什么是 Spider jar？**
- 这是一个 **Java 插件包**（.jar 文件）
- 包含各种网盘的 API 调用逻辑
- TVBOX 运行时动态加载这个 jar 包
- 每个网盘对应一个 Spider 类（如 `csp_QuarkCloud`）

**Spider 的核心接口：**
```java
public abstract class Spider {
    // 初始化（传入配置）
    public void init(Context context, String extend);

    // 首页分类
    public String homeContent(boolean filter);

    // 分类列表
    public String categoryContent(String tid, String pg, boolean filter, HashMap<String, String> extend);

    // 详情页
    public String detailContent(List<String> ids);

    // 搜索
    public String searchContent(String key, boolean quick);

    // 播放地址解析
    public String playerContent(String flag, String id, List<String> vipFlags);
}
```

### 3. 认证流程 - 如何实现扫码登录

#### 方式一：网盘 OAuth 扫码登录（推荐）

```
用户操作流程：
1. 用户在 TVBOX 设置中选择"夸克登录"
2. TVBOX 调用夸克 OAuth API 生成二维码
3. 用户用夸克 APP 扫码授权
4. TVBOX 获取 access_token 和 refresh_token
5. 将 token 存储在本地（SharedPreferences/数据库）
```

**技术实现（伪代码）：**
```kotlin
// 1. 生成登录二维码
fun generateQRCode() {
    val response = httpGet("https://uop.quark.cn/cas/ajax/getServiceTicket")
    val qrUrl = response.data.qr_code_url
    displayQRCode(qrUrl)  // 显示二维码

    // 轮询检查登录状态
    pollLoginStatus(response.data.ticket)
}

// 2. 轮询登录状态
fun pollLoginStatus(ticket: String) {
    while (!isLoggedIn) {
        val status = httpGet("https://uop.quark.cn/cas/ajax/getTicketStatus?ticket=$ticket")
        if (status.data.status == "success") {
            val token = status.data.token
            saveToken(token)  // 保存到本地
            break
        }
        delay(2000)  // 每 2 秒检查一次
    }
}
```

#### 方式二：Cookie/Token 手动配置

```json
// ext 配置文件内容
{
  "token": "用户的网盘 token",
  "cookie": "用户的 cookie",
  "shares": [
    "https://pan.quark.cn/s/xxx",  // 分享链接
    "https://pan.quark.cn/s/yyy"
  ]
}
```

### 4. 播放流程 - 从搜索到播放

```
完整流程：
用户搜索 "庆余年"
  ↓
TVBOX 调用 Spider.searchContent("庆余年")
  ↓
Spider 调用网盘搜索 API
  ↓
返回文件列表（JSON 格式）
  ↓
用户选择某个文件夹/文件
  ↓
TVBOX 调用 Spider.detailContent(fileId)
  ↓
Spider 获取该文件夹下的所有集数
  ↓
用户选择第 1 集播放
  ↓
TVBOX 调用 Spider.playerContent(flag, episodeId)
  ↓
Spider 调用网盘"获取下载链接"API
  ↓
返回播放地址（m3u8 或 mp4 直链）
  ↓
TVBOX 播放器播放该地址
```

### 5. 关键 API 调用示例

#### 夸克网盘 API 示例

```kotlin
class QuarkCloudSpider : Spider() {
    private var token: String = ""

    override fun init(context: Context, extend: String) {
        // 从配置中读取 token
        token = loadTokenFromConfig(extend)
    }

    override fun searchContent(key: String, quick: Boolean): String {
        // 1. 调用夸克搜索 API
        val url = "https://drive-pc.quark.cn/1/clouddrive/file/sort"
        val params = mapOf(
            "pdir_fid" to "0",
            "keyword" to key,
            "_page" to "1",
            "_size" to "50"
        )
        val headers = mapOf(
            "Cookie" to "__pus=$token"
        )

        val response = httpPost(url, params, headers)

        // 2. 解析返回结果
        val files = parseSearchResult(response)

        // 3. 转换为 TVBOX 标准格式
        return convertToTvboxFormat(files)
    }

    override fun playerContent(flag: String, id: String, vipFlags: List<String>): String {
        // 1. 调用夸克"获取下载地址"API
        val url = "https://drive-pc.quark.cn/1/clouddrive/file/download"
        val params = mapOf("fids" to id)
        val headers = mapOf("Cookie" to "__pus=$token")

        val response = httpPost(url, params, headers)
        val downloadUrl = response.data[0].download_url

        // 2. 返回播放地址
        return """
        {
            "parse": 0,
            "playUrl": "$downloadUrl",
            "url": "$downloadUrl"
        }
        """.trimIndent()
    }
}
```

#### 阿里云盘 API 示例

```kotlin
class AliYunDriveSpider : Spider() {
    private var refreshToken: String = ""
    private var accessToken: String = ""

    override fun init(context: Context, extend: String) {
        refreshToken = loadTokenFromConfig(extend)
        accessToken = refreshAccessToken(refreshToken)
    }

    // 刷新 access_token
    fun refreshAccessToken(refreshToken: String): String {
        val url = "https://api.aliyundrive.com/token/refresh"
        val body = """{"refresh_token":"$refreshToken"}"""
        val response = httpPost(url, body)
        return response.access_token
    }

    // 获取文件播放地址
    override fun playerContent(flag: String, id: String, vipFlags: List<String>): String {
        val url = "https://api.aliyundrive.com/v2/file/get_download_url"
        val body = """{"file_id":"$id"}"""
        val headers = mapOf("Authorization" to "Bearer $accessToken")

        val response = httpPost(url, body, headers)
        return """{"url":"${response.url}"}"""
    }
}
```

## 二、在 MoonTVPlus 中实现网盘源的方案

### 方案对比

| 实现方式 | 优点 | 缺点 | 推荐度 |
|---------|------|------|--------|
| **方式1：集成 Spider jar** | 复用 TVBOX 生态 | 需要运行 Java 环境，复杂度高 | ⭐⭐ |
| **方式2：纯 Node.js 实现** | 代码可控，易维护 | 需要自己实现所有 API 调用 | ⭐⭐⭐⭐ |
| **方式3：代理模式** | 利用现有工具 | 依赖外部服务 | ⭐⭐⭐ |

### 推荐方案：纯 Node.js 实现

**架构设计：**

```
SourceAdapter 接口
├── AppleCmsAdapter（已有）
├── QuarkDriveAdapter（新增）
│   ├── authenticate()      // 认证登录
│   ├── search()           // 搜索文件
│   ├── getFileList()      // 获取文件列表
│   └── getPlayUrl()       // 获取播放地址
└── AliDriveAdapter（新增）
    └── [同上]
```

### 关键技术点

1. **Token 存储**：存储在 Redis/Kvrocks 中
2. **扫码登录**：通过网盘 OAuth API 实现
3. **API 调用**：使用 fetch 调用网盘官方 API
4. **播放地址获取**：通过网盘下载 API 获取直链

## 三、总结

TVBOX 网盘源的核心是：
1. 📦 **Spider jar 插件系统** - 动态加载 Java 插件处理不同网盘
2. 🔐 **OAuth 扫码登录** - 获取并存储网盘 token
3. 🌐 **网盘 API 调用** - 搜索、列表、播放地址获取
4. 🎬 **标准化输出** - 将网盘数据转换为统一格式供播放器使用

要在 MoonTVPlus 中实现，主要挑战是：
- ✅ 实现各网盘的 API 对接（技术难度中等）
- ✅ 设计适配器架构（已有方案）
- ⚠️ 处理网盘认证和 token 刷新（需要用户提供 token）
- ⚠️ 应对网盘 API 变化（需要持续维护）

是否要继续实现网盘源支持？我可以帮你实现夸克或阿里云盘的适配器。
