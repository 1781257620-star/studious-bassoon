# AI 阅读工作台

本地 PWA 阅读应用，移动端优先，松石暖沙配色。

## 设计规范

### 配色（松石暖沙）

| Token | HEX | 用途 |
|-------|-----|------|
| `--color-paper` | #F2ECDF | 页面主背景（暖沙色） |
| `--color-ink` | #2C3B38 | 正文/标题文字（深墨绿） |
| `--color-pine` | #3F7F76 | 主强调色（按钮、进度条、导航高亮、关键词标签） |
| `--color-pine-foreground` | #FFFFFF | 主强调色上的文字 |
| `--color-muted` | #7A8279 | 次要说明文字 |
| `--color-highlight` | #DBE9E6 | 划词高亮、浅底容器 |
| `--color-note-bg` | #E6EFEC | 笔记/批注卡片背景 |

Tailwind token 映射：
- `bg-background` → paper 暖沙
- `text-foreground` → ink 深墨绿
- `bg-primary / text-primary / border-primary` → pine 松石绿
- `text-muted-foreground` → muted 次级文字
- `bg-accent` → highlight 高亮浅绿
- `bg-secondary / border` → note 批注浅底（作卡片分割/次级背景）

### 布局

- 移动端优先，最大宽度 480px 居中，桌面端两侧留空
- 底部导航固定，高度 60px，内容区 `pb-[calc(60px+env(safe-area-inset-bottom))]`
- 页面水平内边距统一 `px-5`，垂直间距用 `gap-4 / space-y-4`
- 卡片圆角 `rounded-2xl`，按钮圆角 `rounded-xl`

### 字体层级

- 页面大标题：`text-2xl font-semibold`（ink）
- 区块标题：`text-lg font-semibold`（ink）
- 正文：`text-base leading-relaxed`（ink）
- 辅助文字：`text-sm`（muted）
- 小字标签：`text-xs`（muted）

### 视觉基调

- 纸感背景，无渐变滥用
- 阴影克制：卡片用轻微投影 `shadow-sm`，色值 `rgba(44, 59, 56, 0.06)`
- 按钮和可点元素加 `active:scale-[0.98]` 微交互
- 整体清新自然，阅读氛围舒适

## 数据边界

纯前端本地 PWA，数据全部存在浏览器端（IndexedDB / localStorage），不依赖后端。
- DeepSeek API Key：localStorage 存储
- 书籍数据、知识树、笔记：IndexedDB（预留结构，当前阶段用内存示例数据）
- AI 调用封装：`client/src/services/ai.ts`，统一管理 API Key 读取、请求发起、错误处理

## 页面结构

底部导航 4 个 Tab：
1. **书架** (`/`) — 书籍列表 + 添加书籍弹窗
2. **阅读** (`/read`) — 知识树阅读器 + 原文展开
3. **AI 处理** (`/process`) — 多本书的 5 步流水线进度
4. **设置** (`/settings`) — API Key 配置 + 其他设置占位

## 数据模型

```
Book {
  id: string
  title: string
  author: string
  source: 'zlib' | 'sample' | 'manual'
  status: 'pending' | 'downloading' | 'parsing' | 'chapterizing' | 'tree_generating' | 'entity_matching' | 'done' | 'error'
  progress: number (0-100)
  coverColor: string
  isDemo: boolean
  rawText?: string
  createdAt: number
  completedAt?: number
  errorMessage?: string
}

Chapter {
  id: string
  bookId: string
  title: string
  index: number
  paragraphs: string[]
}

KnowledgeNode （扁平数组 + parentId 构建树）
  id: string
  bookId: string
  parentId: string | null
  level: number (0=根, 1=板块/导语/总结, 2=子板块/行动清单/金句收束, 3=要点/行动项, 4=元素)
  title: string
  content?: string        (要点正文、元素内容、导语段落等)
  summary?: string        (总览一句话概括)
  childrenIds: string[]
  paragraphRefs?: ParagraphRef[]   (原文回溯，位于 element/金句 节点)
  nodeType?: KnowledgeNodeType     (overview/intro/section/point/subpoint/element/action_list/action_item)
  elementType?: ElementType        (example/experiment/quote/data/case)
  checked?: boolean                (仅 action_item：是否勾选)

ParagraphRef {
  chapterId: string
  paragraphIndex: number
  text: string
  located?: boolean       (是否成功定位到原文段落)
}

ProcessingState {
  bookId: string
  steps: StepState[]
}

EntityItem {
  id: string
  bookId: string
  name: string
  type: 'person' | 'place'
  occurrences: { chapterId, paragraphIndex }[]
}
```

## 产品定义（2026-11-04 定稿）

**核心产品**：议题重组式精读大纲（产品内称"知识树"）。
- 本质：给原文换一套更易懂、易吸收的骨架——按议题重组线性文本，不是让用户跳过原书，而是换一种更容易读懂、吸收的方式重组书籍，解决阅读三大痛点：读得慢（效率）、看不懂（理解）、记不住（记忆）。
- 定位：大纲是"地图"，原文是"实地"；大纲是原文的导航+预习+复习层，不是替代品。
- 理论支撑：认知负荷理论（分层降低外在负荷→效率）、逻辑递进（因果链条完整→理解）、组块化（Miller 7±2）+ 深度加工（Craik & Lockhart→记忆）。
- 价值边界：结构化替代的是"信息传递型文本"（报告/手册/新闻）；替代不了"探索型文本"（论证/文学/前沿）。传记/历史是混合体——生平脉络可结构化，文笔叙事留给原文。

**知识树骨架模式**（不同书类型 → 不同骨架，AI 按内容自由组织）：
- 理论概念类：本质 → 机制 → 双面影响 → 应对
- 传记类：背景 → 转折 → 成就 → 思想 → 影响
- 工具方法论类：核心问题 → 原理 → 方法 → 步骤 → 误区
- 历史/报告类：背景 → 事件 → 数据 → 结论 → 建议

**架构决策：壳固定，肉自由**
- 固定字段（做头部/尾部展示）：`source`（来源）、`intro`（导语）、`coreLine`（核心主线）、`closing`（收尾句）
- 主体内容：AI 直接输出 markdown（`contentMarkdown`），自由组织层级和结构，不再强制固定 JSON 三层（section→subsection→point）
- 不再固定模板的另一个理由：即使模板一样，每本书分层深度、板块数量、内容类型都不同；markdown 让 AI 自己决定层级，组件只负责统一样式

**阅读页组件拆分**（固定复用，不重复）：
```
TreeHeader    全景总览卡（标题+核心主线+统计）
IntroCard     导语块
MarkdownBody  主体内容（统一的 h2/h3/bullet/quote 样式）
QuoteBlock    原文引用（blockquote 样式，标注章节）
ClosingBlock  收尾句
```

## 原文回溯功能设计（P1，尚未实现）

**核心交互原则**（用户定稿比喻）：地图常驻 · 实地闪送 · 双向锚定 · 焦点切换而非页面切换。
- 大纲（地图）始终保持可见，原文（实地）以浮层/抽屉弹出，不"杀掉"地图
- 不是把原文嵌套进大纲展开，而是入口+索引跳转，同时保留上下文

**拆原文方式**：按每句的"功能"拆（论证结构分析），不是机械按段落/句群切：
- AI 分析每句话在论证中的角色：主张 / 依据 / 推导 / 案例 / 数据 / 反驳
- 同一要点在书里多处出现 → 多个片段按议题归集
- 产出 mapping：要点节点 → [{章, 段落区间, 片段}]

**展示规则**：
- 短句（金句/关键句）→ 可嵌套展示（不打断阅读）
- 长论证（完整推导/案例）→ 抽屉/浮层闪送（避免撑爆大纲）
- 浮层显示：对应片段原文（高亮支撑句）+ 出处章节 + 前后 1-2 段可展开上下文
- 反向入口：原文某段可显示"支撑大纲哪个要点"，点击跳回地图

## P2 需求池（暂缓）

- 标记聚合：划线内容自动聚成"我的专属摘要"
- 笔记关联：笔记挂在知识点+原文段落上
- 行为反推：AI 根据用户划线/笔记数据反推关注点，调整输出策略（标记数据是偏好分析的数据源）

## 模块划分

- `client/src/types/book.ts` — 类型定义
- `client/src/services/db.ts` — IndexedDB 封装（书籍/章节/知识树 CRUD）
- `client/src/services/book-processor.ts` — 处理流水线 orchestrator
- `client/src/services/ai.ts` — AI 调用（DeepSeek Chat），知识树生成方法论系统提示词（完整读取→全量盘点→剔除噪音→逻辑分层→配结构元素→观点性命名→自校验）；**目标架构**：输出 source/intro/coreLine/closing 固定字段 + contentMarkdown 自由主体
- `client/src/data/sample-article.ts` — 内置示例文章
- `client/src/hooks/useBooks.ts` — 书籍列表状态 Hook
- `client/src/hooks/useReader.ts` — 阅读器状态 Hook
- `client/src/components/` — 复用组件（BookCard/AddBookDialog/KnowledgeTree/StepTimeline）
```
