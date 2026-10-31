import { DEMO_KNOWLEDGE_TREE } from '@client/src/data/sample-article';
import type {
  Chapter,
  ElementType,
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

  // 板块节点
  for (const section of DEMO_KNOWLEDGE_TREE.sections) {
    const sectionId = crypto.randomUUID();
    const subIds: string[] = [];

    for (const sub of section.subsections) {
      const subId = crypto.randomUUID();
      const childIds: string[] = [];

      // 要点（subpoint，level 3）
      for (const point of sub.points) {
        const pointId = crypto.randomUUID();
        const exampleIds: string[] = [];

        const examples = point.examples ?? [];
        for (const example of examples) {
          const elementId = crypto.randomUUID();
          nodes.push({
            id: elementId,
            bookId,
            parentId: pointId,
            level: 4,
            title: example.title,
            content: example.content,
            childrenIds: [],
            nodeType: 'element',
            elementType: example.type as ElementType,
          });
          exampleIds.push(elementId);
        }

        nodes.push({
          id: pointId,
          bookId,
          parentId: subId,
          level: 3,
          title: point.title,
          content: point.content,
          childrenIds: exampleIds,
          nodeType: 'subpoint',
        });
        childIds.push(pointId);
      }

      // 原文句群组节点（level 2，挂在 subsection 下）
      if (sub.originalQuotes && sub.originalQuotes.length > 0) {
        const quoteGroupId = crypto.randomUUID();
        const quoteIds: string[] = [];

        for (const quote of sub.originalQuotes) {
          const quoteId = crypto.randomUUID();

          // 尝试按章节标题定位 paragraphRef
          const matchedChapter = chapters.find(
            (c: Chapter) => c.title === quote.chapterTitle,
          );
          const paragraphRefs = matchedChapter
            ? [
                {
                  chapterId: matchedChapter.id,
                  paragraphIndex: 0,
                  text: quote.text,
                  located: false,
                },
              ]
            : undefined;

          nodes.push({
            id: quoteId,
            bookId,
            parentId: quoteGroupId,
            level: 3,
            title: '',
            content: quote.text,
            childrenIds: [],
            paragraphRefs,
            nodeType: 'original_quote',
            quoteChapter: quote.chapterTitle,
          });
          quoteIds.push(quoteId);
        }

        nodes.push({
          id: quoteGroupId,
          bookId,
          parentId: subId,
          level: 2,
          title: '原文句群',
          childrenIds: quoteIds,
          nodeType: 'original_quote_group',
        });
        childIds.push(quoteGroupId);
      }

      // subsection 节点（level 2，nodeType 'point'）
      nodes.push({
        id: subId,
        bookId,
        parentId: sectionId,
        level: 2,
        title: sub.title,
        content: sub.intro,
        childrenIds: childIds,
        nodeType: 'point',
      });
      subIds.push(subId);
    }

    nodes.push({
      id: sectionId,
      bookId,
      parentId: rootId,
      level: 1,
      title: section.title,
      summary: section.overview,
      childrenIds: subIds,
      nodeType: 'section',
    });
    rootChildren.push(sectionId);
  }

  // 收尾节点（level 1，独立节点）
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
