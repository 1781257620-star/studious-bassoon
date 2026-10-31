import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  Check,
  Loader2,
  Clock,
  X,
  BookOpen,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';

import { Button } from '@client/src/components/ui/button';
import { useBooks } from '@client/src/hooks/useBooks';
import { bookProcessor } from '@client/src/services/book-processor';
import { aiService } from '@client/src/services/ai';
import {
  STEPS,
  STEP_LABELS,
  STEP_DESCRIPTIONS,
  STATUS_LABELS,
  type Book,
  type StepStatus,
  type BookStatus,
} from '@client/src/types/book';

const REFRESH_INTERVAL = 1000;
const API_KEY_ERROR = 'API_KEY_NOT_CONFIGURED';

// 状态到 step index 的映射：当前正在进行的 step 下标
// pending(在第0步之前) → -1
// downloading → 0, parsing → 1, chapterizing → 2, tree_generating → 3, entity_matching → 4
// done(全部完成) → 5
// error 单独处理
const STATUS_TO_STEP_INDEX: Partial<Record<BookStatus, number>> = {
  pending: -1,
  downloading: 0,
  parsing: 1,
  chapterizing: 2,
  tree_generating: 3,
  entity_matching: 4,
  done: 5,
};

function getStepStatus(book: Book, stepIndex: number): StepStatus {
  if (book.status === 'error') {
    // 错误状态下用 progress 估算卡在哪一步：5 步每步约 20%
    const errorStep = Math.min(4, Math.floor(book.progress / 20));
    if (stepIndex < errorStep) return 'done';
    if (stepIndex === errorStep) return 'error';
    return 'pending';
  }

  const currentStep = STATUS_TO_STEP_INDEX[book.status];
  if (currentStep === undefined) return 'pending';

  if (stepIndex < currentStep) return 'done';
  if (stepIndex === currentStep) return 'running';
  return 'pending';
}

function isFinalStatus(status: BookStatus): boolean {
  return status === 'done' || status === 'error';
}

function getStatusBadgeClass(status: BookStatus): string {
  switch (status) {
    case 'done':
      return 'bg-primary/15 text-primary';
    case 'error':
      return 'bg-destructive/15 text-destructive';
    case 'pending':
      return 'bg-secondary text-muted-foreground';
    default:
      return 'bg-primary/15 text-primary';
  }
}

interface StepTimelineProps {
  book: Book;
}

function StepTimeline({ book }: StepTimelineProps) {
  return (
    <div className="relative pl-1">
      {STEPS.map((stepKey, idx) => {
        const status = getStepStatus(book, idx);
        const isLast = idx === STEPS.length - 1;
        const label = STEP_LABELS[stepKey];
        const desc = STEP_DESCRIPTIONS[stepKey];

        const iconClass =
          'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 z-10';
        const lineClass = `absolute left-[15px] top-8 w-0.5 h-[calc(100%-8px)]`;

        let iconBg = '';
        let iconColor = '';
        let lineColor = '';
        let titleColor = '';

        switch (status) {
          case 'done':
            iconBg = 'bg-primary text-primary-foreground';
            lineColor = 'bg-primary/60';
            titleColor = 'text-foreground';
            break;
          case 'running':
            iconBg = 'bg-primary/15 text-primary';
            lineColor = 'bg-border';
            titleColor = 'text-foreground';
            break;
          case 'error':
            iconBg = 'bg-destructive text-destructive-foreground';
            lineColor = 'bg-border';
            titleColor = 'text-destructive';
            break;
          case 'pending':
          default:
            iconBg = 'bg-secondary text-muted-foreground';
            lineColor = 'bg-border';
            titleColor = 'text-muted-foreground';
            break;
        }

        return (
          <div key={stepKey} className="flex gap-3 relative">
            {!isLast && <div className={`${lineClass} ${lineColor}`} />}
            <div className={`${iconClass} ${iconBg} ${iconColor}`}>
              {status === 'done' && <Check size={16} strokeWidth={3} />}
              {status === 'running' && (
                <Loader2 size={16} className="animate-spin" />
              )}
              {status === 'error' && <X size={16} strokeWidth={3} />}
              {status === 'pending' && <Clock size={16} />}
            </div>
            <div className="pb-5 flex-1">
              <p className={`font-medium text-sm ${titleColor}`}>
                第 {idx + 1} 步 · {label}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface BookProcessCardProps {
  book: Book;
  onRetry: (bookId: string) => void;
  onStartRead: (bookId: string) => void;
  onGoSettings: () => void;
  onForceRealAi?: (bookId: string) => void;
  apiKeyConfigured: boolean;
}

function BookProcessCard({
  book,
  onRetry,
  onStartRead,
  onGoSettings,
  onForceRealAi,
  apiKeyConfigured,
}: BookProcessCardProps) {
  const [expanded, setExpanded] = useState(!isFinalStatus(book.status));

  const isApiKeyError =
    book.status === 'error' && book.errorMessage === API_KEY_ERROR;

  return (
    <div className="bg-card rounded-2xl p-5 shadow-sm">
      {/* 书籍头部 */}
      <div className="flex items-start gap-3 mb-4">
        <div
          className="w-12 h-16 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: book.coverColor + '40' }}
        >
          <BookOpen size={20} style={{ color: book.coverColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-foreground truncate">
              {book.title}
            </h3>
            {book.isDemo && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-primary font-medium shrink-0">
                演示
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{book.author}</p>
          <div className="flex items-center gap-2 mt-2">
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${getStatusBadgeClass(
                book.status,
              )}`}
            >
              {STATUS_LABELS[book.status]}
            </span>
          </div>
        </div>
      </div>

      {/* 总进度条 */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${book.progress}%` }}
          />
        </div>
        <span className="text-xs text-primary font-medium w-10 text-right">
          {book.progress}%
        </span>
      </div>

      {/* 展开/折叠时间线 */}
      {expanded && (
        <>
          <div className="border-t border-border/50 pt-4">
            <StepTimeline book={book} />
          </div>

          {/* 错误信息 */}
          {book.status === 'error' && book.errorMessage && (
            <div className="mt-2 border-t border-border/50 pt-4">
              {isApiKeyError ? (
                <div className="bg-destructive/10 rounded-xl p-3">
                  <p className="text-sm text-destructive font-medium mb-2">
                    API Key 未配置
                  </p>
                  <p className="text-xs text-muted-foreground mb-3">
                    请前往设置页配置 DeepSeek API Key 后重试
                  </p>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="w-full rounded-xl"
                    onClick={onGoSettings}
                  >
                    <Settings size={14} />
                    前往设置
                  </Button>
                </div>
              ) : (
                <div className="bg-destructive/10 rounded-xl p-3">
                  <p className="text-xs text-destructive">
                    错误信息：{book.errorMessage}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 操作按钮 */}
          {book.status === 'error' && !isApiKeyError && (
            <div className="mt-3">
              <Button
                size="sm"
                variant="secondary"
                className="w-full rounded-xl"
                onClick={() => onRetry(book.id)}
              >
                <RefreshCw size={14} />
                重新处理
              </Button>
            </div>
          )}

          {book.status === 'done' && (
            <div className="mt-3 space-y-2">
              <Button
                size="sm"
                variant="default"
                className="w-full rounded-xl"
                onClick={() => onStartRead(book.id)}
              >
                <BookOpen size={14} />
                开始阅读
              </Button>
              {book.isDemo ? (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full rounded-xl"
                    onClick={() => onRetry(book.id)}
                  >
                    <RefreshCw size={14} />
                    重新生成演示知识树
                  </Button>
                  {apiKeyConfigured && onForceRealAi ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full rounded-xl"
                      onClick={() => onForceRealAi(book.id)}
                    >
                      <Sparkles size={14} />
                      用真实 AI 重新生成
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full rounded-xl"
                      onClick={onGoSettings}
                    >
                      <Settings size={14} />
                      配置 API Key 用真实 AI 生成
                    </Button>
                  )}
                </>
              ) : apiKeyConfigured ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full rounded-xl"
                  onClick={() => onForceRealAi?.(book.id)}
                >
                  <RefreshCw size={14} />
                  重新生成知识树
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full rounded-xl"
                  onClick={onGoSettings}
                >
                  <Settings size={14} />
                  重新生成（需配置 API Key）
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {/* 折叠时显示展开按钮 */}
      {!expanded && isFinalStatus(book.status) && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
        >
          点击展开详情
        </button>
      )}
    </div>
  );
}

interface EmptyStateProps {
  onLoadSample: () => void;
  onGoShelf: () => void;
  loading: boolean;
}

function EmptyState({ onLoadSample, onGoShelf, loading }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-20 h-20 rounded-full bg-accent flex items-center justify-center mb-5">
        <Sparkles size={32} className="text-primary" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">
        还没有处理中的书籍
      </h3>
      <p className="text-sm text-muted-foreground text-center mb-6 max-w-xs">
        添加一本书籍后，AI 将自动为你生成知识树，拆解核心观点。
      </p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Button
          variant="default"
          className="w-full rounded-xl"
          onClick={onLoadSample}
          disabled={loading}
        >
          <Sparkles size={16} />
          加载示例文章
        </Button>
        <Button
          variant="secondary"
          className="w-full rounded-xl"
          onClick={onGoShelf}
        >
          <BookOpen size={16} />
          去书架添加
        </Button>
      </div>
    </div>
  );
}

const ProcessPage = () => {
  const { books, loading, refresh } = useBooks();
  const navigate = useNavigate();
  const [apiKeyConfigured, setApiKeyConfigured] = useState(aiService.isConfigured());

  useEffect(() => {
    setApiKeyConfigured(aiService.isConfigured());
  }, []);

  const processingCount = books.filter(
    (b: Book) => !isFinalStatus(b.status),
  ).length;

  const allFinal = books.length > 0 && books.every((b: Book) => isFinalStatus(b.status));

  // 实时刷新
  useEffect(() => {
    if (allFinal) return;

    const timer = setInterval(() => {
      refresh().catch((err: unknown) => {
        logger.error('刷新书籍列表失败', err);
      });
    }, REFRESH_INTERVAL);

    return () => clearInterval(timer);
  }, [allFinal, refresh]);

  const handleLoadSample = useCallback(async () => {
    try {
      const book = await bookProcessor.addSampleBook();
      // 启动处理（fire-and-forget，进度通过轮询刷新）
      void bookProcessor.startProcessing(book.id);
      await refresh();
    } catch (err) {
      logger.error('加载示例书籍失败', err);
    }
  }, [refresh]);

  const handleRetry = useCallback(
    async (bookId: string) => {
      try {
        void bookProcessor.resumeProcessing(bookId);
        await refresh();
        await new Promise((resolve) => setTimeout(resolve, 200));
        await refresh();
      } catch (err) {
        logger.error('继续处理失败', err);
      }
    },
    [refresh],
  );

  const handleForceRealAi = useCallback(
    async (bookId: string) => {
      try {
        void bookProcessor.resumeProcessing(bookId, { forceRealAi: true, forceRestart: true });
        await refresh();
        await new Promise((resolve) => setTimeout(resolve, 200));
        await refresh();
      } catch (err) {
        logger.error('真实 AI 重新生成失败', err);
      }
    },
    [refresh],
  );

  const handleStartRead = useCallback(
    (bookId: string) => {
      navigate(`/read?bookId=${bookId}`);
    },
    [navigate],
  );

  const handleGoSettings = useCallback(() => {
    navigate('/settings');
  }, [navigate]);

  const handleGoShelf = useCallback(() => {
    navigate('/');
  }, [navigate]);

  return (
    <div className="px-5 pt-6 pb-[calc(60px+env(safe-area-inset-bottom))]">
      {/* 顶部标题 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-foreground">AI 处理</h1>
        {processingCount > 0 && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-accent text-primary font-medium">
            {processingCount} 本处理中
          </span>
        )}
      </div>

      {/* 书籍列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-primary" />
        </div>
      ) : books.length === 0 ? (
        <EmptyState
          onLoadSample={handleLoadSample}
          onGoShelf={handleGoShelf}
          loading={loading}
        />
      ) : (
        <div className="space-y-4">
          {books.map((book: Book) => (
            <BookProcessCard
              key={book.id}
              book={book}
              onRetry={handleRetry}
              onStartRead={handleStartRead}
              onGoSettings={handleGoSettings}
              onForceRealAi={handleForceRealAi}
              apiKeyConfigured={apiKeyConfigured}
            />
          ))}
        </div>
      )}

      {/* 底部说明 */}
      {books.length > 0 && (
        <div className="bg-secondary/60 rounded-2xl p-4 mt-6">
          <h3 className="text-sm font-semibold text-foreground mb-2">
            处理流水线
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            书籍将按照「下载 → 解析 → 切章 → 知识树生成 → 实体识别」的顺序逐步处理。
            支持断点续跑，关闭页面后再次打开可继续。
          </p>
        </div>
      )}
    </div>
  );
};

export default ProcessPage;
