import { logger } from '@lark-apaas/client-toolkit/logger';
import { storage } from './storage';
import treeRules from '../rules/knowledge-tree.md?raw';

export interface AiConfig {
  apiKey: string | null;
  baseUrl: string;
}

export interface KnowledgeTreeExample {
  title: string;
  content: string;
  type: 'example' | 'experiment' | 'case' | 'data';
}

export interface KnowledgeTreePoint {
  title: string;
  content: string;
  pointType?: 'definition' | 'mechanism' | 'experiment' | 'case' | 'data' | 'phenomenon' | 'conclusion';
  examples?: KnowledgeTreeExample[];
}

export interface KnowledgeTreeOriginalQuote {
  text: string;
  chapterTitle: string;
}

export interface KnowledgeTreeSubsection {
  title: string;
  intro?: string;
  points: KnowledgeTreePoint[];
  originalQuotes: KnowledgeTreeOriginalQuote[];
}

export interface KnowledgeTreeSection {
  title: string;
  overview?: string;
  subsections: KnowledgeTreeSubsection[];
}

export interface KnowledgeTreeResult {
  source: string;
  intro: string;
  coreLine: string;
  /** 知识树主体内容，markdown 格式（替代原 sections 数组） */
  contentMarkdown: string;
  closing: string;
  /** 是否被截断（全文超出上下文窗口时标注） */
  truncated?: boolean;
  /** 覆盖范围说明（截断时说明处理了哪些内容） */
  coverageNote?: string;
}

class AiService {
  private baseUrl = 'https://api.deepseek.com/v1';
  /** 单次请求最大字符数估算（DeepSeek-V3 约 64K tokens，留余量给 system prompt 和输出） */
  private readonly MAX_INPUT_CHARS = 24000;

  getConfig(): AiConfig {
    return {
      apiKey: storage.getApiKey(),
      baseUrl: this.baseUrl,
    };
  }

  isConfigured(): boolean {
    return storage.hasApiKey();
  }

  getMaxInputChars(): number {
    return this.MAX_INPUT_CHARS;
  }

  /** 单次请求总超时时间（毫秒），从发起到流结束 */
  private readonly REQUEST_TIMEOUT_MS = 120000;
  /** 流式读取无数据看门狗（毫秒），超过该时间未收到新数据块则中止 */
  private readonly IDLE_TIMEOUT_MS = 60000;

  async chat(
    messages: { role: string; content: string }[],
    temperature: number = 0.7,
    maxTokens: number = 4096,
  ): Promise<string> {
    const config = this.getConfig();
    if (!config.apiKey) {
      throw new Error('API_KEY_NOT_CONFIGURED');
    }

    const controller = new AbortController();
    const totalTimeoutMs = this.REQUEST_TIMEOUT_MS;
    const idleTimeoutMs = this.IDLE_TIMEOUT_MS;
    const startTime = Date.now();
    let lastDataTime = startTime;
    let totalTimer: ReturnType<typeof setTimeout> | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = (): void => {
      if (totalTimer) { clearTimeout(totalTimer); totalTimer = null; }
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    };

    const doAbort = (reason: string): void => {
      clearTimers();
      if (!controller.signal.aborted) {
        const elapsed = Date.now() - startTime;
        logger.error(`[AI] chat ${reason}，耗时=${elapsed}ms，触发 abort`);
        controller.abort(reason);
      }
    };

    logger.error(
      `[AI] chat 开始，流式请求，总超时=${totalTimeoutMs}ms，空闲超时=${idleTimeoutMs}ms，max_tokens=${maxTokens}`,
    );

    totalTimer = setTimeout(() => {
      doAbort('总超时');
    }, totalTimeoutMs);

    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: true,
        }),
        signal: controller.signal,
      });

      const headerElapsed = Date.now() - startTime;
      logger.info(`[AI] chat 响应头已收到，耗时=${headerElapsed}ms，status=${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        clearTimers();
        throw new Error(`API 请求失败: ${response.status} ${errorText}`);
      }

      if (!response.body) {
        clearTimers();
        throw new Error('响应体为空，无法读取流式数据');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let fullContent = '';
      let chunkCount = 0;
      let emptyChunkStreak = 0;
      const MAX_EMPTY_CHUNKS = 50;
      const YIELD_EVERY_CHUNKS = 20;

      idleTimer = setTimeout(() => {
        doAbort('空闲超时（无数据）');
      }, idleTimeoutMs);

      while (true) {
        const now = Date.now();
        const elapsed = now - startTime;
        const idleElapsed = now - lastDataTime;

        if (elapsed >= totalTimeoutMs) {
          logger.error(`[AI] chat 总超时（循环内同步检测），耗时=${elapsed}ms`);
          controller.abort('总超时');
          throw new Error(
            `AI 请求超时（${Math.floor(totalTimeoutMs / 1000)}秒未响应），请检查网络或稍后重试`,
          );
        }

        if (idleElapsed >= idleTimeoutMs) {
          logger.error(
            `[AI] chat 空闲超时（循环内同步检测），距上一数据块${idleElapsed}ms，总耗时=${elapsed}ms`,
          );
          controller.abort('空闲超时（无数据）');
          throw new Error(
            `AI 请求超时（${Math.floor(totalTimeoutMs / 1000)}秒未响应），请检查网络或稍后重试`,
          );
        }

        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        const chunkLen = value ? value.byteLength : 0;
        if (chunkLen === 0) {
          emptyChunkStreak += 1;
          if (emptyChunkStreak >= MAX_EMPTY_CHUNKS) {
            const elapsedAtEmpty = Date.now() - startTime;
            logger.error(
              `[AI] chat 连续${MAX_EMPTY_CHUNKS}个空数据块，判定为流异常，耗时=${elapsedAtEmpty}ms`,
            );
            controller.abort('连续空数据块');
            throw new Error('AI 响应流异常停滞（连续空数据块），请稍后重试');
          }
        } else {
          emptyChunkStreak = 0;
          lastDataTime = Date.now();
          chunkCount += 1;

          if (idleTimer) {
            clearTimeout(idleTimer);
          }
          idleTimer = setTimeout(() => {
            doAbort('空闲超时（无数据）');
          }, idleTimeoutMs);
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) {
            continue;
          }
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') {
            clearTimers();
            const totalMs = Date.now() - startTime;
            logger.info(
              `[AI] chat 流式完成，总耗时=${totalMs}ms，总字数=${fullContent.length}，数据块数=${chunkCount}`,
            );
            return fullContent;
          }

          try {
            const data = JSON.parse(dataStr) as {
              choices?: { delta?: { content?: string } }[];
            };
            const delta = data.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullContent += delta;
            }
          } catch {
            // 忽略解析失败的行
          }
        }

        if (chunkCount > 0 && chunkCount % YIELD_EVERY_CHUNKS === 0) {
          await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
        }
      }

      clearTimers();
      const totalMs = Date.now() - startTime;
      logger.info(
        `[AI] chat 流结束（非DONE），总耗时=${totalMs}ms，总字数=${fullContent.length}，数据块数=${chunkCount}`,
      );
      return fullContent;
    } catch (err: unknown) {
      clearTimers();
      const elapsed = Date.now() - startTime;

      if (
        err instanceof DOMException &&
        err.name === 'AbortError'
      ) {
        logger.error(`[AI] chat AbortError，耗时=${elapsed}ms`);
        throw new Error(
          `AI 请求超时（${Math.floor(totalTimeoutMs / 1000)}秒未响应），请检查网络或稍后重试`,
        );
      }

      logger.error(`[AI] chat 出错，耗时=${elapsed}ms，err=${String(err)}`);
      throw err;
    }
  }

  /** 每块目标字符数（输入侧，约 5000 字） */
  private readonly CHUNK_TARGET_CHARS = 5000;
  /** 单块最大输入字符（硬上限） */
  private readonly CHUNK_MAX_CHARS = 6000;
  /** 每块输出上限（DeepSeek 支持 8192，控制在 4500 确保不会因输出过长挂起或截断） */
  private readonly CHUNK_MAX_OUTPUT_TOKENS = 4500;
  /** 单块失败最多重试次数（含首次共 3 次机会） */
  private readonly CHUNK_MAX_RETRY = 2;

  async generateKnowledgeTree(
    fullText: string,
    meta?: { title?: string; author?: string },
  ): Promise<KnowledgeTreeResult> {
    const chapters: Array<{ title: string; text: string }> = [
      { title: '全文', text: fullText },
    ];
    return this.generateKnowledgeTreeFromChapters(chapters, meta);
  }

  async generateKnowledgeTreeFromChapters(
    chapters: Array<{ title: string; text: string }>,
    meta?: { title?: string; author?: string },
    onProgress?: (current: number, total: number, phase: string) => void,
  ): Promise<KnowledgeTreeResult> {
    const config = this.getConfig();
    if (!config.apiKey) {
      throw new Error('API_KEY_NOT_CONFIGURED');
    }

    const chunks = this.chunkChapters(chapters);
    const totalSteps = chunks.length + 1; // chunks + closing
    let contentMarkdown = '';
    let intro = '';
    let coreLine = '';
    let source = '';
    let truncated = false;
    let coverageNote = '';

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isFirst = i === 0;
      onProgress?.(i + 1, totalSteps, `生成知识树（${i + 1}/${chunks.length}）`);

      let chunkResult: Pick<KnowledgeTreeResult, 'contentMarkdown'> & Partial<KnowledgeTreeResult> | null = null;
      let lastError: Error | null = null;
      for (let attempt = 0; attempt <= this.CHUNK_MAX_RETRY; attempt++) {
        try {
          const response = await this.generateChunk(
            chunk,
            i + 1,
            chunks.length,
            meta,
            isFirst,
          );
          chunkResult = this.parseChunkResult(response, isFirst);
          lastError = null;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          logger.warn(
            `知识树第 ${i + 1}/${chunks.length} 块第 ${attempt + 1} 次失败`,
            lastError.message,
          );
          logger.error(`[AI] 知识树第 ${i + 1}/${chunks.length} 块第 ${attempt + 1} 次失败：${lastError.message}`);
          if (attempt < this.CHUNK_MAX_RETRY) {
            await this.sleep(800);
          }
        }
      }
      if (lastError || !chunkResult) {
        throw new Error(
          `知识树第 ${i + 1}/${chunks.length} 块生成失败（已重试 ${this.CHUNK_MAX_RETRY} 次）：${lastError?.message}`,
        );
      }

      if (isFirst) {
        intro = chunkResult.intro || '';
        coreLine = chunkResult.coreLine || '';
        source = chunkResult.source || '';
      }

      if (chunkResult.truncated) {
        truncated = true;
      }
      if (chunkResult.coverageNote) {
        coverageNote = chunkResult.coverageNote;
      }

      if (chunkResult.contentMarkdown) {
        contentMarkdown = contentMarkdown
          ? `${contentMarkdown}\n\n${chunkResult.contentMarkdown}`
          : chunkResult.contentMarkdown;
      }
    }

    onProgress?.(chunks.length + 1, totalSteps, '合并结果');

    return {
      source,
      intro,
      coreLine,
      contentMarkdown,
      closing: '',
      truncated: truncated || undefined,
      coverageNote: coverageNote || undefined,
    };
  }

  async generateKnowledgeTreeIncremental(
    chapters: Array<{ title: string; text: string }>,
    meta?: { title?: string; author?: string },
    options?: {
      startChunkIndex?: number;
      onChunkComplete?: (chunkIndex: number, chunkResult: Pick<KnowledgeTreeResult, 'contentMarkdown'> & Partial<KnowledgeTreeResult>) => void;
      onProgress?: (current: number, total: number, phase: string) => void;
      existingIntro?: string;
      existingCoreLine?: string;
      existingSource?: string;
      existingContentMarkdown?: string;
    },
  ): Promise<KnowledgeTreeResult> {
    const config = this.getConfig();
    if (!config.apiKey) {
      throw new Error('API_KEY_NOT_CONFIGURED');
    }

    const chunks = this.chunkChapters(chapters);
    const startIdx = options?.startChunkIndex ?? 0;
    const totalSteps = chunks.length + 1;

    let intro = options?.existingIntro ?? '';
    let coreLine = options?.existingCoreLine ?? '';
    let source = options?.existingSource ?? '';
    let contentMarkdown = options?.existingContentMarkdown ?? '';
    let truncated = false;
    let coverageNote = '';

    for (let i = startIdx; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isFirst = i === 0;
      options?.onProgress?.(i + 1, totalSteps, `生成知识树（${i + 1}/${chunks.length}）`);

      let chunkResult: Pick<KnowledgeTreeResult, 'contentMarkdown'> & Partial<KnowledgeTreeResult> | null = null;
      let lastError: Error | null = null;
      for (let attempt = 0; attempt <= this.CHUNK_MAX_RETRY; attempt++) {
        try {
          const response = await this.generateChunk(
            chunk,
            i + 1,
            chunks.length,
            meta,
            isFirst,
          );
          chunkResult = this.parseChunkResult(response, isFirst);

          if (options?.onChunkComplete) {
            try {
              await options.onChunkComplete(i, chunkResult);
            } catch (cbErr) {
              logger.error('[AI] onChunkComplete 回调失败', cbErr instanceof Error ? cbErr.message : String(cbErr));
            }
          }

          lastError = null;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          logger.warn(
            `知识树第 ${i + 1}/${chunks.length} 块第 ${attempt + 1} 次失败`,
            lastError.message,
          );
          logger.error(`[AI] 知识树第 ${i + 1}/${chunks.length} 块第 ${attempt + 1} 次失败：${lastError.message}`);
          if (attempt < this.CHUNK_MAX_RETRY) {
            await this.sleep(800);
          }
        }
      }
      if (lastError || !chunkResult) {
        throw new Error(
          `知识树第 ${i + 1}/${chunks.length} 块生成失败（已重试 ${this.CHUNK_MAX_RETRY} 次）：${lastError?.message}`,
        );
      }

      if (isFirst) {
        intro = chunkResult.intro || '';
        coreLine = chunkResult.coreLine || '';
        source = chunkResult.source || '';
      }

      if (chunkResult.truncated) {
        truncated = true;
      }
      if (chunkResult.coverageNote) {
        coverageNote = chunkResult.coverageNote;
      }

      if (chunkResult.contentMarkdown) {
        contentMarkdown = contentMarkdown
          ? `${contentMarkdown}\n\n${chunkResult.contentMarkdown}`
          : chunkResult.contentMarkdown;
      }

      options?.onChunkComplete?.(i, chunkResult);
    }

    options?.onProgress?.(chunks.length + 1, totalSteps, '合并结果');

    return {
      source,
      intro,
      coreLine,
      contentMarkdown,
      closing: '',
      truncated: truncated || undefined,
      coverageNote: coverageNote || undefined,
    };
  }

  private chunkChapters(
    chapters: Array<{ title: string; text: string }>,
  ): Array<{ title: string; text: string }[]> {
    const chunks: Array<{ title: string; text: string }[]> = [];
    let currentGroup: { title: string; text: string }[] = [];
    let currentSize = 0;

    for (const chapter of chapters) {
      const chapterSize = chapter.text.length;

      if (currentGroup.length > 0 && currentSize + chapterSize > this.CHUNK_MAX_CHARS) {
        chunks.push(currentGroup);
        currentGroup = [];
        currentSize = 0;
      }

      if (chapterSize > this.CHUNK_MAX_CHARS) {
        const subChunks = this.splitLongChapter(chapter);
        for (const sub of subChunks) {
          chunks.push([sub]);
        }
        continue;
      }

      currentGroup.push(chapter);
      currentSize += chapterSize;

      if (currentSize >= this.CHUNK_TARGET_CHARS) {
        chunks.push(currentGroup);
        currentGroup = [];
        currentSize = 0;
      }
    }

    if (currentGroup.length > 0) {
      chunks.push(currentGroup);
    }

    return chunks;
  }

  private splitLongChapter(
    chapter: { title: string; text: string },
  ): Array<{ title: string; text: string }> {
    const result: Array<{ title: string; text: string }> = [];
    const paragraphs = chapter.text.split(/\n+/);
    let currentParas: string[] = [];
    let currentSize = 0;
    let partIndex = 0;

    for (const para of paragraphs) {
      if (currentSize + para.length > this.CHUNK_MAX_CHARS && currentParas.length > 0) {
        partIndex++;
        result.push({
          title: `${chapter.title}（第${partIndex}部分）`,
          text: currentParas.join('\n'),
        });
        currentParas = [];
        currentSize = 0;
      }
      currentParas.push(para);
      currentSize += para.length;
    }

    if (currentParas.length > 0) {
      partIndex++;
      result.push({
        title: `${chapter.title}（第${partIndex}部分）`,
        text: currentParas.join('\n'),
      });
    }

    return result;
  }

  private async generateChunk(
    chunk: { title: string; text: string }[],
    chunkIndex: number,
    totalChunks: number,
    meta?: { title?: string; author?: string },
    isFirst: boolean = false,
  ): Promise<string> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildChunkUserPrompt(
      chunk,
      chunkIndex,
      totalChunks,
      meta,
      isFirst,
    );

    return this.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      0.6,
      this.CHUNK_MAX_OUTPUT_TOKENS,
    );
  }

  private buildChunkUserPrompt(
    chunk: { title: string; text: string }[],
    chunkIndex: number,
    totalChunks: number,
    meta?: { title?: string; author?: string },
    isFirst: boolean = false,
  ): string {
    const parts: string[] = [];

    if (meta?.title || meta?.author) {
      const titleLine = meta.title ? `《${meta.title}》` : '';
      const authorLine = meta.author ? `作者：${meta.author}` : '';
      parts.push(`【书籍信息】\n${titleLine}${authorLine ? '\n' + authorLine : ''}`);
    }

    parts.push(
      `【分块信息】当前是第 ${chunkIndex} / ${totalChunks} 块。全书将按章节分块生成，最后合并成完整知识树。`,
    );

    if (isFirst) {
      parts.push(
        '【你的任务】基于下方章节内容，生成知识树的第一部分（含 source / intro / coreLine / contentMarkdown）。' +
          'coreLine 是基于本块内容提炼的全书核心主线一句话，不要预测后续块的内容。',
      );
    } else {
      parts.push(
        '【你的任务】基于下方章节内容，生成对应板块的知识树 markdown 内容。只输出 {"contentMarkdown": "..."}，不要其他顶层字段。' +
          '注意内容风格与全书保持一致，但内容完全基于下方提供的文本，不要编造或引用前序块的内容。',
      );
    }

    const chapterTexts = chunk
      .map(
        (c: { title: string; text: string }, i: number) =>
          `【第${chunkIndex > 1 ? chunkIndex + '-' : ''}${i + 1}章：${c.title}】\n${c.text}`,
      )
      .join('\n\n');
    parts.push(chapterTexts);

    return parts.join('\n\n');
  }

  private parseChunkResult(
    response: string,
    isFirst: boolean,
  ): Pick<KnowledgeTreeResult, 'contentMarkdown'> & Partial<KnowledgeTreeResult> {
    if (isFirst) {
      const result = this.parseKnowledgeTreeJson(response);
      return {
        source: result.source,
        intro: result.intro,
        coreLine: result.coreLine,
        contentMarkdown: result.contentMarkdown,
        truncated: result.truncated,
        coverageNote: result.coverageNote,
      };
    }

    const cleaned = this.extractJson(response);
    if (!cleaned) {
      const preview = response.slice(0, 200);
      throw new Error(
        `知识树分块解析失败：未能提取 JSON。响应前 200 字：${preview}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTruncated = this.isLikelyTruncated(cleaned);
      const hint = isTruncated
        ? '（AI 输出可能被截断：JSON 未完整闭合）'
        : '';
      const tail = cleaned.slice(-100);
      throw new Error(
        `知识树分块 JSON 解析失败：${message}${hint}。末尾 100 字：${tail}`,
      );
    }

    const obj = parsed as Record<string, unknown>;
    const contentMarkdown =
      typeof obj.contentMarkdown === 'string'
        ? obj.contentMarkdown
        : '';

    return { contentMarkdown };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildSystemPrompt(): string {
    // 规则正文唯一来源：client/src/rules/knowledge-tree.md（勿在代码内重复维护）
    return treeRules;
  }

  private buildUserPrompt(
    text: string,
    meta?: { title?: string; author?: string },
    truncated?: boolean,
  ): string {
    const parts: string[] = [];

    if (meta?.title || meta?.author) {
      const titleLine = meta.title ? `《${meta.title}》` : '';
      const authorLine = meta.author ? `作者：${meta.author}` : '';
      parts.push(`【阅读材料信息】\n${titleLine}${authorLine ? '\n' + authorLine : ''}`);
    }

    if (truncated) {
      parts.push(
        '【注意】因全文较长，以下为前半部分内容。请基于已提供内容生成知识树，' +
        '不要编造未提供部分的内容，确保所有信息都来自下方文本。',
      );
    }

    parts.push(`【全文内容】\n\n${text}`);

    return parts.join('\n\n');
  }

  private parseKnowledgeTreeJson(response: string): KnowledgeTreeResult {
    const cleaned = this.extractJson(response);
    if (!cleaned) {
      const preview = response.slice(0, 200);
      throw new Error(
        `AI 返回格式解析失败：未能从响应中提取 JSON。响应前 200 字：${preview}`,
      );
    }

    const tryParse = (jsonStr: string): unknown | null => {
      try {
        return JSON.parse(jsonStr);
      } catch {
        return null;
      }
    };

    let parsed = tryParse(cleaned);
    let repaired = false;

    if (!parsed) {
      const repairedJson = this.repairJson(cleaned);
      parsed = tryParse(repairedJson);
      repaired = parsed !== null;
    }

    if (!parsed) {
      const isTruncated = this.isLikelyTruncated(cleaned);
      const hint = isTruncated
        ? '（AI 输出可能被截断：JSON 未完整闭合，请检查 max_tokens 是否足够或原文是否过长）'
        : '';
      const preview = cleaned.slice(0, 300);
      const tail = cleaned.length > 300
        ? `...末尾 100 字：${cleaned.slice(-100)}`
        : '';
      throw new Error(
        `AI 返回 JSON 解析失败（已尝试修复）：${hint}JSON 前 300 字：${preview}${tail}`,
      );
    }

    if (repaired) {
      logger.warn('[AI] JSON 解析经过容错修复后成功');
    }

    return this.validateAndNormalize(parsed);
  }

  /**
   * JSON 容错修复：处理 AI 输出中常见的 JSON 格式瑕疵
   * 核心原则：字符串感知——所有结构性修复只作用于字符串外，字符串内内容原样保留。
   * 修复范围：代码块标记、字符串外的中文标点、尾逗号、漏逗号、字符串内未转义引号、缺失/多余括号、未闭合引号
   */
  private repairJson(jsonStr: string): string {
    let s = jsonStr.trim();

    // 1. 去掉 markdown 代码块标记
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');

    // 2. 字符串感知的中文标点替换：只替换字符串外的 ，→ ,  ：→ :
    // 字符串内的任何字符（包括中文弯引号“”、中文逗号、中文冒号）原样保留
    s = this.replaceOutsideStrings(s, (chunk: string) =>
      chunk.replace(/，/g, ',').replace(/：/g, ':')
    );

    // 3. 字符串感知的尾逗号删除：只删除字符串外的尾随逗号
    s = this.replaceOutsideStrings(s, (chunk: string) => {
      let prev = '';
      let result = chunk;
      while (prev !== result) {
        prev = result;
        result = result.replace(/,\s*([}\]])/g, '$1');
      }
      return result;
    });

    // 4. 核心修复：字符串内未转义的半角双引号
    // 状态机逐字符扫描，提高保守度：只有明确像字符串结束的引号才当作结束
    s = this.repairUnescapedQuotes(s);

    // 5. 字符串感知的漏逗号修复：只在字符串外补逗号
    // 注意：需要区分两个相邻的字符串是「结构上的两个值」还是「一个字符串被截断了」
    // 由于第4步已尽量修复引号，这里对字符串外的模式做补逗号
    s = this.replaceOutsideStrings(s, (chunk: string) => {
      let r = chunk;
      r = r.replace(/"\s*\n(\s*)"/g, '",\n$1"');
      r = r.replace(/\}\s*\n(\s*)"/g, '},\n$1"');
      r = r.replace(/\]\s*\n(\s*)"/g, '],\n$1"');
      r = r.replace(/"\s*\n(\s*)\{/g, '",\n$1{');
      r = r.replace(/"\s*\n(\s*)\[/g, '",\n$1[');
      r = r.replace(/\}\s*\n(\s*)\{/g, '},\n$1{');
      r = r.replace(/\]\s*\n(\s*)\{/g, '],\n$1{');
      r = r.replace(/\}\s*\n(\s*)\[/g, '},\n$1[');
      r = r.replace(/\]\s*\n(\s*)\[/g, '],\n$1[');
      return r;
    });

    // 6. 补齐末尾缺失的闭合括号（应对截断场景）
    // 只数字符串外的括号
    const braceDiff = this.countOutsideStrings(s, '{') - this.countOutsideStrings(s, '}');
    const bracketDiff = this.countOutsideStrings(s, '[') - this.countOutsideStrings(s, ']');

    if (braceDiff > 0 || bracketDiff > 0) {
      let closing = '';
      for (let i = 0; i < bracketDiff; i++) closing += ']';
      for (let i = 0; i < braceDiff; i++) closing += '}';
      s = s.replace(/\s*$/, closing);
    }

    // 7. 修复多余的末尾闭合括号（只从末尾删，且只删字符串外的）
    const braceDiff2 = this.countOutsideStrings(s, '{') - this.countOutsideStrings(s, '}');
    const bracketDiff2 = this.countOutsideStrings(s, '[') - this.countOutsideStrings(s, ']');

    if (braceDiff2 < 0 || bracketDiff2 < 0) {
      let needRemoveBrace = Math.abs(braceDiff2);
      let needRemoveBracket = Math.abs(bracketDiff2);
      const chars = s.split('');
      for (let i = chars.length - 1; i >= 0 && (needRemoveBrace > 0 || needRemoveBracket > 0); i--) {
        if (chars[i] === '}' && needRemoveBrace > 0) {
          chars.splice(i, 1);
          needRemoveBrace--;
        } else if (chars[i] === ']' && needRemoveBracket > 0) {
          chars.splice(i, 1);
          needRemoveBracket--;
        } else if (chars[i] !== ' ' && chars[i] !== '\n' && chars[i] !== '\t') {
          break;
        }
      }
      s = chars.join('');
    }

    // 8. 末尾未闭合字符串补引号
    if (this.isInsideStringAtEnd(s)) {
      s += '"';
    }

    return s.trim();
  }

  /**
   * 在字符串外的区域执行替换，字符串内原样保留
   * @param s 原始字符串
   * @param replacer 对字符串外片段执行替换的函数
   */
  private replaceOutsideStrings(s: string, replacer: (chunk: string) => string): string {
    const result: string[] = [];
    let inStr = false;
    let currentChunk: string[] = [];
    let i = 0;

    const flushChunk = (): void => {
      if (currentChunk.length > 0) {
        result.push(replacer(currentChunk.join('')));
        currentChunk = [];
      }
    };

    while (i < s.length) {
      const ch = s[i];

      if (!inStr) {
        if (ch === '"') {
          flushChunk();
          // 进入字符串，引号本身先记下来
          result.push('"');
          inStr = true;
          i++;
        } else if (ch === '\\') {
          // 字符串外的转义（不太可能，但防御性处理）
          currentChunk.push(ch);
          if (i + 1 < s.length) { currentChunk.push(s[i + 1]); i += 2; } else { i++; }
        } else {
          currentChunk.push(ch);
          i++;
        }
        continue;
      }

      // 在字符串内
      if (ch === '\\') {
        // 转义字符，原样保留两个字符
        result.push(ch);
        if (i + 1 < s.length) { result.push(s[i + 1]); i += 2; } else { i++; }
        continue;
      }

      if (ch === '"') {
        // 字符串结束引号，原样保留
        result.push('"');
        inStr = false;
        i++;
        continue;
      }

      // 字符串内普通字符，原样保留
      result.push(ch);
      i++;
    }

    // 收尾：如果最后在字符串外，把剩余 chunk 处理掉
    if (!inStr) {
      flushChunk();
    }

    return result.join('');
  }

  /**
   * 统计字符串外出现的某个字符的次数
   */
  private countOutsideStrings(s: string, target: string): number {
    let count = 0;
    let inStr = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\' && inStr) { i++; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (!inStr && ch === target) count++;
    }
    return count;
  }

  /**
   * 判断字符串末尾位置是否处于「字符串内」状态
   */
  private isInsideStringAtEnd(s: string): boolean {
    let inStr = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\' && inStr) { i++; continue; }
      if (ch === '"') { inStr = !inStr; }
    }
    return inStr;
  }

  /**
   * 状态机修复字符串内未转义的半角双引号（保守版）
   * 逐字符扫描，维护「在字符串内 / 在字符串外」状态。
   * 保守策略：只有引号后的下一个非空白字符明确是 JSON 结构字符（, : ] }）
   * 或下一个值的起始（" { [）时，才认为是字符串结束引号；
   * 其他情况一律视为字符串内容中的引号，补 \ 转义。
   */
  private repairUnescapedQuotes(s: string): string {
    const result: string[] = [];
    let inStr = false;
    let i = 0;
    let fixedCount = 0;
    const MAX_FIX = 50;

    while (i < s.length) {
      const ch = s[i];

      if (!inStr) {
        if (ch === '"') {
          inStr = true;
          result.push(ch);
          i++;
        } else if (ch === '\\') {
          result.push(ch);
          if (i + 1 < s.length) { result.push(s[i + 1]); i += 2; } else { i++; }
        } else {
          result.push(ch);
          i++;
        }
        continue;
      }

      if (ch === '\\') {
        result.push(ch);
        if (i + 1 < s.length) { result.push(s[i + 1]); i += 2; } else { i++; }
        continue;
      }

      if (ch === '"') {
        const isClosing = this.isQuoteLikelyClosing(s, i);
        if (isClosing) {
          inStr = false;
          result.push(ch);
          i++;
        } else {
          if (fixedCount < MAX_FIX) {
            result.push('\\');
            fixedCount++;
          }
          result.push(ch);
          i++;
        }
        continue;
      }

      result.push(ch);
      i++;
    }

    if (fixedCount > 0) {
      logger.warn(`[AI] JSON 容错修复：修复了 ${fixedCount} 处未转义引号`);
    }
    return result.join('');
  }

  /**
   * 判断 position 处的引号是否像「字符串结束引号」
   * 保守策略：只有下一个非空白字符是明确的 JSON 结构字符才返回 true
   */
  private isQuoteLikelyClosing(s: string, pos: number): boolean {
    let j = pos + 1;
    while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) {
      j++;
    }
    if (j >= s.length) return true;
    const next = s[j];
    // 明确的结构分隔符：, : ] }
    if (next === ',' || next === ':' || next === ']' || next === '}') return true;
    // 下一个值的起始：{ 或 [ 或 "
    if (next === '{' || next === '[' || next === '"') return true;
    // 其他情况一律视为字符串内的引号（保守）
    return false;
  }



  private isLikelyTruncated(jsonStr: string): boolean {
    const trimmed = jsonStr.trim();
    if (trimmed.length === 0) return false;
    const lastChar = trimmed[trimmed.length - 1];
    if (lastChar === '}' || lastChar === ']') return false;
    const openBraces = (trimmed.match(/\{/g) || []).length;
    const closeBraces = (trimmed.match(/\}/g) || []).length;
    const openBrackets = (trimmed.match(/\[/g) || []).length;
    const closeBrackets = (trimmed.match(/\]/g) || []).length;
    return openBraces !== closeBraces || openBrackets !== closeBrackets;
  }

  private extractJson(text: string): string | null {
    const trimmed = text.trim();

    const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    const braceMatch = trimmed.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      return braceMatch[0];
    }

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed;
    }

    return null;
  }

  private validateAndNormalize(data: unknown): KnowledgeTreeResult {
    if (!data || typeof data !== 'object') {
      throw new Error('响应不是 JSON 对象');
    }

    const obj = data as Record<string, unknown>;

    const source = typeof obj.source === 'string' ? obj.source : '未标注来源';
    const intro = typeof obj.intro === 'string' ? obj.intro : '';

    // 兼容旧结构：overview → coreLine
    const coreLine =
      typeof obj.coreLine === 'string' && obj.coreLine.trim()
        ? obj.coreLine
        : typeof obj.overview === 'string' && obj.overview.trim()
          ? obj.overview
          : '';

    // contentMarkdown：新格式的主内容字段；若缺失则降级从 sections 生成一个简单的 markdown
    let contentMarkdown =
      typeof obj.contentMarkdown === 'string' && obj.contentMarkdown.trim()
        ? obj.contentMarkdown
        : '';

    if (!contentMarkdown && Array.isArray(obj.sections) && obj.sections.length > 0) {
      // 兼容旧格式：把 sections 粗略转成 markdown，保证旧数据也能展示
      contentMarkdown = this.sectionsToMarkdown(obj.sections as Record<string, unknown>[]);
    }

    const closing =
      typeof obj.closing === 'string' && obj.closing.trim()
        ? obj.closing
        : '';

    const truncated =
      typeof obj.truncated === 'boolean' ? obj.truncated : undefined;
    const coverageNote =
      typeof obj.coverageNote === 'string' && obj.coverageNote.trim()
        ? obj.coverageNote
        : undefined;

    const result: KnowledgeTreeResult = {
      source,
      intro,
      coreLine,
      contentMarkdown,
      closing: '',
    };
    if (truncated !== undefined) result.truncated = truncated;
    if (coverageNote) result.coverageNote = coverageNote;
    return result;
  }

  /** 将旧格式 sections 数组转成 markdown，用于兼容历史数据 */
  private sectionsToMarkdown(sections: Record<string, unknown>[]): string {
    const lines: string[] = [];
    for (const s of sections) {
      const title = typeof s.title === 'string' ? s.title : '未命名板块';
      lines.push(`## ${title}`);
      if (typeof s.overview === 'string' && s.overview.trim()) {
        lines.push(s.overview);
        lines.push('');
      }
      const subsRaw = Array.isArray(s.subsections)
        ? s.subsections
        : Array.isArray(s.points)
          ? [{ points: s.points, title: '核心要点' }]
          : [];
      for (const sub of subsRaw) {
        if (!sub || typeof sub !== 'object') continue;
        const subObj = sub as Record<string, unknown>;
        const subTitle = typeof subObj.title === 'string' ? subObj.title : '';
        if (subTitle) lines.push(`### ${subTitle}`);
        if (typeof subObj.intro === 'string' && subObj.intro.trim()) {
          lines.push(subObj.intro);
        }
        const pointsRaw = Array.isArray(subObj.points) ? subObj.points : [];
        for (const p of pointsRaw) {
          if (!p || typeof p !== 'object') continue;
          const pObj = p as Record<string, unknown>;
          const pTitle = typeof pObj.title === 'string' ? pObj.title : '';
          const pContent = typeof pObj.content === 'string' ? pObj.content : '';
          if (pTitle && pContent) {
            lines.push(`- **${pTitle}**：${pContent}`);
          } else if (pTitle) {
            lines.push(`- ${pTitle}`);
          } else if (pContent) {
            lines.push(`- ${pContent}`);
          }
          const examples = Array.isArray(pObj.examples) ? pObj.examples : [];
          for (const ex of examples) {
            if (!ex || typeof ex !== 'object') continue;
            const exObj = ex as Record<string, unknown>;
            const exTitle = typeof exObj.title === 'string' ? exObj.title : '';
            const exContent = typeof exObj.content === 'string' ? exObj.content : '';
            if (exTitle || exContent) {
              lines.push(`  - 【例】${exTitle}${exTitle && exContent ? ' — ' : ''}${exContent}`);
            }
          }
        }
        const quotes = Array.isArray(subObj.originalQuotes) ? subObj.originalQuotes : [];
        for (const q of quotes) {
          if (!q || typeof q !== 'object') continue;
          const qObj = q as Record<string, unknown>;
          const qText = typeof qObj.text === 'string' ? qObj.text : '';
          const qChapter = typeof qObj.chapterTitle === 'string' ? qObj.chapterTitle : '';
          if (qText) {
            lines.push(`> ${qText}${qChapter ? `\n> —— ${qChapter}` : ''}`);
          }
        }
        lines.push('');
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  private normalizePointType(t: unknown): KnowledgeTreePoint['pointType'] | undefined {
    if (
      t === 'definition' ||
      t === 'mechanism' ||
      t === 'experiment' ||
      t === 'case' ||
      t === 'data' ||
      t === 'phenomenon' ||
      t === 'conclusion'
    ) {
      return t;
    }
    return undefined;
  }

  private normalizeExampleType(t: unknown): KnowledgeTreeExample['type'] {
    if (t === 'example' || t === 'experiment' || t === 'case' || t === 'data') {
      return t;
    }
    return 'example';
  }

  async identifyEntities(text: string): Promise<{
    persons: Array<{ name: string; description?: string }>;
    places: Array<{ name: string; description?: string }>;
  }> {
    const config = this.getConfig();
    if (!config.apiKey) {
      throw new Error('API_KEY_NOT_CONFIGURED');
    }

    const response = await this.chat(
      [
        {
          role: 'system',
          content:
            '你是一个实体识别专家。请从用户提供的文本中识别所有人物和地点。\n' +
            '输出严格的 JSON 格式：{"persons": [{"name": "人名", "description": "一句话介绍"}], "places": [{"name": "地名", "description": "一句话介绍"}]}\n' +
            '只输出 JSON，不要任何其他文字。保证 JSON 完整合法，绝不截断输出。',
        },
        { role: 'user', content: text },
      ],
      0.5,
      4096,
    );

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : response;
      return JSON.parse(jsonStr);
    } catch {
      throw new Error('实体识别返回格式解析失败');
    }
  }
}

export const aiService = new AiService();
