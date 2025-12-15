# 夸克网盘源使用指南

## 功能概述

MoonTVPlus 现已支持夸克网盘作为视频源，可以通过以下方式使用：
1. ✅ 从 TVBOX 订阅中导入夸克网盘源（type=3）
2. ✅ 手动添加夸克网盘源
3. ✅ 配置夸克 Cookie 进行认证
4. ✅ 搜索和播放夸克网盘中的视频

## 一、如何获取夸克 Cookie

### 方法一：浏览器开发者工具（推荐）

1. 打开夸克网盘网页版：https://pan.quark.cn
2. 登录你的夸克账号
3. 按 `F12` 打开浏览器开发者工具
4. 切换到 `Network`（网络）标签
5. 刷新页面或点击任意文件夹
6. 在请求列表中找到任意请求，查看 `Request Headers`
7. 找到 `Cookie` 字段，复制完整的 Cookie 值

### 方法二：使用浏览器扩展

安装 Cookie 导出扩展（如 EditThisCookie、Cookie-Editor），直接导出夸克网盘的 Cookie。

### Cookie 示例格式

```
__pus=xxx; __puus=xxx; __kp=xxx; __kps=xxx; __uid=xxx; __wpkreporterwid_=xxx;
```

## 二、配置夸克网盘源

### 2.1 通过 TVBOX 订阅导入

如果你的 TVBOX 订阅中包含夸克网盘源，系统会自动识别并导入。

**TVBOX 订阅中的夸克源格式示例：**
```json
{
  "sites": [
    {
      "key": "quark_example",
      "name": "夸克网盘示例",
      "type": 3,
      "api": "csp_QuarkCloud",
      "ext": {
        "shares": [
          "https://pan.quark.cn/s/xxx",
          "https://pan.quark.cn/s/yyy"
        ]
      }
    }
  ]
}
```

**导入步骤：**
1. 进入管理后台 `/admin`
2. 打开 "TVBOX订阅管理" 标签
3. 点击 "添加订阅"，输入订阅 URL
4. 系统会自动解析并导入其中的夸克网盘源

### 2.2 手动添加夸克网盘源

1. 进入管理后台 `/admin`
2. 打开 "视频源配置" 标签
3. 点击 "添加视频源"
4. 填写以下信息：
   - **源标识（key）**：`quark_mydrive`
   - **源名称**：`我的夸克网盘`
   - **API地址**：`https://drive-pc.quark.cn`
   - **源类型**：选择 `quark`
   - **扩展配置（ext）**：可选，填写分享链接配置（见下方格式）

**扩展配置格式示例：**
```json
{
  "shares": [
    "https://pan.quark.cn/s/abc123",
    "https://pan.quark.cn/s/def456"
  ]
}
```

## 三、配置 Cookie 认证

添加源之后，需要配置 Cookie 才能正常使用。

1. 在 "视频源配置" 中找到你添加的夸克网盘源
2. 点击 "配置认证" 按钮（或类似的配置入口）
3. 粘贴你获取的夸克 Cookie
4. 保存配置

**API 调用方式（开发者）：**
```javascript
// POST /api/admin/netdisk-auth
{
  "sourceKey": "quark_mydrive",
  "cookie": "你的夸克Cookie",
  "ext": "可选的扩展配置"
}
```

## 四、使用夸克网盘源

### 4.1 搜索视频

配置完成后，夸克网盘源会出现在可用源列表中。

**搜索方式：**
1. 在首页搜索框输入关键词（如"庆余年"）
2. 系统会同时搜索所有源，包括夸克网盘
3. 夸克网盘源的搜索结果会显示源名称标识

**夸克网盘搜索逻辑：**
- 如果配置了分享链接（ext.shares），会在分享链接中搜索
- 如果配置了 Cookie，还会搜索个人网盘中的内容

### 4.2 播放视频

1. 点击搜索结果进入详情页
2. 选择集数
3. 点击播放

**播放流程：**
```
用户点击播放
  ↓
系统调用夸克适配器的 getPlayUrl()
  ↓
夸克适配器调用夸克API获取下载链接
  ↓
返回播放地址给播放器
  ↓
播放器开始播放
```

## 五、夸克网盘源的特点

### 优点
✅ 视频质量通常较好（原盘）
✅ 播放速度快（夸克CDN加速）
✅ 支持大文件和4K视频
✅ 资源组织清晰（文件夹结构）

### 限制
⚠️ 需要夸克账号和 Cookie
⚠️ Cookie 有效期有限，需要定期更新
⚠️ 部分分享链接可能失效
⚠️ 依赖夸克网盘服务的可用性

## 六、常见问题

### Q1: Cookie 失效怎么办？
**A:** 当 Cookie 失效时，搜索和播放会报错。重新获取 Cookie 并更新配置即可。

### Q2: 搜索不到结果？
**A:** 检查以下几点：
- Cookie 是否有效
- 是否配置了分享链接（ext.shares）
- 关键词是否准确
- 个人网盘中是否有相关视频

### Q3: 播放失败？
**A:** 可能的原因：
- Cookie 失效
- 文件已被删除
- 网络问题
- 下载链接过期（重新获取即可）

### Q4: 如何批量添加分享链接？
**A:** 编辑源的 ext 配置：
```json
{
  "shares": [
    "https://pan.quark.cn/s/link1",
    "https://pan.quark.cn/s/link2",
    "https://pan.quark.cn/s/link3"
    // ...更多链接
  ]
}
```

## 七、技术架构（开发者）

### 适配器模式
```
SourceAdapterFactory
  ├── AppleCmsAdapter (苹果CMS源)
  └── QuarkDriveAdapter (夸克网盘源)
      ├── init() - 初始化配置
      ├── search() - 搜索视频
      ├── getDetail() - 获取详情
      ├── getPlayUrl() - 获取播放地址
      └── isAuthenticated() - 检查认证状态
```

### 核心文件
- `src/lib/adapters/source-adapter.ts` - 适配器接口定义
- `src/lib/adapters/quark-adapter.ts` - 夸克网盘适配器实现
- `src/lib/adapters/applecms-adapter.ts` - 苹果CMS适配器实现
- `src/app/api/admin/netdisk-auth/route.ts` - 认证配置API

### API 端点
- `POST /api/admin/netdisk-auth` - 更新网盘认证信息
- `GET /api/admin/netdisk-auth?sourceKey=xxx` - 获取网盘认证信息

## 八、安全提示

⚠️ **重要：保护你的 Cookie！**

- Cookie 包含你的账号认证信息
- 不要将 Cookie 分享给他人
- 定期更换 Cookie
- 使用强密码保护你的管理后台

## 九、未来规划

🚀 计划中的功能：
- [ ] 支持阿里云盘
- [ ] 支持 OneDrive
- [ ] 支持115网盘
- [ ] Cookie 自动刷新机制
- [ ] 扫码登录功能
- [ ] 批量转存功能

---

**更新日期：** 2025-12-15
**版本：** v1.0.0
