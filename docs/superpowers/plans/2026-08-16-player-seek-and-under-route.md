# 播放器跳转时间拆分与 /under 入口实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:executing-plans` 逐任务实现此计划，并在每个检查点重新运行验证命令。

**目标：** 恢复独立的“快捷快进配置”和播放器按钮，让左右方向键使用独立的“快进/倒退时间”，并将特殊源入口从 `/r18` 改为 `/under`、移除自定义路径映射。

**架构：** 新增一个纯客户端存储辅助模块，集中定义两个 localStorage 键、默认值和正数规范化；播放页分别挂载两个状态/ref，P 键与恢复的按钮只读快捷快进 ref，左右键只读方向键步长 ref。特殊源路径只保留 `/under` 常量，App Router 页面和所有客户端上下文判定共享该常量；删除自定义路径 cookie、表单和 middleware 重定向。

**技术栈：** Next.js App Router、React hooks、ArtPlayer、TypeScript、Jest（jsdom）、pnpm。

---

### 任务 1：为两个播放器时间设置建立可测试的存储边界

**文件：**
- 创建：`src/lib/player-seek-settings.ts`
- 创建：`src/lib/player-seek-settings.test.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
import {
  DEFAULT_QUICK_FORWARD_SECONDS,
  DEFAULT_SEEK_STEP_SECONDS,
  QUICK_FORWARD_STORAGE_KEY,
  SEEK_STEP_STORAGE_KEY,
  loadStoredSeconds,
  normalizeStoredSeconds,
  calculateSeekTime,
} from './player-seek-settings';

describe('播放器两个跳转时间设置', () => {
  beforeEach(() => localStorage.clear());

  it('使用不同的键和默认值', () => {
    expect(QUICK_FORWARD_STORAGE_KEY).toBe('quickForwardSeconds');
    expect(SEEK_STEP_STORAGE_KEY).toBe('seekStepSeconds');
    expect(DEFAULT_QUICK_FORWARD_SECONDS).toBe(90);
    expect(DEFAULT_SEEK_STEP_SECONDS).toBe(10);
    expect(QUICK_FORWARD_STORAGE_KEY).not.toBe(SEEK_STEP_STORAGE_KEY);
  });

  it('分别读取两个键，缺失或非法值回退到各自默认值', () => {
    expect(loadStoredSeconds(QUICK_FORWARD_STORAGE_KEY, 90)).toBe(90);
    expect(loadStoredSeconds(SEEK_STEP_STORAGE_KEY, 10)).toBe(10);
    localStorage.setItem(QUICK_FORWARD_STORAGE_KEY, '45');
    localStorage.setItem(SEEK_STEP_STORAGE_KEY, 'bad');
    expect(loadStoredSeconds(QUICK_FORWARD_STORAGE_KEY, 90)).toBe(45);
    expect(loadStoredSeconds(SEEK_STEP_STORAGE_KEY, 10)).toBe(10);
  });

  it('只接受大于 0 的有限秒数并四舍五入', () => {
    expect(normalizeStoredSeconds(12.6)).toBe(13);
    expect(normalizeStoredSeconds(1)).toBe(1);
    expect(normalizeStoredSeconds(0)).toBeNull();
    expect(normalizeStoredSeconds(-1)).toBeNull();
    expect(normalizeStoredSeconds(Number.NaN)).toBeNull();
    expect(normalizeStoredSeconds(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('按方向计算并把结果限制在视频范围内', () => {
    expect(calculateSeekTime(30, 100, -1, 10)).toBe(20);
    expect(calculateSeekTime(5, 100, -1, 10)).toBe(0);
    expect(calculateSeekTime(95, 100, 1, 10)).toBe(100);
  });
});
```

- [ ] **步骤 2：运行测试确认正确失败**

运行：`pnpm exec jest src/lib/player-seek-settings.test.ts --runInBand`

预期：FAIL，模块 `./player-seek-settings` 尚不存在。

- [ ] **步骤 3：编写最少实现代码**

```ts
export const QUICK_FORWARD_STORAGE_KEY = 'quickForwardSeconds';
export const SEEK_STEP_STORAGE_KEY = 'seekStepSeconds';
export const DEFAULT_QUICK_FORWARD_SECONDS = 90;
export const DEFAULT_SEEK_STEP_SECONDS = 10;

export function normalizeStoredSeconds(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : null;
}

export function loadStoredSeconds(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const saved = normalizeStoredSeconds(Number(window.localStorage.getItem(key)));
  return saved ?? fallback;
}

export function calculateSeekTime(
  currentTime: number,
  duration: number,
  direction: -1 | 1,
  seconds: number
): number {
  const upperBound = Number.isFinite(duration) ? Math.max(0, duration) : Infinity;
  return Math.max(0, Math.min(upperBound, currentTime + direction * seconds));
}
```

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm exec jest src/lib/player-seek-settings.test.ts --runInBand`

预期：4/4 tests passed。

- [ ] **步骤 5：Commit**

```bash
git add src/lib/player-seek-settings.ts src/lib/player-seek-settings.test.ts
git commit -m "test(play): cover independent seek settings"
```

### 任务 2：接入播放器两个状态、设置项和快捷按钮

**文件：**
- 修改：`src/app/play/page.tsx:150-410`（快捷键说明和两个状态）
- 修改：`src/app/play/page.tsx:6350-6410`（方向键处理）
- 修改：`src/app/play/page.tsx:7420-7740`（设置菜单和控制栏）

- [ ] **步骤 1：接入共享常量和独立 refs**

在现有 import 区加入 `player-seek-settings` 的四个常量和 `loadStoredSeconds`，删除组件内 `DEFAULT_QUICK_FORWARD_SECONDS` 与旧的单一初始化逻辑，替换为：

```ts
const [quickForwardSeconds, setQuickForwardSeconds] = useState(() =>
  loadStoredSeconds(QUICK_FORWARD_STORAGE_KEY, DEFAULT_QUICK_FORWARD_SECONDS)
);
const quickForwardSecondsRef = useRef(quickForwardSeconds);
useEffect(() => {
  quickForwardSecondsRef.current = quickForwardSeconds;
}, [quickForwardSeconds]);

const [seekStepSeconds, setSeekStepSeconds] = useState(() =>
  loadStoredSeconds(SEEK_STEP_STORAGE_KEY, DEFAULT_SEEK_STEP_SECONDS)
);
const seekStepSecondsRef = useRef(seekStepSeconds);
useEffect(() => {
  seekStepSecondsRef.current = seekStepSeconds;
}, [seekStepSeconds]);
```

- [ ] **步骤 2：把方向键改为新 ref**

使用 `calculateSeekTime(currentTime, duration, direction, seekStepSecondsRef.current)` 完成左右方向键的边界钳制，并保留现有提示结构；P 键的 `seekQuickForward()` 保持读取 `quickForwardSecondsRef.current`。快捷键帮助中的方向键文案改为“快退 / 快进（快进/倒退时间）”。

- [ ] **步骤 3：恢复上游“快捷快进配置”设置项和控制栏按钮**

从上游 `FETCH_HEAD:src/app/play/page.tsx` 恢复 `快捷快进配置` item，保持其 `quickForwardSeconds` 键、P 键说明、对话框校验、图标、控制栏 `index: 40` 和移动端竖屏隐藏 CSS；保存提示使用“快捷快进已设置为…”。该 item 必须位于“跳过片头片尾”之后。

- [ ] **步骤 4：添加独立“快进/倒退时间”设置项**

紧接快捷快进 item 添加第二个 item，使用独立的 `seekStepSecondsRef`、输入框 id `seek-step-input` 和存储键 `SEEK_STEP_STORAGE_KEY`。标题为“快进/倒退时间”，说明为“设置左右方向键快进 / 快退的时间。”，保存时更新 `seekStepSeconds` 和 ref，提示“快进/倒退时间已设为…”。“跳过配置”保持在这两个 item 之后。

- [ ] **步骤 5：运行播放器设置测试和类型检查**

运行：`pnpm exec jest src/lib/player-seek-settings.test.ts --runInBand` 与 `pnpm typecheck`

预期：播放器设置测试通过，TypeScript exit 0；源码核对得到 P 键/控制栏只引用 `quickForwardSecondsRef`，ArrowLeft/ArrowRight 只引用 `seekStepSecondsRef`。

- [ ] **步骤 6：Commit**

```bash
git add src/app/play/page.tsx
git commit -m "feat(play): 拆分快捷快进与方向键时间设置"
```

### 任务 3：先用失败测试锁定 `/under` 特殊源上下文

**文件：**
- 修改：`src/lib/special-source.client.test.ts`
- 修改：`src/lib/special-source.client.ts`

- [ ] **步骤 1：修改测试到目标路径并删除旧映射测试**

将测试中的 `R18_PATH` 相关路径改为 `/under`，将测试描述改为“/under”，删除 `normalizeSpecialSourcePath`、`getSpecialSourcePathOnDevice`、`setSpecialSourcePathOnDevice`、`SPECIAL_SOURCE_PATH_COOKIE` 的 import 和整个“自定义特殊源入口路径” describe 块；增加断言 `isSpecialSourceContext()` 在 `/r18` 下为 false。

- [ ] **步骤 2：运行测试确认旧实现失败**

运行：`pnpm exec jest src/lib/special-source.client.test.ts --runInBand`

预期：FAIL，旧实现仍只把 `/r18` 判定为特殊源，且旧导出仍被测试引用。

- [ ] **步骤 3：实现固定 `/under` 常量并删除自定义路径 API**

在 `special-source.client.ts` 将 `R18_PATH` 改为：

```ts
export const SPECIAL_SOURCE_PATH = '/under';
```

让 `isSpecialSourceContext()`、所有注释和记录过滤说明使用该常量；删除 `SPECIAL_SOURCE_PATH_COOKIE`、保留路径集合、规范化函数及 cookie 读写函数。

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm exec jest src/lib/special-source.client.test.ts --runInBand`

预期：特殊源测试全部通过，`/under` 及其子路径为特殊上下文，`/r18` 为普通上下文。

- [ ] **步骤 5：Commit**

```bash
git add src/lib/special-source.client.ts src/lib/special-source.client.test.ts
git commit -m "feat(special-source): 将入口路径改为 under"
```

### 任务 4：迁移 App Router 和 UI，移除自定义路径映射

**文件：**
- 创建：`src/app/under/page.tsx`
- 删除：`src/app/r18/page.tsx`
- 删除：`src/app/sp/SpecialSourcePathForm.tsx`
- 修改：`src/app/sp/page.tsx`
- 修改：`src/middleware.ts`
- 修改：`src/app/search/page.tsx`
- 修改：`src/components/Sidebar.tsx`
- 修改：`src/components/MobileBottomNav.tsx`
- 修改：`src/app/admin/page.tsx`
- 修改：`src/lib/config.ts`
- 修改：`src/lib/db.client.ts`

- [ ] **步骤 1：添加 `/under` 页面并删除 `/r18` 页面**

以旧页面为模板创建 `src/app/under/page.tsx`，保留 cookie 开关和 `notFound()`，组件名改为 `UnderPage`，渲染 `<SearchPageClient searchBase='/under' />`；随后删除 `src/app/r18/page.tsx`。

- [ ] **步骤 2：删除 middleware 自定义路径分支**

从 `src/middleware.ts` 删除 `SPECIAL_SOURCE_PATH_COOKIE` import、读取 cookie 的变量以及 redirect 分支；保留认证、TV 模式和其他 middleware 逻辑不动。

- [ ] **步骤 3：清理 `/sp` 页面**

删除 `SPECIAL_SOURCE_PATH_COOKIE` import、customPath/entryPath 变量、`SpecialSourcePathForm` import 和 JSX；“前往里世界”链接固定改为 `href='/under'`，所有说明改写为 `/under`，不再出现自定义路径输入框。

- [ ] **步骤 4：统一客户端和文案引用**

将 Sidebar 的常量 import 改为 `SPECIAL_SOURCE_PATH`，搜索页特殊继续观看条件改为 `searchBase === SPECIAL_SOURCE_PATH`，并将导航、后台、配置、数据库注释中的路径说明改为 `/under`。不改动 `r18a` 等采集源 key。

- [ ] **步骤 5：删除孤立文件并检查引用**

运行：`rg -n --hidden -g '!node_modules' -g '!.next' -g '!.git' 'R18_PATH|SPECIAL_SOURCE_PATH_COOKIE|special_source_path|SpecialSourcePathForm|/r18' src`

预期：无输出；`src/app/under/page.tsx` 是唯一特殊源页面入口。

- [ ] **步骤 6：Commit**

```bash
git add src/app/under src/app/sp src/middleware.ts src/app/search/page.tsx src/components/Sidebar.tsx src/components/MobileBottomNav.tsx src/app/admin/page.tsx src/lib/config.ts src/lib/db.client.ts
git add -u src/app/r18
git commit -m "feat(special-source): 移除自定义映射并使用 under 入口"
```

### 任务 5：全量验证并复核需求

**文件：**
- 验证：上述所有变更文件

- [ ] **步骤 1：运行全部 Jest**

运行：`pnpm test -- --runInBand`

预期：所有测试通过，失败数为 0。

- [ ] **步骤 2：运行 TypeScript 检查**

运行：`pnpm typecheck`

预期：exit 0，无类型错误。

- [ ] **步骤 3：运行格式检查**

运行：`pnpm format:check`

预期：所有文件格式通过；若只报告本次变更文件，执行 `pnpm exec prettier --write` 处理后重新检查。

- [ ] **步骤 4：逐项核对用户需求**

```powershell
rg -n "name: '跳过片头片尾'|name: '快捷快进配置'|name: '快进/倒退时间'|name: '跳过配置'" src/app/play/page.tsx
rg -n "quick-forward-control|seekStepSecondsRef|quickForwardSecondsRef" src/app/play/page.tsx
rg -n --hidden -g '!node_modules' -g '!.next' -g '!.git' 'R18_PATH|SPECIAL_SOURCE_PATH_COOKIE|special_source_path|SpecialSourcePathForm|/r18' src
git diff --check HEAD~4..HEAD
```

预期：四个设置按指定顺序出现；快捷按钮存在；P/按钮与方向键分别使用对应 ref；路径旧名搜索无输出；diff 无空白错误。

- [ ] **步骤 5：检查工作区范围**

运行：`git status --short`

预期：仅有本次计划涉及的源码/测试/文档变更和既有未跟踪 `custom-theme.css`，不添加或提交该主题文件。
