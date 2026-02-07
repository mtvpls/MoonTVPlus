# 📂 FoxAI 项目结构

## 🎯 核心文件说明

```
MoonTVPlus/
│
├── 📄 文档文件 (新增)
│   ├── FOXAI_README.md              # FoxAI 主 README
│   ├── FOXAI_CUSTOMIZATION.md       # 定制说明文档
│   ├── OPTIMIZATION_REPORT.md       # 优化完成报告
│   ├── BEFORE_AFTER_COMPARISON.md   # 前后对比分析
│   ├── QUICK_START.md               # 快速启动指南
│   ├── CHANGES_SUMMARY.md           # 变更总结
│   └── PROJECT_STRUCTURE.md         # 本文件
│
├── 🚀 启动脚本 (新增)
│   └── preview.sh                   # 快速预览脚本
│
├── 🎨 品牌资源 (新增)
│   └── public/
│       └── foxai-logo.svg           # FoxAI Logo SVG
│
├── 🔧 修改的核心文件
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx             # ✨ 主页 (Hero Section + 渐变标题)
│   │   │   └── layout.tsx           # ✨ 布局 (默认配置更新)
│   │   └── components/
│   │       ├── Sidebar.tsx          # ✨ 侧边栏 (FoxAI Logo)
│   │       └── MobileHeader.tsx     # ✨ 移动端头部 (FoxAI Logo)
│   └── scripts/
│       └── generate-manifest.js     # ✨ Manifest 生成 (FoxAI 配置)
│
└── 📦 原有项目文件
    ├── src/
    │   ├── app/
    │   │   ├── api/                 # API 路由
    │   │   ├── admin/               # 管理后台
    │   │   ├── play/                # 播放页面
    │   │   ├── search/              # 搜索页面
    │   │   └── ...                  # 其他页面
    │   ├── components/              # React 组件
    │   ├── lib/                     # 核心业务逻辑
    │   ├── hooks/                   # 自定义 Hooks
    │   └── types/                   # TypeScript 类型
    ├── public/                      # 静态资源
    ├── package.json                 # 依赖配置
    ├── next.config.js               # Next.js 配置
    ├── tailwind.config.ts           # Tailwind 配置
    └── README.md                    # 原项目文档
```

## 📝 文件修改详情

### ✨ 主要修改

#### 1. `src/app/page.tsx` (主页)
```tsx
新增内容:
├── Hero Section (50 行)
│   ├── 渐变背景装饰
│   ├── FoxAI Logo 动画
│   ├── 品牌标语
│   └── 功能按钮组
│
└── 模块标题优化 (60 行)
    ├── 热门电影 (Purple → Blue)
    ├── 热播短剧 (Blue → Cyan)
    ├── 新番放送 (Cyan → Purple)
    ├── 热门剧集 (Purple → Pink)
    ├── 热门综艺 (Pink → Orange)
    └── 即将上映 (Orange → Red)
```

#### 2. `src/components/Sidebar.tsx` (侧边栏)
```tsx
Logo 组件重新设计:
├── 渐变色方块背景
├── "F" 字母标识
├── "FoxAI" 品牌名称
├── "影视聚合" 副标题
└── 悬停旋转动画
```

#### 3. `src/components/MobileHeader.tsx` (移动端头部)
```tsx
Logo 更新:
├── 小尺寸 FoxAI Logo
├── 渐变色设计
└── 响应式布局
```

#### 4. `src/app/layout.tsx` (布局配置)
```tsx
默认配置更新:
├── 站点名称: FoxAI
├── 站点描述: FoxAI 影视聚合平台
└── 公告文案: FoxAI 品牌风格
```

#### 5. `scripts/generate-manifest.js` (Manifest 生成)
```tsx
配置更新:
├── 站点名称: FoxAI
├── 描述: FoxAI 影视聚合平台
└── 主题色: #9333ea
```

---

## 📚 文档文件说明

### 1. `FOXAI_README.md`
**用途**: FoxAI 项目的主要介绍文档
**内容**:
- 项目特色功能
- 快速启动指南
- 界面预览
- 品牌配色
- 文档导航
- Docker 部署
- 环境变量配置

### 2. `FOXAI_CUSTOMIZATION.md`
**用途**: 详细的定制指南
**内容**:
- 已完成的优化项目
- 配色方案详解
- 环境变量配置
- 自动更新说明
- 进一步定制建议

### 3. `OPTIMIZATION_REPORT.md`
**用途**: 完整的优化报告
**内容**:
- 品牌标识系统
- Hero Section 设计
- 内容模块美化
- 交互优化
- 配置更新
- 修改文件清单
- 设计理念
- 响应式设计
- 性能优化

### 4. `BEFORE_AFTER_COMPARISON.md`
**用途**: 前后对比分析
**内容**:
- 视觉对比
- 核心改进点
- 响应式对比
- 配色方案对比
- 预期效果提升

### 5. `QUICK_START.md`
**用途**: 快速启动和部署指南
**内容**:
- 前置要求
- 快速启动步骤
- 环境配置
- Docker 部署
- 功能配置
- 自定义品牌
- 性能优化
- 安全配置
- 常见问题

### 6. `CHANGES_SUMMARY.md`
**用途**: 变更总结和清单
**内容**:
- 修改文件列表
- 统计数据
- 设计变更
- 性能影响
- 兼容性说明
- 升级路径
- 测试清单
- 后续优化建议

### 7. `PROJECT_STRUCTURE.md`
**用途**: 项目结构说明（本文件）
**内容**:
- 文件树结构
- 文件修改详情
- 文档文件说明

---

## 🎨 品牌资源

### Logo 文件
```
public/
└── foxai-logo.svg
    ├── 尺寸: 120x120
    ├── 格式: SVG (矢量)
    ├── 配色: Purple-Blue-Cyan 渐变
    └── 用途: 可用于各种场景
```

---

## 🚀 启动脚本

### `preview.sh`
```bash
功能:
├── 自动安装依赖 (pnpm install)
├── 生成 manifest (pnpm gen:manifest)
└── 启动开发服务器 (pnpm dev)

使用方法:
$ ./preview.sh
```

---

## 📊 代码统计

### 修改统计
```
修改的文件:     5 个
新增的文件:     9 个
代码修改行数:   ~200 行
文档总行数:     ~1500 行
```

### 组件统计
```
新增 UI 组件:   1 个 (Hero Section)
优化的组件:     4 个
新增动画:       5+ 个
渐变色方案:     6 个
```

---

## 🔍 快速查找

### 需要修改品牌名称？
→ 查看 `src/app/layout.tsx`

### 需要修改 Logo？
→ 查看 `src/components/Sidebar.tsx`
→ 查看 `src/components/MobileHeader.tsx`

### 需要修改主页布局？
→ 查看 `src/app/page.tsx`

### 需要修改配色？
→ 查看 `src/app/page.tsx` (搜索 "gradient")

### 需要部署说明？
→ 查看 `QUICK_START.md`

### 需要定制指南？
→ 查看 `FOXAI_CUSTOMIZATION.md`

---

## 📖 推荐阅读顺序

1. **首次使用**: `FOXAI_README.md` → `QUICK_START.md`
2. **了解优化**: `OPTIMIZATION_REPORT.md` → `BEFORE_AFTER_COMPARISON.md`
3. **定制开发**: `FOXAI_CUSTOMIZATION.md` → `CHANGES_SUMMARY.md`
4. **深入研究**: `PROJECT_STRUCTURE.md` (本文件) → 源代码

---

**文档版本**: v1.0  
**更新时间**: 2026-02-07  
**维护状态**: ✅ 活跃维护
