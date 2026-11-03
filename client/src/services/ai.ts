import { logger } from '@lark-apaas/client-toolkit/logger';
import { storage } from './storage';

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

  async translate(text: string): Promise<string> {
    return this.chat([
      {
        role: 'system',
        content: '你是一个白话文翻译助手。将用户输入的文言文或拗口的句子翻译成通俗易懂的大白话，保持原意，简洁自然。',
      },
      { role: 'user', content: text },
    ]);
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

    onProgress?.(chunks.length + 1, totalSteps, '生成收尾');
    const closing = await this.generateClosing(
      contentMarkdown,
      meta,
    );

    return {
      source,
      intro,
      coreLine,
      contentMarkdown,
      closing,
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

    options?.onProgress?.(chunks.length + 1, totalSteps, '生成收尾');
    const closing = await this.generateClosing(
      contentMarkdown,
      meta,
    );

    return {
      source,
      intro,
      coreLine,
      contentMarkdown,
      closing,
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
    const systemPrompt = this.buildChunkSystemPrompt(isFirst);
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

  private buildChunkSystemPrompt(isFirst: boolean): string {
    const base = this.buildSystemPrompt().replace(
      '【输出格式——严格 JSON】',
      isFirst
        ? '【分块生成说明】\n' +
          '这是全书知识树的第 1 块（共 N 块，由用户提示中告知）。你负责生成第一部分内容的知识树。\n' +
          '第一块需要包含 source、intro、coreLine 三个顶层字段和第一部分的 contentMarkdown。\n' +
          'intro 要说明全书背景和本次生成的覆盖范围；coreLine 中给出你基于本块内容提炼的全书核心主线（一句话）。\n' +
          '不要生成 closing 收尾句，那会在所有块生成完成后单独生成。\n\n' +
          '【输出格式——严格 JSON】'
        : '【分块生成说明】\n' +
          '这是全书知识树的中间/最后一块（第 i/N，由用户提示中告知）。前面的部分已经生成并合并。\n' +
          '你只需要输出当前这块内容对应的 contentMarkdown（markdown 格式字符串），不需要生成 source、intro、coreLine、closing 等顶层字段。\n' +
          '输出格式为 {"contentMarkdown": "...markdown 内容..."}，markdown 内容的结构与全书知识树中的一致。\n\n' +
          '【输出格式——严格 JSON】',
    );
    return base;
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

  private async generateClosing(
    contentMarkdown: string,
    meta?: { title?: string; author?: string },
  ): Promise<string> {
    const bookLabel =
      meta?.title || meta?.author
        ? `${meta.title ? `《${meta.title}》` : ''}${meta.author ? ` 作者：${meta.author}` : ''}`
        : '本书';

    const prompt = `你是一位内容总结专家。基于以下知识树的 markdown 正文，为${bookLabel}生成一句收尾总结。

【知识树正文（markdown 格式）】
${contentMarkdown.slice(0, 2000)}

请输出严格 JSON：
{
  "closing": "一句话收尾总结（有力概括全书核心，像 blockquote 式的收尾句，25-50字）"
}

要求：
1. closing 是一句话收尾，凝练有力，像 blockquote 式的收束
2. 高度概括全书核心主线，25-50字
3. 只输出 JSON，不要任何其他文字或 markdown 包裹`;

    const response = await this.chat(
      [
        { role: 'system', content: '你是一位严谨的内容总结专家，擅长从结构标题中提炼全书核心。输出严格 JSON。' },
        { role: 'user', content: prompt },
      ],
      0.7,
      512,
    );

    const cleaned = this.extractJson(response);
    if (!cleaned) return '';

    try {
      const obj = JSON.parse(cleaned) as Record<string, unknown>;
      return typeof obj.closing === 'string' && obj.closing.trim()
        ? obj.closing
        : '';
    } catch {
      return '';
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildSystemPrompt(): string {
    return (
      '你是一位知识树构建专家，擅长将长文内容拆解为结构清晰、覆盖完整、信息密集的知识树。' +
      '你的任务不是写读后感或摘要，而是用分层结构精确还原原文的全部信息密度，让读者不读原文就能吸收所有核心精华。\n\n' +
      '【输出结构铁律——违反即失败】\n' +
      '全书知识树只有以下顶层字段：source、intro、coreLine、contentMarkdown、closing。除此之外不得出现任何其他顶层字段。\n' +
      '1. 绝对禁止生成以下任何内容作为独立板块/子板块/字段：金句收束、行动清单、总结与行动、一句话总结、actionItems、actionList、oneSentenceSummary、finalQuote、summary。\n' +
      '2. 收尾只有 closing 一个字段，是一句 blockquote 式的收束语（25-50字），不需要也不允许拆成多条。\n' +
      '3. contentMarkdown 中只放知识内容正文，禁止把「总结」「金句」「行动」「清单」「收尾」等作为一级标题或独立板块。\n' +
      '4. 原文引用用 markdown blockquote（> 格式）写在对应内容段落附近，不是独立一级板块。\n\n' +
      '【生成方法论——严格按以下九步执行】\n\n' +
      '第一步：完整读取、不丢细节\n' +
      '基于用户提供的全文完整内容构建，先消化全部内容（含例子、数据、金句、实验、案例过程、方法步骤），' +
      '不以印象或摘要代替原文。细节丢失即失败。\n\n' +
      '第二步：全量内容盘点\n' +
      '先做「全量内容盘点」——把全文的内容块全部列出，分类包括：\n' +
      '- 概念与定义：核心概念是什么、有几种形式/类型\n' +
      '- 机制与原理：底层规律、运作方式、因果链条\n' +
      '- 案例与故事：含完整过程细节（背景→动作→结果），不缩写\n' +
      '- 实验与数据：实验设计、样本、结论；具体数据数值与语境\n' +
      '- 原文引语：原文原话（用于 markdown 引用块，保留原句原词）\n' +
      '再基于盘点结果设计能容纳所有内容块、覆盖无遗漏的分层架构。不能让任何内容块无处安放；若某类内容无处安放，就补一层而不是删内容。\n\n' +
      '第三步：剔除噪音\n' +
      '广告、重复内容、口播废话、题外话、致谢、赞助信息一律剔除，不进入知识树。\n\n' +
      '第四步：逻辑递进分层\n' +
      '按「导语 → 本质 → 机制 → 双面影响 → 人群/场景影响 → 应对与破局 → 收尾」的默认骨架组织。' +
      '允许按实际内容类型增删板块（例如工具方法论类可用「核心问题→底层原理→关键方法→实践步骤→常见误区→收尾」，' +
      '人物传记类可用「背景身份→人生转折→核心成就→性格思想→历史影响」）。\n' +
      '内容归位规则：\n' +
      '- 概念/定义/形式/类型 → 本质层\n' +
      '- 原理/机制/步骤/闭环 → 机制层\n' +
      '- 好处/坏处/代价 → 双面影响层\n' +
      '- 特定对象的差异化影响 → 人群/场景影响层\n' +
      '- 方法/方案/工具/技巧 → 应对与破局层\n' +
      '- 结论/核心论断 → 收尾句\n' +
      '每个板块下设 2-3 层子标题（## → ### → ####），形成真正的层级结构，不是扁平清单。\n\n' +
      '第五步：密集要点 + 配示例\n' +
      '每个子标题下是密集要点列表（- bullet list 形式），要点类型包括：定义 / 机制 / 实验 / 案例 / 数据 / 现象 / 结论。\n' +
      '每个要点采用「**观点短句**：说明文字」的融合写法，讲清楚说明白，杜绝只有标题没有说明。\n' +
      '关键主张配【例】，完整过程不缩写；有实验/数据的写清实验设计与结论。\n' +
      '实例/案例/数据用缩进 bullet 或在正文中用「【例】」「【数据】」「【实验】」等标签标注，每个例子含完整过程：背景→动作→结果。\n\n' +
      '第六步：原文句群（blockquote）\n' +
      '在每个子板块的合适位置，用 markdown blockquote（> 格式）呈现与该段内容直接相关的原文句子。\n' +
      '- 保留原句原词，不得改写、不得编造\n' +
      '- 散落全书各处的相关原文按议题重组归集\n' +
      '- 每条原文末尾标注出处：「—— 出处章节标题」（与用户提示中的章节标题对应）\n' +
      '- 控制总量：每个子板块取直接相关的若干句（精而不滥，宁缺毋滥），不要整段搬入无关上下文\n\n' +
      '第七步：观点性命名\n' +
      '## / ### 标题必须点出具体观点（如「稀缺的本质」「机制一：注意力俘获」「代价二：救火循环与负向飞轮」），' +
      '禁止空泛词（如「机制总览」「全链路赋能」「核心要点」）。' +
      '全文对象、指标、例子保持同名同口径，不混用近义词。\n\n' +
      '第八步：markdown 排版规范\n' +
      '- 用 `#` / `##` / `###` / `####` 做层级标题，观点性命名，不要空泛标题\n' +
      '- 用 `- ` 做 bullet list（要点标题和内容融合：`**观点短句**：说明文字`）\n' +
      '- 原文引用用 `> ` blockquote 格式，原文末尾同一行或下一行标注 `—— 出处章节`\n' +
      '- 实例/案例/数据用缩进 bullet 或在正文中用 `【例】` `【数据】` `【实验】` 等标签标注\n' +
      '- 层级数量根据内容自由决定，不强制固定层数\n' +
      '- 板块之间保持逻辑递进\n\n' +
      '第九步：生成后自校验\n' +
      '输出前自查：\n' +
      '1. 标题层级连续（## → ### → ####，没有跳层）\n' +
      '2. 噪音=0（广告/口播/致谢全删）\n' +
      '3. 覆盖度：盘点出的每个内容块都在 markdown 中命中，没有遗漏\n' +
      '4. 要点充实：每个要点都有完整说明，不是只有观点词\n' +
      '5. 原文句群准确：blockquote 中的引文来自原文、保留原句、标注章节\n' +
      '6. 观点性命名：没有空泛标题\n' +
      '7. 结构合规：没有 summary / actionItems / finalQuote / 金句收束 / 行动清单 / 一句话总结 等旧格式内容\n\n' +
      '第十步：输出长度管控（极其重要）\n' +
      '当原文内容较多、生成的知识树可能很长时，优先保证 JSON 结构的完整与合法性，' +
      '宁可适当精简要点描述、合并相近子标题、减少非核心示例的展开，也绝不允许输出在中途截断导致 JSON 残缺。' +
      '如果评估内容量接近输出上限，按以下优先级取舍：' +
      '1）保留所有 ## / ### 级别的标题骨架（不能缺章少节）；' +
      '2）保留每个要点的核心观点（说明文字可适当压缩到 1 句）；' +
      '3）示例只保留最关键的 1-2 个，其余可省略；' +
      '4）原文引用只保留最相关的 2-3 句，宁缺毋滥。' +
      '最终输出必须是一个完整闭合的合法 JSON，任何情况下都不能以未闭合的数组或对象结尾。\n\n' +
      '【JSON 转义规则——极其重要，输出前必查】\n' +
      '1. 字符串内的中文引号「“”」「‘’」直接原样输出即可，不需要也不允许转成半角引号；\n' +
      '2. 字符串内禁止使用半角双引号（"），如原文确有英文/半角引号，请统一改写为中文引号「“”」；\n' +
      '3. contentMarkdown 中的 markdown 内容是 JSON 字符串值，其中的双引号必须转义为 \"，换行必须写为 \\n；\n' +
      '4. blockquote 中的原文引文必须保留原文措辞，但其中的半角引号一律改写为中文引号，绝不留半角引号在 JSON 字符串内；\n' +
      '5. 字符串中的反斜杠（\\）必须写为 \\\\，制表符必须写为 \\t；\n' +
      '6. 输出完成后，用眼睛扫一遍 contentMarkdown 字符串的起止引号，确保字符串内容里没有裸露的半角双引号；\n' +
      '7. 宁可用中文引号替换原文中的半角引号，也不能让 JSON 结构失效。\n\n' +
      '【输出格式——严格 JSON】\n' +
      '只输出 JSON，不要任何其他文字、markdown 代码块包裹或解释。顶层 JSON 结构如下：\n' +
      '{\n' +
      '  "source": "内容来源说明（书名/作者/内容类型，如「《稀缺》｜塞德希尔·穆来纳森｜理论概念类」）",\n' +
      '  "intro": "导语段落（说明本知识树由什么内容梳理而成、已剔除哪些噪音、按哪些板块组织）",\n' +
      '  "coreLine": "核心主线（一句话概括全书核心，是提炼后的核心论断）",\n' +
      '  "contentMarkdown": "知识树主体内容（markdown 格式字符串，含 ##/### 标题、bullet list、blockquote 引用等）",\n' +
      '  "closing": "收尾一句话总结（blockquote 式，有力收束，25-50字）"\n' +
      '}\n\n' +
      '要求：\n' +
      '1. contentMarkdown 是 markdown 格式字符串，是知识树的主体内容；用 ## 做大板块标题（4-7 个），### 做子板块标题，层级之间逻辑递进清晰\n' +
      '2. 要点内容是提炼后的成品干货，不是原文摘抄，但必须基于原文事实\n' +
      '3. 每个要点必须含具体信息（定义/机制/数据/方法），禁止空话套话\n' +
      '4. 实例/案例/实验必须保留完整过程，不缩写到只剩结论\n' +
      '5. 原文引用用 > blockquote 格式、保留原句原词、标注章节出处、宁缺毋滥\n' +
      '6. 全文对象、指标、例子保持同名同口径\n' +
      '7. 只输出 JSON，不要任何其他文字或 markdown 包裹\n' +
      '8. 结构合规：顶层字段仅限 source / intro / coreLine / contentMarkdown / closing；禁止 summary / actionItems / finalQuote / 金句收束 / 行动清单 / 一句话总结 等任何旧格式内容\n' +
      '9. closing 是唯一收尾形式，一句话、blockquote 式、25-50字\n'
    );
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
      closing,
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
