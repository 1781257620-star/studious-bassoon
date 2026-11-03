import { DEMO_KNOWLEDGE_TREE } from '@client/src/data/sample-article';
import type {
  Chapter,
  KnowledgeNode,
} from '@client/src/types/book';

export function buildDemoTree(
  bookId: string,
  chapters: Chapter[],
  bookTitle: string,
): KnowledgeNode[] {
  const nodes: KnowledgeNode[] = [];
  const rootId = crypto.randomUUID();
  const rootChildren: string[] = [];

  // 导语节点
  const introId = crypto.randomUUID();
  nodes.push({
    id: introId,
    bookId,
    parentId: rootId,
    level: 1,
    title: '导语',
    content: DEMO_KNOWLEDGE_TREE.intro,
    summary: DEMO_KNOWLEDGE_TREE.coreLine,
    childrenIds: [],
    nodeType: 'intro',
  });
  rootChildren.push(introId);

  // content_markdown 节点
  const contentId = crypto.randomUUID();
  nodes.push({
    id: contentId,
    bookId,
    parentId: rootId,
    level: 1,
    title: '知识树正文',
    content: DEMO_KNOWLEDGE_TREE.contentMarkdown,
    childrenIds: [],
    nodeType: 'content_markdown',
  });
  rootChildren.push(contentId);

  // 收尾节点
  const closingId = crypto.randomUUID();
  nodes.push({
    id: closingId,
    bookId,
    parentId: rootId,
    level: 1,
    title: '收尾',
    content: DEMO_KNOWLEDGE_TREE.closing,
    childrenIds: [],
    nodeType: 'closing',
  });
  rootChildren.push(closingId);

  // 根节点
  nodes.push({
    id: rootId,
    bookId,
    parentId: null,
    level: 0,
    title: bookTitle,
    summary: DEMO_KNOWLEDGE_TREE.coreLine,
    content: DEMO_KNOWLEDGE_TREE.source,
    childrenIds: rootChildren,
    nodeType: 'overview',
  });

  return nodes;
}
