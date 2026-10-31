import { logger } from '@lark-apaas/client-toolkit/logger';

import { db } from './db';
import { aiService } from './ai';
import { buildDemoTree } from './demo-tree';
import { SAMPLE_ARTICLE } from '@client/src/data/sample-article';
import type {
  Book,
  Chapter,
  ElementType,
  KnowledgeNode,
  BookStatus,
  EntityItem,
  ParagraphRef,
} from '@client/src/types/book';
import type {
  KnowledgeTreeResult,
  KnowledgeTreeSection,
  KnowledgeTreeSubsection,
  KnowledgeTreePoint,
  KnowledgeTreeExample,
  KnowledgeTreeOriginalQuote,
} from './ai';

const COVER_COLORS = [
  '#E8B4B8',
  '#F0C6A8',
  '#D4C5A9',
  '#B8C9A8',
  '#A8C0B8',
  '#C4B8A8',
];

const DEMO_PERSONS = [
  '苏轼',
  '苏洵',
  '苏辙',
  '欧阳修',
  '王安石',
  '辛弃疾',
];
const DEMO_PLACES = ['杭州', '黄州', '惠州', '儋州', '常州', '眉山'];

export interface ProcessingOptions {
  useDemoTree?: boolean;
  forceRealAi?: boolean;
  onProgress?: (book: Book) => void;
}

interface BuildContext {
  bookId: string;
  chapters: Chapter[];
  bookTitle: string;
  nodes: KnowledgeNode[];
  idStack: string[];
}

class BookProcessor {
  private readonly processingBooks = new Set<string>();

  async addSampleBook(): Promise<Book> {
    const id = crypto.randomUUID();
    const book: Book = {
      id,
      title: SAMPLE_ARTICLE.title,
      author: SAMPLE_ARTICLE.author,
      source: 'sample',
      status: 'pending',
      progress: 0,
      coverColor: this.pickCoverColor(),
      isDemo: true,
      createdAt: Date.now(),
    };
    await db.books.add(book);
    logger.info('已添加示例书籍', book.title);
    return book;
  }

  async addZlibBook(title: string): Promise<Book> {
    const id = crypto.randomUUID();
    const book: Book = {
      id,
      title,
      author: '未知作者',
      source: 'zlib',
      status: 'pending',
      progress: 0,
      coverColor: this.pickCoverColor(),
      isDemo: false,
      createdAt: Date.now(),
    };
    await db.books.add(book);
    logger.info('已添加 zlib 书籍', book.title);
    return book;
  }

  async addManualBook(
    title: string,
    author: string,
    text: string,
  ): Promise<Book> {
    const id = crypto.randomUUID();
    const book: Book = {
      id,
      title: title.trim() || '未命名文本',
      author: author.trim() || '未知作者',
      source: 'manual',
      status: 'pending',
      progress: 0,
      coverColor: this.pickCoverColor(),
      isDemo: false,
      rawText: text,
      createdAt: Date.now(),
    };
    await db.books.add(book);
    logger.info('已添加手动导入书籍', book.title, `${text.length} 字`);
    return book;
  }

  async startProcessing(
    bookId: string,
    options: ProcessingOptions = {},
  ): Promise<void> {
    return this.resumeProcessing(bookId, { ...options, forceRestart: true });
  }

  async resumeProcessing(
    bookId: string,
    options: ProcessingOptions & { forceRestart?: boolean } = {},
  ): Promise<void> {
    const book = await db.books.get(bookId);
    if (!book) throw new Error('书籍不存在');

    if (this.processingBooks.has(bookId)) {
      logger.warn('书籍已在处理中，先取消再继续', bookId);
      this.cancelProcessing(bookId);
      await this.sleep(200);
    }

    this.processingBooks.add(bookId);
    await db.books.update(bookId, { isCancelled: false, errorMessage: '' });

    let currentChapters: Chapter[] = [];

    try {
      const existingChapters = await db.chapters.listByBook(bookId);
      const hasChapters = existingChapters.length > 0;
      const hasNodes = (await db.nodes.listByBook(bookId)).length > 0;

      if (options.forceRestart) {
        await db.chapters.clearByBook(bookId);
        await db.nodes.clearByBook(bookId);
        await db.entities.clearByBook(bookId);
        await db.books.update(bookId, {
          treeChunkProgress: 0,
          treeIntro: '',
          treeOverview: '',
          treeSource: '',
        });
      }

      if (options.forceRealAi) {
        await db.books.update(bookId, { isDemo: false });
      }

      const useDemo = options.forceRealAi
        ? false
        : options.useDemoTree ?? (await this.isDemoBook(bookId));

      const currentBook = await db.books.get(bookId);
      if (!currentBook) throw new Error('书籍不存在');

      let rawText = currentBook.rawText || '';
      let paragraphs: string[] = [];

      if (!rawText || options.forceRestart) {
        await this.updateStatus(bookId, 'downloading', 0, options);
        rawText = await this.stepDownload(bookId, options);
      } else {
        logger.info('断点续跑：跳过下载，已有 rawText', bookId);
      }

      if (this.isCancelled(bookId)) throw new Error('已取消');

      if (!hasChapters || options.forceRestart) {
        await this.updateStatus(bookId, 'parsing', 10, options);
        paragraphs = await this.stepParse(bookId, rawText, options);

        if (this.isCancelled(bookId)) throw new Error('已取消');

        await this.updateStatus(bookId, 'chapterizing', 25, options);
        currentChapters = await this.stepChapterize(bookId, paragraphs, options);
      } else {
        currentChapters = existingChapters.sort(
          (a: Chapter, b: Chapter) => a.index - b.index,
        );
        logger.info(
          `断点续跑：跳过解析和切章，已有 ${currentChapters.length} 章`,
          bookId,
        );
      }

      if (this.isCancelled(bookId)) throw new Error('已取消');

      const treeProgress = currentBook.treeChunkProgress ?? 0;
      const treeDone = currentBook.status === 'done' ||
        (hasNodes && treeProgress > 0 && this.isTreeComplete(currentBook));

      if (!treeDone || options.forceRestart) {
        await this.stepTreeIncremental(
          bookId,
          currentChapters,
          useDemo,
          options,
        );
      } else {
        logger.info('断点续跑：树生成已完成，跳过', bookId);
      }

      if (this.isCancelled(bookId)) throw new Error('已取消');

      const hasEntities = (await db.entities.listByBook(bookId)).length > 0;
      if (!hasEntities || options.forceRestart) {
        await this.stepEntity(bookId, currentChapters, useDemo, options);
      } else {
        logger.info('断点续跑：实体识别已完成，跳过', bookId);
        await db.books.update(bookId, {
          status: 'done',
          progress: 100,
          completedAt: Date.now(),
        });
        await this.notifyProgress(bookId, options.onProgress);
      }

      logger.info('书籍处理完成', bookId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      if (message === '已取消') {
        logger.info('书籍处理已取消', bookId);
        const b = await db.books.get(bookId);
        if (b && b.status !== 'done') {
          await db.books.update(bookId, {
            errorMessage: '已取消，可继续处理',
          });
        }
      } else {
        logger.error('书籍处理失败', bookId, message);
        await db.books.update(bookId, {
          status: 'error',
          errorMessage: message,
        });
      }
      await this.notifyProgress(bookId, options.onProgress);
      throw error;
    } finally {
      this.processingBooks.delete(bookId);
    }
  }

  cancelProcessing(bookId: string): void {
    if (!this.processingBooks.has(bookId)) return;
    void db.books.update(bookId, { isCancelled: true });
    logger.info('取消处理', bookId);
  }

  private isCancelled(bookId: string): boolean {
    const book = this.syncGetBook(bookId);
    return book?.isCancelled ?? false;
  }

  private syncGetBook(bookId: string): Book | undefined {
    try {
      const raw = localStorage.getItem('ai_reader_books');
      if (!raw) return undefined;
      const books = JSON.parse(raw) as Book[];
      return books.find((b: Book) => b.id === bookId);
    } catch {
      return undefined;
    }
  }

  private isTreeComplete(book: Book): boolean {
    return book.treeChunkProgress !== undefined && book.treeChunkProgress > 0
      ? false
      : false;
  }

  async deleteBook(bookId: string): Promise<void> {
    this.cancelProcessing(bookId);
    await db.books.remove(bookId);
    await db.chapters.clearByBook(bookId);
    await db.nodes.clearByBook(bookId);
    await db.entities.clearByBook(bookId);
    logger.info('已删除书籍', bookId);
  }

  private async stepDownload(
    bookId: string,
    options: ProcessingOptions,
  ): Promise<string> {
    await this.updateStatus(bookId, 'downloading', 0, options);

    const book = await db.books.get(bookId);
    if (!book) throw new Error('书籍不存在');

    let rawText: string;

    if (book.source === 'sample') {
      rawText = SAMPLE_ARTICLE.text;
    } else if (book.source === 'manual' && book.rawText) {
      rawText = book.rawText;
    } else {
      await this.sleep(2000);
      rawText = this.generatePlaceholderText(book.title);
    }

    await db.books.update(bookId, { rawText });
    await this.updateStatus(bookId, 'downloading', 10, options);

    return rawText;
  }

  private async stepParse(
    bookId: string,
    rawText: string,
    options: ProcessingOptions,
  ): Promise<string[]> {
    await this.updateStatus(bookId, 'parsing', 10, options);
    await this.sleep(800);

    const paragraphs = rawText
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0);

    await this.updateStatus(bookId, 'parsing', 25, options);
    return paragraphs;
  }

  private async stepChapterize(
    bookId: string,
    paragraphs: string[],
    options: ProcessingOptions,
  ): Promise<Chapter[]> {
    await this.updateStatus(bookId, 'chapterizing', 25, options);
    await this.sleep(800);

    const chapters: Chapter[] = this.chunkIntoChapters(bookId, paragraphs);
    await db.chapters.bulkAdd(chapters);

    await this.updateStatus(bookId, 'chapterizing', 40, options);
    return chapters;
  }

  private chunkIntoChapters(
    bookId: string,
    paragraphs: string[],
  ): Chapter[] {
    const total = paragraphs.length;
    if (total === 0) return [];

    let chapterCount: number;
    if (total >= 5) {
      chapterCount = Math.min(5, Math.max(3, Math.ceil(total / 2)));
    } else {
      chapterCount = total;
    }

    const parasPerChapter = Math.ceil(total / chapterCount);
    const chapters: Chapter[] = [];

    for (let i = 0; i < chapterCount; i++) {
      const start = i * parasPerChapter;
      const end = Math.min(start + parasPerChapter, total);
      const chapterParas = paragraphs.slice(start, end);
      if (chapterParas.length === 0) continue;

      const firstSentence = chapterParas[0].slice(0, 20);
      chapters.push({
        id: crypto.randomUUID(),
        bookId,
        title: `第${i + 1}章 ${firstSentence}`,
        index: i,
        paragraphs: chapterParas,
      });
    }

    return chapters;
  }

  private async stepTree(
    bookId: string,
    chapters: Chapter[],
    useDemoTree: boolean,
    options: ProcessingOptions,
  ): Promise<void> {
    await this.updateStatus(bookId, 'tree_generating', 40, options);

    const book = await db.books.get(bookId);
    if (!book) throw new Error('书籍不存在');

    let nodes: KnowledgeNode[];

    if (useDemoTree) {
      nodes = buildDemoTree(bookId, chapters, book.title);
      await this.sleep(1000);
    } else {
      nodes = await this.generateTreeWithAi(bookId, chapters, book.title, book.author);
    }

    await db.nodes.bulkAdd(nodes);
    await this.updateStatus(bookId, 'tree_generating', 80, options);
  }

  private async stepTreeIncremental(
    bookId: string,
    chapters: Chapter[],
    useDemoTree: boolean,
    options: ProcessingOptions,
  ): Promise<void> {
    await this.updateStatus(bookId, 'tree_generating', 40, options);

    const book = await db.books.get(bookId);
    if (!book) throw new Error('书籍不存在');

    if (useDemoTree) {
      const nodes = buildDemoTree(bookId, chapters, book.title);
      await this.sleep(1000);
      await db.nodes.bulkAdd(nodes);
      await db.books.update(bookId, { treeChunkProgress: 1 });
      await this.updateStatus(bookId, 'tree_generating', 80, options);
      return;
    }

    const startChunk = book.treeChunkProgress ?? 0;
    const chapterInputs = chapters.map((c: Chapter) => ({
      title: c.title,
      text: c.paragraphs.join('\n'),
    }));

    let lastProgress = 40;
    const existingSections: KnowledgeTreeSection[] = [];

    if (startChunk > 0) {
      const existingNodes = await db.nodes.listByBook(bookId);
      if (existingNodes.length === 0) {
        logger.warn(
          `断点续跑：treeChunkProgress=${startChunk} 但节点为空，重置为0`,
          bookId,
        );
        await db.books.update(bookId, { treeChunkProgress: 0 });
      } else {
        const tempRootId = `temp_root_${bookId}`;
        for (const node of existingNodes) {
          if (node.parentId === tempRootId && node.nodeType === 'section') {
            existingSections.push({
              title: node.title,
              subsections: [],
            });
          }
        }
        logger.info(
          `断点续跑：树已完成 ${startChunk} 块，已有 ${existingSections.length} 个 section`,
          bookId,
        );
      }
    }

    const result = await aiService.generateKnowledgeTreeIncremental(
      chapterInputs,
      { title: book.title, author: book.author },
      {
        startChunkIndex: startChunk,
        existingSections,
        existingIntro: book.treeIntro,
        existingCoreLine: book.treeOverview,
        existingSource: book.treeSource,
        onProgress: (current: number, total: number, phase: string) => {
          const progress = 40 + Math.floor((current / total) * 38);
          if (progress > lastProgress) {
            lastProgress = progress;
            void db.books.update(bookId, { progress }).catch(() => {});
          }
          logger.info(phase, `${current}/${total}`);
        },
        onChunkComplete: async (chunkIndex: number, chunkResult: Pick<KnowledgeTreeResult, 'sections'> & Partial<KnowledgeTreeResult>) => {
          if (this.isCancelled(bookId)) return;

          const chunkNodes: KnowledgeNode[] = [];
          const tempRootId = `temp_root_${bookId}`;

          for (const section of chunkResult.sections) {
            this.buildSection(
              chunkNodes,
              bookId,
              tempRootId,
              section,
              chapters,
            );
          }

          await db.nodes.bulkAdd(chunkNodes);

          const patch: Partial<Book> = { treeChunkProgress: chunkIndex + 1 };
          if (chunkIndex === 0) {
            patch.treeIntro = chunkResult.intro || '';
            patch.treeOverview = chunkResult.coreLine || '';
            patch.treeSource = chunkResult.source || '';
          }
          await db.books.update(bookId, patch);
        },
      },
    );

    if (this.isCancelled(bookId)) throw new Error('已取消');

    await db.nodes.clearByBook(bookId);
    const allNodes = this.buildKnowledgeNodesFromResult(
      bookId,
      chapters,
      book.title,
      result,
    );
    await db.nodes.bulkAdd(allNodes);
    await this.updateStatus(bookId, 'tree_generating', 80, options);
  }

  private async generateTreeWithAi(
    bookId: string,
    chapters: Chapter[],
    bookTitle: string,
    bookAuthor: string,
  ): Promise<KnowledgeNode[]> {
    const chapterInputs = chapters.map((c: Chapter) => ({
      title: c.title,
      text: c.paragraphs.join('\n'),
    }));

    let lastProgress = 40;

    const result = await aiService.generateKnowledgeTreeFromChapters(
      chapterInputs,
      { title: bookTitle, author: bookAuthor },
      (current: number, total: number, phase: string) => {
        const progress = 40 + Math.floor((current / total) * 38);
        if (progress > lastProgress) {
          lastProgress = progress;
          void db.books.update(bookId, { progress }).catch(() => {});
        }
        logger.info(phase, `${current}/${total}`);
      },
    );

    return this.buildKnowledgeNodesFromResult(bookId, chapters, bookTitle, result);
  }

  private buildKnowledgeNodesFromResult(
    bookId: string,
    chapters: Chapter[],
    bookTitle: string,
    result: KnowledgeTreeResult,
  ): KnowledgeNode[] {
    const nodes: KnowledgeNode[] = [];
    const rootId = crypto.randomUUID();
    const rootChildren: string[] = [];

    const introId = this.pushIntroNode(nodes, bookId, rootId, result);
    if (introId) rootChildren.push(introId);

    for (const section of result.sections) {
      const sectionId = this.buildSection(nodes, bookId, rootId, section, chapters);
      rootChildren.push(sectionId);
    }

    const closingId = this.pushClosingNode(
      nodes,
      bookId,
      rootId,
      result,
    );
    if (closingId) rootChildren.push(closingId);

    nodes.push({
      id: rootId,
      bookId,
      parentId: null,
      level: 0,
      title: bookTitle,
      summary: result.coreLine,
      content: result.source,
      childrenIds: rootChildren,
      nodeType: 'overview',
    });

    return nodes;
  }

  private pushIntroNode(
    nodes: KnowledgeNode[],
    bookId: string,
    rootId: string,
    result: KnowledgeTreeResult,
  ): string | null {
    if (!result.intro && !result.coreLine) return null;

    const introId = crypto.randomUUID();
    nodes.push({
      id: introId,
      bookId,
      parentId: rootId,
      level: 1,
      title: '导语',
      content: result.intro || result.coreLine,
      summary: result.coreLine,
      childrenIds: [],
      nodeType: 'intro',
    });
    return introId;
  }

  private buildSection(
    nodes: KnowledgeNode[],
    bookId: string,
    parentId: string,
    section: KnowledgeTreeSection,
    chapters: Chapter[],
  ): string {
    const sectionId = crypto.randomUUID();
    const subsectionIds: string[] = [];

    for (const sub of section.subsections) {
      const subId = this.buildSubsection(nodes, bookId, sectionId, sub, chapters);
      subsectionIds.push(subId);
    }

    nodes.push({
      id: sectionId,
      bookId,
      parentId,
      level: 1,
      title: section.title,
      childrenIds: subsectionIds,
      nodeType: 'section',
    });

    return sectionId;
  }

  private buildSubsection(
    nodes: KnowledgeNode[],
    bookId: string,
    parentId: string,
    sub: KnowledgeTreeSubsection,
    chapters: Chapter[],
  ): string {
    const subId = crypto.randomUUID();
    const childIds: string[] = [];

    for (const point of sub.points) {
      const pointId = this.buildPoint(nodes, bookId, subId, point, chapters);
      childIds.push(pointId);
    }

    // 原文句群节点（挂在 subsection 下，level 2）
    if (sub.originalQuotes && sub.originalQuotes.length > 0) {
      const quoteGroupId = this.buildOriginalQuoteGroup(
        nodes,
        bookId,
        subId,
        sub.originalQuotes,
        chapters,
      );
      childIds.push(quoteGroupId);
    }

    nodes.push({
      id: subId,
      bookId,
      parentId,
      level: 2,
      title: sub.title,
      content: sub.intro,
      childrenIds: childIds,
      nodeType: 'point',
    });

    return subId;
  }

  private buildPoint(
    nodes: KnowledgeNode[],
    bookId: string,
    parentId: string,
    point: KnowledgeTreePoint,
    chapters: Chapter[],
  ): string {
    const pointId = crypto.randomUUID();
    const exampleIds: string[] = [];

    const examples = point.examples ?? [];
    for (const example of examples) {
      const exampleId = this.buildExample(nodes, bookId, pointId, example, chapters);
      exampleIds.push(exampleId);
    }

    nodes.push({
      id: pointId,
      bookId,
      parentId,
      level: 3,
      title: point.title,
      content: point.content,
      childrenIds: exampleIds,
      nodeType: 'subpoint',
    });

    return pointId;
  }

  private buildExample(
    nodes: KnowledgeNode[],
    bookId: string,
    parentId: string,
    example: KnowledgeTreeExample,
    chapters: Chapter[],
  ): string {
    const exampleId = crypto.randomUUID();

    const paragraphRefs: ParagraphRef[] = [];
    const located = this.locateSnippet(example.content, chapters);
    if (located) {
      paragraphRefs.push(located);
    }

    nodes.push({
      id: exampleId,
      bookId,
      parentId,
      level: 4,
      title: example.title,
      content: example.content,
      childrenIds: [],
      paragraphRefs,
      nodeType: 'element',
      elementType: example.type as ElementType,
    });

    return exampleId;
  }

  private buildOriginalQuoteGroup(
    nodes: KnowledgeNode[],
    bookId: string,
    parentId: string,
    quotes: KnowledgeTreeOriginalQuote[],
    chapters: Chapter[],
  ): string {
    const groupId = crypto.randomUUID();
    const quoteIds: string[] = [];

    for (const quote of quotes) {
      const quoteId = this.buildOriginalQuote(
        nodes,
        bookId,
        groupId,
        quote,
        chapters,
      );
      quoteIds.push(quoteId);
    }

    nodes.push({
      id: groupId,
      bookId,
      parentId,
      level: 2,
      title: '原文句群',
      childrenIds: quoteIds,
      nodeType: 'original_quote_group',
    });

    return groupId;
  }

  private buildOriginalQuote(
    nodes: KnowledgeNode[],
    bookId: string,
    parentId: string,
    quote: KnowledgeTreeOriginalQuote,
    chapters: Chapter[],
  ): string {
    const quoteId = crypto.randomUUID();

    const paragraphRefs: ParagraphRef[] = [];
    const located = this.locateSnippet(quote.text, chapters);
    if (located) {
      paragraphRefs.push(located);
    } else {
      // 尝试按章节标题定位
      const matchedChapter = chapters.find(
        (c: Chapter) => c.title === quote.chapterTitle,
      );
      if (matchedChapter) {
        paragraphRefs.push({
          chapterId: matchedChapter.id,
          paragraphIndex: 0,
          text: quote.text,
          located: false,
        });
      }
    }

    nodes.push({
      id: quoteId,
      bookId,
      parentId,
      level: 3,
      title: quote.text.length > 30 ? quote.text.slice(0, 30) + '…' : quote.text,
      content: quote.text,
      childrenIds: [],
      paragraphRefs,
      nodeType: 'original_quote',
      quoteChapter: quote.chapterTitle || undefined,
    });

    return quoteId;
  }

  private locateSnippet(
    snippet: string,
    chapters: Chapter[],
  ): ParagraphRef | null {
    const cleanSnippet = snippet.trim().replace(/[""'']「」""''/g, '');
    if (cleanSnippet.length < 4) return null;

    let bestMatch: { chapter: Chapter; paraIndex: number; score: number } | null =
      null;

    for (const chapter of chapters) {
      for (let i = 0; i < chapter.paragraphs.length; i++) {
        const para = chapter.paragraphs[i];
        const score = this.computeMatchScore(cleanSnippet, para);
        if (score > 0.4 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { chapter, paraIndex: i, score };
        }
      }
    }

    if (bestMatch && bestMatch.score >= 0.5) {
      return {
        chapterId: bestMatch.chapter.id,
        paragraphIndex: bestMatch.paraIndex,
        text: snippet,
        located: true,
      };
    }

    return null;
  }

  private computeMatchScore(snippet: string, paragraph: string): number {
    if (paragraph.includes(snippet)) {
      return 1;
    }

    const snippetChars = [...new Set(snippet.replace(/\s/g, ''))];
    const paraChars = new Set(paragraph.replace(/\s/g, ''));
    if (snippetChars.length === 0) return 0;

    let matchCount = 0;
    for (const ch of snippetChars) {
      if (paraChars.has(ch)) matchCount++;
    }
    const charOverlap = matchCount / snippetChars.length;

    const snippetWords = snippet.split(/[，。、；：""''\s]+/).filter(Boolean);
    let wordHits = 0;
    for (const w of snippetWords) {
      if (w.length >= 2 && paragraph.includes(w)) wordHits++;
    }
    const wordHitRate = snippetWords.length > 0 ? wordHits / snippetWords.length : 0;

    return charOverlap * 0.4 + wordHitRate * 0.6;
  }

  private pushClosingNode(
    nodes: KnowledgeNode[],
    bookId: string,
    rootId: string,
    result: KnowledgeTreeResult,
  ): string | null {
    if (!result.closing) return null;

    const closingId = crypto.randomUUID();
    nodes.push({
      id: closingId,
      bookId,
      parentId: rootId,
      level: 1,
      title: '收尾',
      content: result.closing,
      childrenIds: [],
      nodeType: 'closing',
    });
    return closingId;
  }

  private async stepEntity(
    bookId: string,
    chapters: Chapter[],
    isDemo: boolean,
    options: ProcessingOptions,
  ): Promise<void> {
    await this.updateStatus(bookId, 'entity_matching', 80, options);

    if (isDemo) {
      const entities = this.extractDemoEntities(bookId, chapters);
      if (entities.length > 0) {
        await db.entities.bulkAdd(entities);
      }
      await this.sleep(400);
    } else {
      try {
        const fullText = chapters
          .map((c: Chapter) => c.paragraphs.join('\n'))
          .join('\n\n');
        await aiService.identifyEntities(fullText);
      } catch (error) {
        logger.warn('实体识别跳过', bookId, error);
      }
    }

    await db.books.update(bookId, {
      status: 'done',
      progress: 100,
      completedAt: Date.now(),
    });
    await this.notifyProgress(bookId, options.onProgress);
  }

  private extractDemoEntities(
    bookId: string,
    chapters: Chapter[],
  ): EntityItem[] {
    const entities: EntityItem[] = [];

    const searchAndCollect = (
      name: string,
      type: 'person' | 'place',
    ): EntityItem | null => {
      const occurrences: {
        chapterId: string;
        paragraphIndex: number;
      }[] = [];

      for (const chapter of chapters) {
        for (let i = 0; i < chapter.paragraphs.length; i++) {
          if (chapter.paragraphs[i].includes(name)) {
            occurrences.push({ chapterId: chapter.id, paragraphIndex: i });
          }
        }
      }

      if (occurrences.length === 0) return null;

      return {
        id: crypto.randomUUID(),
        bookId,
        name,
        type,
        occurrences,
      };
    };

    for (const person of DEMO_PERSONS) {
      const entity = searchAndCollect(person, 'person');
      if (entity) entities.push(entity);
    }
    for (const place of DEMO_PLACES) {
      const entity = searchAndCollect(place, 'place');
      if (entity) entities.push(entity);
    }

    return entities;
  }

  private pickCoverColor(): string {
    return COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)];
  }

  private async isDemoBook(bookId: string): Promise<boolean> {
    const book = await db.books.get(bookId);
    return book?.isDemo ?? false;
  }

  private async updateStatus(
    bookId: string,
    status: BookStatus,
    progress: number,
    options: ProcessingOptions,
  ): Promise<void> {
    await db.books.update(bookId, { status, progress });
    await this.notifyProgress(bookId, options.onProgress);
  }

  private async notifyProgress(
    bookId: string,
    onProgress?: (book: Book) => void,
  ): Promise<void> {
    if (!onProgress) return;
    const book = await db.books.get(bookId);
    if (book) onProgress(book);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private generatePlaceholderText(title: string): string {
    return `《${title}》\n\n这是《${title}》的占位内容。当前为演示模式，书籍内容从书源下载后将展示完整文本。\n\n第一章\n\n在很久很久以前，有一个关于${title}的故事。故事的主人公经历了许多冒险，结识了志同道合的伙伴，也遭遇了意想不到的挑战。\n\n第二章\n\n随着故事的发展，主人公逐渐成长。他/她不仅学会了新的技能，更重要的是理解了责任与担当的意义。每一次选择都塑造着未来的道路。\n\n第三章\n\n高潮来临。面对最大的考验，主人公必须做出艰难的决定。朋友的支持、内心的勇气、以及一路走来积累的经验，将在这一刻汇聚成力量。\n\n第四章\n\n故事终将迎来结局。无论结果如何，这段旅程都将成为永恒的记忆。那些人、那些事、那些感动与思考，都将在时光中沉淀为宝贵的财富。\n\n结语\n\n每一本书都是一扇窗，通向不同的世界。愿你在阅读中找到属于自己的光。`;
  }
}

export const bookProcessor = new BookProcessor();
