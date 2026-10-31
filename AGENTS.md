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

## 模块划分

- `client/src/types/book.ts` — 类型定义
- `client/src/services/db.ts` — IndexedDB 封装（书籍/章节/知识树 CRUD）
- `client/src/services/book-processor.ts` — 处理流水线 orchestrator
- `client/src/services/ai.ts` — AI 调用（DeepSeek Chat），generateKnowledgeTree 采用「知识树构建方法论」系统提示词（七步：完整读取→全量盘点→剔除噪音→逻辑分层→配结构元素→观点性命名→自校验），输出 source/intro/overview/sections[].subsections[].points[].elements[] + summary 结构；支持 markdown 代码块兼容解析、长文截断标注
- `client/src/data/sample-article.ts` — 内置示例文章
- `client/src/hooks/useBooks.ts` — 书籍列表状态 Hook
- `client/src/hooks/useReader.ts` — 阅读器状态 Hook
- `client/src/components/` — 复用组件（BookCard/AddBookDialog/KnowledgeTree/StepTimeline）
```
