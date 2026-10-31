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
  sections: KnowledgeTreeSection[];
  closing: string;
  truncated?: boolean;
  coverageNote?: string;
}

class AiService {
  private baseUrl = 'https://api.deepseek.com/v1';
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

  private readonly REQUEST_TIMEOUT_MS = 120000;
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
      logger.error(`[AI] chat 响应头已收到，耗时=${headerElapsed}ms，status=${response.status}`);

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
            logger.error(
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
      logger.error(
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

  private readonly CHUNK_TARGET_CHARS = 5000;
  private readonly CHUNK_MAX_CHARS = 6000;
  private readonly CHUNK_MAX_OUTPUT_TOKENS = 4500;
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
    const totalSteps = chunks.length + 1;
    const allSections: KnowledgeTreeSection[] = [];
    let intro = '';
    let coreLine = '';
    let source = '';
    let truncated = false;
    let coverageNote = '';

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isFirst = i === 0;
      onProgress?.(i + 1, totalSteps, `生成知识树（${i + 1}/${chunks.length}）`);

      let chunkResult: Pick<KnowledgeTreeResult, 'sections'> & Partial<KnowledgeTreeResult> | null = null;
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

      for (const section of chunkResult.sections) {
        allSections.push(section);
      }
    }

    onProgress?.(chunks.length + 1, totalSteps, '生成收尾');
    const closing = await this.generateClosing(
      allSections.map((s: KnowledgeTreeSection) => s.title),
      meta,
    );

    return {
      source,
      intro,
      coreLine,
      sections: allSections,
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
      onChunkComplete?: (chunkIndex: number, chunkResult: Pick<KnowledgeTreeResult, 'sections'> & Partial<KnowledgeTreeResult>) => void;
      onProgress?: (current: number, total: number, phase: string) => void;
      existingIntro?: string;
      existingCoreLine?: string;
      existingSource?: string;
      existingSections?: KnowledgeTreeSection[];
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
    const allSections: KnowledgeTreeSection[] = [...(options?.existingSections ?? [])];
    let truncated = false;
    let coverageNote = '';

    for (let i = startIdx; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isFirst = i === 0;
      options?.onProgress?.(i + 1, totalSteps, `生成知识树（${i + 1}/${chunks.length}）`);

      let chunkResult: Pick<KnowledgeTreeResult, 'sections'> & Partial<KnowledgeTreeResult> | null = null;
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

      for (const section of chunkResult.sections) {
        allSections.push(section);
      }

      options?.onChunkComplete?.(i, chunkResult);
    }

    options?.onProgress?.(chunks.length + 1, totalSteps, '生成收尾');
    const closing = await this.generateClosing(
      allSections.map((s: KnowledgeTreeSection) => s.title),
      meta,
    );

    return {
      source,
      intro,
      coreLine,
      sections: allSections,
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
          '第一块需要包含 source、intro、coreLine 三个顶层字段和第一部分的 sections。\n' +
          'intro 要说明全书背景和本次生成的覆盖范围；coreLine 中给出你基于本块内容提炼的全书核心主线（一句话）。\n' +
          '不要生成 closing 收尾句，那会在所有块生成完成后单独生成。\n\n' +
          '【输出格式——严格 JSON】'
        : '【分块生成说明】\n' +
          '这是全书知识树的中间/最后一块（第 i/N，由用户提示中告知）。前面的部分已经生成并合并。\n' +
          '你只需要输出当前这块内容对应的 sections，不需要生成 source、intro、coreLine、closing 等顶层字段。\n' +
          '输出格式为 {"sections": [...]}，sections 的结构与全文知识树中的一致。\n\n' +
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
        '【你的任务】基于下方章节内容，生成知识树的第一部分（含 source / intro / coreLine / sections）。' +
          'coreLine 是基于本块内容提炼的全书核心主线一句话，不要预测后续块的内容。',
      );
    } else {
      parts.push(
        '【你的任务】基于下方章节内容，生成对应板块的知识树。只输出 {"sections": [...]}，不要其他顶层字段。' +
          '注意板块命名风格与全书保持一致，但内容完全基于下方提供的文本，不要编造或引用前序块的内容。',
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
  ): Pick<KnowledgeTreeResult, 'sections'> & Partial<KnowledgeTreeResult> {
    if (isFirst) {
      const result = this.parseKnowledgeTreeJson(response);
      return {
        source: result.source,
        intro: result.intro,
        coreLine: result.coreLine,
        sections: result.sections,
        truncated: result.truncated,
        coverageNote: result.coverageNote,
      };
    }

    const cleaned = this.extractJson(response);
    if (!cleaned) {
      const preview = response.slice(0, 200);
      throw new Error(`知识树分块解析失败：未能提取 JSON。响应前 200 字：${preview}`);
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
    const sectionsRaw = Array.isArray(obj.sections) ? obj.sections : [];

    const sections: KnowledgeTreeSection[] = sectionsRaw
      .filter((s: unknown) => s && typeof s === 'object')
      .map((s: Record<string, unknown>) => {
        const title =
          typeof s.title === 'string' && s.title.trim()
            ? s.title
            : '未命名板块';
        const sectionOverview =
          typeof s.overview === 'string' ? s.overview : undefined;

        const subsRaw = Array.isArray(s.subsections)
          ? s.subsections
          : Array.isArray(s.points)
            ? [{ points: s.points, title: '核心要点' }]
            : [];

        const subsections: KnowledgeTreeSubsection[] = subsRaw
          .filter((sub: unknown) => sub && typeof sub === 'object')
          .map((sub: Record<string, unknown>, sbi: number) => {
            const subTitle =
              typeof sub.title === 'string' && sub.title.trim()
                ? sub.title
                : `子板块 ${sbi + 1}`;
            const subIntro =
              typeof sub.intro === 'string' ? sub.intro : undefined;

            const pointsRaw = Array.isArray(sub.points) ? sub.points : [];
            const points: KnowledgeTreePoint[] = pointsRaw
              .filter((p: unknown) => p && typeof p === 'object')
              .map((p: Record<string, unknown>) => {
                const pointTitle =
                  typeof p.title === 'string' && p.title.trim()
                    ? p.title
                    : '要点';
                const pointContent =
                  typeof p.content === 'string' ? p.content : '';

                const pointTypeRaw = p.pointType;
                const pointType = this.normalizePointType(pointTypeRaw);

                const examplesRaw = Array.isArray(p.examples)
                  ? p.examples
                  : Array.isArray(p.elements)
                      ? p.elements.filter(
                          (e: unknown) =>
                            e && typeof e === 'object' &&
                            ((e as Record<string, unknown>).type === 'example' ||
                             (e as Record<string, unknown>).type === 'experiment' ||
                             (e as Record<string, unknown>).type === 'case' ||
                             (e as Record<string, unknown>).type === 'data'),
                        )
                      : [];
                const examples: KnowledgeTreeExample[] = examplesRaw
                  .filter((e: unknown) => e && typeof e === 'object')
                  .map((e: Record<string, unknown>) => ({
                    type: this.normalizeExampleType(e.type),
                    title:
                      typeof e.title === 'string' && e.title.trim()
                        ? e.title
                        : '示例',
                    content:
                      typeof e.content === 'string' ? e.content : '',
                  }))
                  .filter(
                    (e: KnowledgeTreeExample) =>
                      e.content || e.title !== '示例',
                  );

                const pointResult: KnowledgeTreePoint = {
                  title: pointTitle,
                  content: pointContent,
                };
                if (pointType) pointResult.pointType = pointType;
                if (examples.length > 0) pointResult.examples = examples;
                return pointResult;
              });

            const quotesRaw = Array.isArray(sub.originalQuotes)
              ? sub.originalQuotes
              : [];
            const originalQuotes: KnowledgeTreeOriginalQuote[] = quotesRaw
              .filter((q: unknown) => q && typeof q === 'object')
              .map((q: Record<string, unknown>) => ({
                text:
                  typeof q.text === 'string' && q.text.trim()
                    ? q.text
                    : '',
                chapterTitle:
                  typeof q.chapterTitle === 'string'
                    ? q.chapterTitle
                    : '',
              }))
              .filter((q: KnowledgeTreeOriginalQuote) => q.text);

            return {
              title: subTitle,
              intro: subIntro,
              points,
              originalQuotes,
            };
          });

        const sectionResult: KnowledgeTreeSection = {
          title,
          subsections,
        };
        if (sectionOverview) sectionResult.overview = sectionOverview;
        return sectionResult;
      });

    return { sections };
  }

  private async generateClosing(
    sectionTitles: string[],
    meta?: { title?: string; author?: string },
  ): Promise<string> {
    const bookLabel =
      meta?.title || meta?.author
        ? `${meta.title ? `《${meta.title}》` : ''}${meta.author ? ` 作者：${meta.author}` : ''}`
        : '本书';

    const sectionsText = sectionTitles
      .map((t: string, i: number) => `${i + 1}. ${t}`)
      .join('\n');

    const prompt = `你是一位内容总结专家。基于以下知识树的所有板块标题，为${bookLabel}生成一句收尾总结。

【所有板块】
${sectionsText}

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
      '全书知识树只有以下顶层字段：source、intro、coreLine、sections、closing。除此之外不得出现任何其他顶层字段。\n' +
      '1. 绝对禁止生成以下任何内容作为独立板块/子板块/字段：金句收束、行动清单、总结与行动、一句话总结、actionItems、actionList、oneSentenceSummary、finalQuote、summary。\n' +
      '2. 收尾只有 closing 一个字段，是一句 blockquote 式的收束语（25-50字），不需要也不允许拆成多条。\n' +
      '3. sections 下只放知识内容板块，禁止把「总结」「金句」「行动」「清单」「收尾」等命名为 section 或 subsection 标题。\n' +
      '4. originalQuotes 是子板块级别的原文句群引用，放在每个 subsection 下，不是独立板块。\n\n' +
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
      '- 原文引语：原文原话（用于 originalQuotes，保留原句原词）\n' +
      '再基于盘点结果设计能容纳所有内容块、覆盖无遗漏的分层架构。不能让任何内容块无处安放；若某类内容无处安放，就补一层而不是删内容。\n\n' +
      '第三步：剔除噪音\n' +
      '广告、重复内容、口播废话、题外话、致谢、赞助信息一律剔除，不进入知识树。\n\n' +
      '第四步：逻辑递进分层\n' +
      '按「导语 → 本质 → 机制 → 双面影响 → 人群/场景影响 → 应对与破局 → 收尾」的默认骨架组织。' +
      '允许按实际内容类型增删板块（例如工具方法论类可用「核心问题→底层原理→关键方法→实践步骤→常见误区→收尾」，' +
      '人物传记类可用「背景身份→人生转折→核心成就→性格思想→历史影响」）。' +
      '内容归位规则：\n' +
      '- 概念/定义/形式/类型 → 本质层\n' +
      '- 原理/机制/步骤/闭环 → 机制层\n' +
      '- 好处/坏处/代价 → 双面影响层\n' +
      '- 特定对象的差异化影响 → 人群/场景影响层\n' +
      '- 方法/方案/工具/技巧 → 应对与破局层\n' +
      '- 结论/核心论断 → 收尾句\n' +
      '每个板块下设 2-3 层子节点（板块→子板块→要点），形成真正的树状结构，不是扁平清单。\n\n' +
      '第五步：密集要点 + 配示例\n' +
      '每个子板块下是密集要点列表（- 列表形式），要点类型包括：定义 / 机制 / 实验 / 案例 / 数据 / 现象 / 结论。' +
      '每个要点的 content 必须完整、具体，讲清楚说明白，杜绝「只有标题没有说明」。' +
      '关键主张配【例】，完整过程不缩写；有实验/数据的写清实验设计与结论。' +
      '要点的 examples 数组中存放关键例子（实验/案例/数据），每个例子含完整过程：背景→动作→结果。\n\n' +
      '第六步：原文句群（originalQuotes）\n' +
      '每个子板块下挂 originalQuotes 数组，AI 基于原文，按该子板块的语义，提取直接相关的原文句子群。\n' +
      '- 保留原句原词，不得改写、不得编造\n' +
      '- 散落全书各处的相关原文按议题重组归集\n' +
      '- 标注每条原文的出处章节（chapterTitle，与用户提示中的章节标题对应）\n' +
      '- 控制总量：每个子板块取直接相关的若干句（精而不滥，宁缺毋滥），不要整段搬入无关上下文\n\n' +
      '第七步：观点性命名\n' +
      '板块/子板块标题必须点出具体观点（如「稀缺的本质」「机制一：注意力俘获」「代价二：救火循环与负向飞轮」），' +
      '禁止空泛词（如「机制总览」「全链路赋能」「核心要点」）。' +
      '全文对象、指标、例子保持同名同口径，不混用近义词。\n\n' +
      '第九步：生成后自校验\n' +
      '输出前自查：\n' +
      '1. 标题层级连续（板块→子板块→要点，没有跳层）\n' +
      '2. 噪音=0（广告/口播/致谢全删）\n' +
      '3. 覆盖度：盘点出的每个内容块都在树中命中，没有遗漏\n' +
      '4. 要点充实：每个要点都有完整 content，不是只有标题\n' +
      '5. 原文句群准确：originalQuotes 来自原文、保留原句、标注章节\n' +
      '6. 观点性命名：没有空泛标题\n' +
      '7. 结构合规：没有 summary / actionItems / finalQuote / 金句收束 / 行动清单 / 一句话总结 等旧格式字段或板块\n\n' +
      '第十步：输出长度管控（极其重要）\n' +
      '当原文内容较多、生成的知识树可能很长时，优先保证 JSON 结构的完整与合法性，' +
      '宁可适当精简要点描述、合并相近子板块、减少非核心 examples 的展开，也绝不允许输出在中途截断导致 JSON 残缺。' +
      '如果评估内容量接近输出上限，按以下优先级取舍：\n' +
      '1）保留所有板块和子板块的骨架（不能缺章少节）；\n' +
      '2）保留每个要点的核心观点（content 可适当压缩到 1 句）；\n' +
      '3）examples 只保留最关键的 1-2 个，其余可省略；\n' +
      '4）originalQuotes 只保留最相关的 2-3 句，宁缺毋滥。\n' +
      '最终输出必须是一个完整闭合的合法 JSON，任何情况下都不能以未闭合的数组或对象结尾。\n\n' +
      '【JSON 转义规则——极其重要，输出前必查】\n' +
      '1. 字符串内的中文引号「"」「\'」直接原样输出即可，不需要也不允许转成半角引号；\n' +
      '2. 字符串内禁止使用半角双引号（"），如原文确有英文/半角引号，请统一改写为中文引号「"」；\n' +
      '3. originalQuotes 中的原文引文必须保留原文措辞，但其中的半角引号一律改写为中文引号，绝不留半角引号在 JSON 字符串内；\n' +
      '4. 字符串中的反斜杠（\\）必须写为 \\\\，换行符必须写为 \\n，制表符必须写为 \\t；\n' +
      '5. 输出完成后，用眼睛扫一遍每个字符串值的起止引号，确保字符串内容里没有裸露的半角双引号；\n' +
      '6. 宁可用中文引号替换原文中的半角引号，也不能让 JSON 结构失效。\n\n' +
      '【输出格式——严格 JSON】\n' +
      '只输出 JSON，不要任何其他文字、markdown 代码块包裹或解释。JSON 结构如下：\n' +
      '{\n' +
      '  "source": "内容来源说明（书名/作者/内容类型，如「《稀缺》｜塞德希尔·穆来纳森｜理论概念类」）",\n' +
      '  "intro": "导语段落（说明本知识树由什么内容梳理而成、已剔除哪些噪音、按哪些板块组织、每板块下设几级子节点）",\n' +
      '  "coreLine": "核心主线（一句话概括全书核心，替代原来的 overview，是提炼后的核心论断）",\n' +
      '  "sections": [\n' +
      '    {\n' +
      '      "title": "观点性板块标题（如「稀缺的本质」）",\n' +
      '      "overview": "板块一句话概述（可选）",\n' +
      '      "subsections": [\n' +
      '        {\n' +
      '          "title": "观点性子板块标题（如「机制一：注意力俘获」）",\n' +
      '          "intro": "子板块引导语（可选）",\n' +
      '          "points": [\n' +
      '            {\n' +
      '              "title": "要点标题（精炼的观点短句）",\n' +
      '              "content": "要点正文：定义/机制/实验/案例/数据，写清楚讲明白，杜绝只有标题没有说明",\n' +
      '              "pointType": "definition|mechanism|experiment|case|data|phenomenon|conclusion（可选）",\n' +
      '              "examples": [\n' +
      '                {\n' +
      '                  "title": "示例名称",\n' +
      '                  "content": "完整过程：背景→动作→结果",\n' +
      '                  "type": "example|experiment|case|data"\n' +
      '                }\n' +
      '              ]\n' +
      '            }\n' +
      '          ],\n' +
      '          "originalQuotes": [\n' +
      '            {\n' +
      '              "text": "原句原词，保留原文措辞，不得改写",\n' +
      '              "chapterTitle": "出处章节标题（与用户提示中的章节标题对应）"\n' +
      '            }\n' +
      '          ]\n' +
      '        }\n' +
      '      ]\n' +
      '    }\n' +
      '  ],\n' +
      '  "closing": "收尾一句话总结（blockquote 式，有力收束，25-50字）"\n' +
      '}\n\n' +
      '要求：\n' +
      '1. sections 数量 4-7 个，板块之间有清晰的逻辑递进关系\n' +
      '2. 每个板块 2-4 个子板块，每个子板块 2-5 个要点\n' +
      '3. 要点内容是提炼后的成品干货，不是原文摘抄，但必须基于原文事实\n' +
      '4. 每个要点 content 必须含具体信息（定义/机制/数据/方法），禁止空话套话\n' +
      '5. examples 中实例/案例/实验必须保留完整过程，不缩写到只剩结论\n' +
      '6. originalQuotes 必须保留原句原词、标注章节标题、宁缺毋滥\n' +
      '7. 全文对象、指标、例子保持同名同口径\n' +
      '8. 只输出 JSON，不要任何其他文字或 markdown 包裹\n' +
      '9. 结构合规：顶层字段仅限 source / intro / coreLine / sections / closing；禁止 summary / actionItems / finalQuote / 金句收束 / 行动清单 / 一句话总结 等任何旧格式内容\n' +
      '10. closing 是唯一收尾形式，一句话、blockquote 式、25-50字\n'
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

  private repairJson(jsonStr: string): string {
    let s = jsonStr.trim();

    // 1. 去掉 markdown 代码块标记
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');

    // 2. 字符串感知的中文标点替换：只替换字符串外的 ，→ ,  ：→ :
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
    s = this.repairUnescapedQuotes(s);

    // 5. 字符串感知的漏逗号修复
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

    // 6. 补齐末尾缺失的闭合括号
    const braceDiff = this.countOutsideStrings(s, '{') - this.countOutsideStrings(s, '}');
    const bracketDiff = this.countOutsideStrings(s, '[') - this.countOutsideStrings(s, ']');

    if (braceDiff > 0 || bracketDiff > 0) {
      let closing = '';
      for (let i = 0; i < bracketDiff; i++) closing += ']';
      for (let i = 0; i < braceDiff; i++) closing += '}';
      s = s.replace(/\s*$/, closing);
    }

    // 7. 修复多余的末尾闭合括号
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
          result.push('"');
          inStr = true;
          i++;
        } else if (ch === '\\') {
          currentChunk.push(ch);
          if (i + 1 < s.length) { currentChunk.push(s[i + 1]); i += 2; } else { i++; }
        } else {
          currentChunk.push(ch);
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
        result.push('"');
        inStr = false;
        i++;
        continue;
      }

      result.push(ch);
      i++;
    }

    if (!inStr) {
      flushChunk();
    }

    return result.join('');
  }

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

  private isInsideStringAtEnd(s: string): boolean {
    let inStr = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\' && inStr) { i++; continue; }
      if (ch === '"') { inStr = !inStr; }
    }
    return inStr;
  }

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

  private isQuoteLikelyClosing(s: string, pos: number): boolean {
    let j = pos + 1;
    while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) {
      j++;
    }
    if (j >= s.length) return true;
    const next = s[j];
    if (next === ',' || next === ':' || next === ']' || next === '}') return true;
    if (next === '{' || next === '[' || next === '"') return true;
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

    const coreLine =
      typeof obj.coreLine === 'string' && obj.coreLine.trim()
        ? obj.coreLine
        : typeof obj.overview === 'string' && obj.overview.trim()
          ? obj.overview
          : '';

    const LEGACY_SECTION_TITLES = [
      '总结与行动', '金句收束', '一句话总结', '行动清单',
      '总结与行动清单', '核心金句', '金句与行动',
    ];
    const sectionsRaw = Array.isArray(obj.sections) ? obj.sections : [];
    const sections: KnowledgeTreeSection[] = sectionsRaw
      .filter((s: unknown) => s && typeof s === 'object')
      .filter((s: Record<string, unknown>) => {
        const t = typeof s.title === 'string' ? s.title.trim() : '';
        return !LEGACY_SECTION_TITLES.includes(t);
      })
      .map((s: Record<string, unknown>, si: number) => {
        const title =
          typeof s.title === 'string' && s.title.trim()
            ? s.title
            : `第 ${si + 1} 板块`;
        const sectionOverview =
          typeof s.overview === 'string' ? s.overview : undefined;

        const subsRaw = Array.isArray(s.subsections)
          ? s.subsections
          : Array.isArray(s.points)
              ? [{ points: s.points, title: '核心要点' }]
              : [];

        const subsections: KnowledgeTreeSubsection[] = subsRaw
          .filter((sub: unknown) => sub && typeof sub === 'object')
          .filter((sub: Record<string, unknown>) => {
            const t = typeof sub.title === 'string' ? sub.title.trim() : '';
            return !LEGACY_SECTION_TITLES.includes(t);
          })
          .map((sub: Record<string, unknown>, sbi: number) => {
            const subTitle =
              typeof sub.title === 'string' && sub.title.trim()
                ? sub.title
                : `要点 ${sbi + 1}`;
            const subIntro =
              typeof sub.intro === 'string' ? sub.intro : undefined;

            const pointsRaw = Array.isArray(sub.points) ? sub.points : [];
            const points: KnowledgeTreePoint[] = pointsRaw
              .filter((p: unknown) => p && typeof p === 'object')
              .map((p: Record<string, unknown>) => {
                const pointTitle =
                  typeof p.title === 'string' && p.title.trim()
                    ? p.title
                    : '要点';
                const pointContent =
                  typeof p.content === 'string' ? p.content : '';

                const pointType = this.normalizePointType(p.pointType);

                const examplesRaw = Array.isArray(p.examples)
                  ? p.examples
                  : Array.isArray(p.elements)
                      ? p.elements.filter(
                          (e: unknown) =>
                            e && typeof e === 'object' &&
                            ((e as Record<string, unknown>).type === 'example' ||
                             (e as Record<string, unknown>).type === 'experiment' ||
                             (e as Record<string, unknown>).type === 'case' ||
                             (e as Record<string, unknown>).type === 'data'),
                        )
                      : [];
                const examples: KnowledgeTreeExample[] = examplesRaw
                  .filter((e: unknown) => e && typeof e === 'object')
                  .map((e: Record<string, unknown>) => ({
                    type: this.normalizeExampleType(e.type),
                    title:
                      typeof e.title === 'string' && e.title.trim()
                        ? e.title
                        : '示例',
                    content:
                      typeof e.content === 'string' ? e.content : '',
                  }))
                  .filter(
                    (e: KnowledgeTreeExample) =>
                      e.content || e.title !== '示例',
                  );

                const pointResult: KnowledgeTreePoint = {
                  title: pointTitle,
                  content: pointContent,
                };
                if (pointType) pointResult.pointType = pointType;
                if (examples.length > 0) pointResult.examples = examples;
                return pointResult;
              });

            const quotesRaw = Array.isArray(sub.originalQuotes)
              ? sub.originalQuotes
              : [];
            const originalQuotes: KnowledgeTreeOriginalQuote[] = quotesRaw
              .filter((q: unknown) => q && typeof q === 'object')
              .map((q: Record<string, unknown>) => ({
                text:
                  typeof q.text === 'string' && q.text.trim()
                    ? q.text
                    : '',
                chapterTitle:
                  typeof q.chapterTitle === 'string'
                    ? q.chapterTitle
                    : '',
              }))
              .filter((q: KnowledgeTreeOriginalQuote) => q.text);

            return {
              title: subTitle,
              intro: subIntro,
              points,
              originalQuotes,
            };
          });

        const sectionResult: KnowledgeTreeSection = {
          title,
          subsections,
        };
        if (sectionOverview) sectionResult.overview = sectionOverview;
        return sectionResult;
      });

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
      sections,
      closing,
    };
    if (truncated !== undefined) result.truncated = truncated;
    if (coverageNote) result.coverageNote = coverageNote;
    return result;
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
            '你是一个实体识别专家。请从用户提供的文本中识别所有人物和地点。' +
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
