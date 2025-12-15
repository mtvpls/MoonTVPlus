# 夸克网盘源实现摘要

## ✅ 已完成的工作

### 1. 核心架构 - 适配器模式

创建了可扩展的源适配器架构，支持多种视频源类型：

**文件：** `src/lib/adapters/source-adapter.ts`
- ✅ 定义了 `SourceAdapter` 接口
- ✅ 实现了 `SourceAdapterFactory` 工厂类
- ✅ 支持动态加载不同类型的适配器

**接口方法：**
```typescript
interface SourceAdapter {
  init(config): Promise<void>;
  search(query): Promise<SearchResult[]>;
  getDetail(id): Promise<SearchResult>;
  getPlayUrl(id, episodeIndex): Promise<string>;
  isAuthenticated(): Promise<boolean>;
}
```

### 2. 夸克网盘适配器

**文件：** `src/lib/adapters/quark-adapter.ts`

实现了完整的夸克网盘 API 对接：

✅ **认证管理**
- Cookie 存储和验证
- 认证状态检查

✅ **搜索功能**
- 支持在分享链接中搜索
- 支持在个人网盘中搜索
- 自动过滤视频文件

✅ **详情获取**
- 支持获取文件夹详情
- 支持获取单个文件详情
- 自动列出所有集数

✅ **播放地址获取**
- 调用夸克下载API
- 返回可播放的直链

### 3. 苹果CMS适配器

**文件：** `src/lib/adapters/applecms-adapter.ts`

将现有的苹果CMS逻辑重构为适配器模式：

✅ 保持原有功能不变
✅ 统一接口调用方式
✅ 支持特殊源的网页爬取

### 4. 数据类型扩展

**文件：** `src/lib/admin.types.ts`

扩展了 SourceConfig 类型：

```typescript
SourceConfig: {
  key: string;
  name: string;
  api: string;
  sourceType?: 'applecms' | 'quark' | 'ali'; // 新增
  auth?: {                                     // 新增
    token?: string;
    cookie?: string;
    refreshToken?: string;
  };
  ext?: string;                                // 新增
}
```

### 5. TVBOX 解析器增强

**文件：** `src/lib/tvbox-parser.ts`

✅ 支持解析 type=3 的网盘源
✅ 自动识别夸克网盘（通过 api 字段匹配）
✅ 保存源类型和扩展配置

**识别逻辑：**
```typescript
if (site.type === 3) {
  if (api.includes('quark') || api.includes('夸克')) {
    sourceType = 'quark';
  }
}
```

### 6. 订阅管理API更新

**文件：** `src/app/api/admin/tvbox-subscription/route.ts`

✅ 保存源类型（sourceType）
✅ 保存扩展配置（ext）
✅ 支持夸克分享链接配置

### 7. 认证配置API

**文件：** `src/app/api/admin/netdisk-auth/route.ts`

新建了网盘认证管理接口：

✅ `POST /api/admin/netdisk-auth` - 更新Cookie
✅ `GET /api/admin/netdisk-auth?sourceKey=xxx` - 获取Cookie
✅ 仅允许配置网盘源（quark/ali）
✅ 权限验证

### 8. 文档

创建了详细的使用文档：

✅ `docs/TVBOX-NETDISK-IMPLEMENTATION.md` - 技术实现原理
✅ `docs/QUARK-DRIVE-USAGE.md` - 用户使用指南

---

## ⏳ 需要完成的工作

### 1. 更新搜索API使用适配器 【重要】

**文件需修改：**
- `src/app/api/search/route.ts`
- `src/lib/downstream.ts`（或创建新的 `src/lib/source-manager.ts`）

**改造内容：**
```typescript
// 原来的代码
import { searchFromApi } from '@/lib/downstream';

// 改造后
import { SourceAdapterFactory } from '@/lib/adapters/source-adapter';

async function search(source, query) {
  const adapter = await SourceAdapterFactory.getAdapter({
    key: source.key,
    api: source.api,
    sourceType: source.sourceType || 'applecms',
    auth: source.auth,
    ext: source.ext,
  });

  return await adapter.search(query);
}
```

### 2. 更新详情API使用适配器 【重要】

**文件需修改：**
- `src/app/api/detail/route.ts`

**改造内容：**
```typescript
const adapter = await SourceAdapterFactory.getAdapter(sourceConfig);
const detail = await adapter.getDetail(id);
```

### 3. 更新播放API使用适配器 【重要】

**文件需修改：**
- 可能需要创建新的播放地址获取API
- 或修改前端播放逻辑

**功能：**
- 对于网盘源，调用适配器的 `getPlayUrl()`
- 对于CMS源，直接使用 episodes 数组中的地址

### 4. 前端界面更新 【重要】

#### 4.1 视频源配置界面

**文件：** `src/app/admin/page.tsx` 或创建新组件

**需要添加：**
- 源类型选择器（applecms/quark/ali）
- 夸克Cookie配置输入框
- 扩展配置（ext）输入框
- 网盘源特殊标识/图标

#### 4.2 订阅管理界面

**文件：** `src/components/TvboxSubscriptionConfig.tsx`

**需要添加：**
- 显示源类型
- 区分网盘源和CMS源
- 显示是否已配置Cookie

#### 4.3 搜索结果显示

**可能需要修改：**
- 显示源类型标识
- 网盘源特殊样式

### 5. 配置迁移和兼容性 【中等】

**文件：** `src/lib/config.ts`

**需要处理：**
- 旧配置升级（添加 sourceType 字段）
- 默认值设置（sourceType 默认为 'applecms'）

```typescript
// 配置自检时添加
adminConfig.SourceConfig.forEach(source => {
  if (!source.sourceType) {
    source.sourceType = 'applecms';
  }
});
```

---

## 📋 完整实现清单

### 后端API （已完成 ✅）
- [x] 适配器接口定义
- [x] 夸克网盘适配器
- [x] 苹果CMS适配器
- [x] TVBOX解析器更新
- [x] 订阅管理API更新
- [x] 认证配置API

### 数据类型 （已完成 ✅）
- [x] AdminConfig 扩展
- [x] ApiSite 扩展
- [x] SourceConfig 扩展

### 核心逻辑 （需要完成 ⏳）
- [ ] 搜索逻辑重构
- [ ] 详情获取重构
- [ ] 播放地址获取重构

### 前端界面 （需要完成 ⏳）
- [ ] 源类型选择器
- [ ] Cookie配置界面
- [ ] 扩展配置界面
- [ ] 源类型显示优化

### 配置兼容 （需要完成 ⏳）
- [ ] 旧配置迁移
- [ ] 默认值处理

### 文档 （已完成 ✅）
- [x] 技术实现文档
- [x] 用户使用指南

---

## 🎯 下一步实施建议

### 优先级1：核心功能打通
1. 更新搜索API使用适配器
2. 更新详情API使用适配器
3. 测试基本搜索和播放流程

### 优先级2：管理界面
1. 添加源类型选择器
2. 添加Cookie配置功能
3. 测试配置流程

### 优先级3：优化和完善
1. 添加错误处理
2. 添加加载状态提示
3. 优化用户体验

---

## 🧪 测试建议

### 单元测试
- [ ] 夸克适配器认证测试
- [ ] 夸克适配器搜索测试
- [ ] 夸克适配器播放地址获取测试

### 集成测试
- [ ] TVBOX订阅导入夸克源
- [ ] 手动添加夸克源
- [ ] Cookie配置和验证
- [ ] 搜索夸克网盘内容
- [ ] 播放夸克网盘视频

### 兼容性测试
- [ ] 苹果CMS源正常工作
- [ ] 旧配置正确迁移
- [ ] 多种源类型混合使用

---

## 📝 注意事项

1. **向后兼容**：确保现有的苹果CMS源不受影响
2. **权限控制**：网盘Cookie属于敏感信息，需要严格权限控制
3. **错误处理**：Cookie失效、API限流等需要友好的错误提示
4. **性能优化**：适配器实例缓存，避免重复初始化
5. **安全性**：Cookie存储加密（可选）

---

**创建日期：** 2025-12-15
**状态：** 后端核心功能已完成，前端界面待实现
**下一步：** 更新搜索/详情API使用适配器
