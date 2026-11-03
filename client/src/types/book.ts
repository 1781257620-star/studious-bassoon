export type BookStatus =
  | 'pending'
  | 'downloading'
  | 'parsing'
  | 'chapterizing'
  | 'tree_generating'
  | 'entity_matching'
  | 'done'
  | 'error';

export type BookSource = 'zlib' | 'sample' | 'manual';

export const STATUS_LABELS: Record<BookStatus, string> = {
  pending: '待下载',
  downloading: '下载中',
  parsing: '解析中',
  chapterizing: '切章中',
  tree_generating: '生成知识树中',
  entity_matching: '实体识别中',
  done: '已生成知识树',
  error: '处理失败',
};

export interface Book {
  id: string;
  title: string;
  author: string;
  source: BookSource;
  status: BookStatus;
  progress: number;
  coverColor: string;
  isDemo: boolean;
  rawText?: string;
  createdAt: number;
  completedAt?: number;
  errorMessage?: string;
  treeChunkProgress?: number;
  isCancelled?: boolean;
  treeIntro?: string;
  treeOverview?: string;
  treeSource?: string;
}

export interface Chapter {
  id: string;
  bookId: string;
  title: string;
  index: number;
  paragraphs: string[];
}

export interface KnowledgeNode {
  id: string;
  bookId: string;
  parentId: string | null;
  level: number;
  title: string;
  content?: string;
  summary?: string;
  childrenIds: string[];
  paragraphRefs?: ParagraphRef[];
  nodeType?: KnowledgeNodeType;
  elementType?: ElementType;
  /** 行动清单项是否已勾选 */
  checked?: boolean;
  /** 原文句群的出处章节标题，仅 original_quote 节点用 */
  quoteChapter?: string;
}

export type KnowledgeNodeType =
  | 'overview'
  | 'intro'
  | 'section'
  | 'point'
  | 'subpoint'
  | 'element'
  | 'action_list'
  | 'action_item'
  | 'original_quote_group'
  | 'original_quote'
  | 'content_markdown'
  | 'closing';

export type ElementType = 'example' | 'quote' | 'data' | 'case' | 'experiment';

export const ELEMENT_LABELS: Record<ElementType, string> = {
  example: '实例',
  quote: '金句',
  data: '数据',
  case: '案例',
  experiment: '实验',
};

export const ELEMENT_COLORS: Record<ElementType, string> = {
  example: 'bg-primary/10 text-primary',
  quote: 'bg-primary/15 text-primary font-medium',
  data: 'bg-accent text-foreground',
  case: 'bg-secondary text-foreground',
  experiment: 'bg-primary/20 text-primary',
};

export interface ParagraphRef {
  chapterId: string;
  paragraphIndex: number;
  text: string;
  /** 是否成功定位到原文段落；false 表示片段来自 AI 输出但未在原文中找到 */
  located?: boolean;
}

export type StepKey =
  | 'download'
  | 'parse'
  | 'chapterize'
  | 'tree'
  | 'entity';

export const STEPS: StepKey[] = [
  'download',
  'parse',
  'chapterize',
  'tree',
  'entity',
];

export const STEP_LABELS: Record<StepKey, string> = {
  download: '下载文档',
  parse: '解析文本',
  chapterize: '切分章节',
  tree: '生成知识树',
  entity: '实体识别与关联',
};

export const STEP_DESCRIPTIONS: Record<StepKey, string> = {
  download: '从书源获取书籍内容',
  parse: '提取并标准化文本',
  chapterize: '按章节结构切分',
  tree: '按章生成并归位知识树',
  entity: '识别人名地名并关联原文',
};

export type StepStatus = 'pending' | 'running' | 'done' | 'error';

export interface ProcessingStep {
  key: StepKey;
  status: StepStatus;
  progress: number;
  errorMessage?: string;
}

export interface ProcessingState {
  bookId: string;
  steps: ProcessingStep[];
}

export interface EntityItem {
  id: string;
  bookId: string;
  name: string;
  type: 'person' | 'place';
  description?: string;
  occurrences: { chapterId: string; paragraphIndex: number }[];
}
