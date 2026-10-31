import { useState, useEffect, useCallback } from 'react';
import { db } from '@client/src/services/db';
import type { KnowledgeNode, Chapter, Book } from '@client/src/types/book';

export interface ReaderData {
  book: Book | null;
  chapters: Chapter[];
  nodes: KnowledgeNode[];
  rootNode: KnowledgeNode | null;
  loading: boolean;
}

export function useReader(bookId: string | null) {
  const [data, setData] = useState<ReaderData>({
    book: null,
    chapters: [],
    nodes: [],
    rootNode: null,
    loading: true,
  });

  const load = useCallback(async (id: string) => {
    setData((prev) => ({ ...prev, loading: true }));
    const [book, chapters, nodes] = await Promise.all([
      db.books.get(id),
      db.chapters.listByBook(id),
      db.nodes.listByBook(id),
    ]);

    const sortedNodes = [...nodes]
      .filter((n: KnowledgeNode) => {
        if (n.nodeType === 'action_list' || n.nodeType === 'action_item') return false;
        if (n.level === 1) {
          const legacyTitles = ['总结与行动', '金句收束', '一句话总结', '行动清单'];
          if (legacyTitles.includes(n.title)) return false;
        }
        return true;
      })
      .sort(
        (a: KnowledgeNode, b: KnowledgeNode) => a.level - b.level,
      );
    const rootNode = sortedNodes.find((n: KnowledgeNode) => n.level === 0) || null;

    setData({
      book: book || null,
      chapters: chapters.sort((a: Chapter, b: Chapter) => a.index - b.index),
      nodes: sortedNodes,
      rootNode,
      loading: false,
    });
  }, []);

  useEffect(() => {
    if (bookId) {
      load(bookId);
    } else {
      setData({
        book: null,
        chapters: [],
        nodes: [],
        rootNode: null,
        loading: false,
      });
    }
  }, [bookId, load]);

  const refresh = useCallback(() => {
    if (bookId) return load(bookId);
  }, [bookId, load]);

  return { ...data, refresh };
}

export function getNodeChildren(
  allNodes: KnowledgeNode[],
  parentId: string,
): KnowledgeNode[] {
  return allNodes.filter((n: KnowledgeNode) => n.parentId === parentId);
}

export function isLeafNode(node: KnowledgeNode): boolean {
  return node.childrenIds.length === 0;
}
