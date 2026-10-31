import { useSearchParams, useNavigate } from 'react-router-dom';
import { BookOpen, ArrowLeft, Loader2, AlertCircle, Sparkles, MoreHorizontal, RefreshCw, Settings } from 'lucide-react';
import { useState } from 'react';
import { useReader } from '@client/src/hooks/useReader';
import KnowledgeTree from '@client/src/components/KnowledgeTree';
import { STATUS_LABELS } from '@client/src/types/book';
import { bookProcessor } from '@client/src/services/book-processor';
import { aiService } from '@client/src/services/ai';

const ReadPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const bookId = searchParams.get('bookId');

  const { book, nodes, rootNode, loading, refresh } = useReader(bookId);
  const [showMenu, setShowMenu] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const apiKeyConfigured = aiService.isConfigured();

  const handleRegenerate = async () => {
    if (!book) return;
    setShowMenu(false);
    setRegenerating(true);
    try {
      const forceReal = !book.isDemo && apiKeyConfigured;
      await bookProcessor.startProcessing(book.id, { forceRealAi: forceReal });
      await refresh();
    } catch (err) {
      // 错误由状态轮询展示
    } finally {
      setRegenerating(false);
    }
  };

  // 空态：没有 bookId
  if (!bookId) {
    return (
      <div className="px-5 pt-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold text-foreground">阅读</h1>
        </div>

        <div className="bg-card rounded-2xl p-8 shadow-sm text-center">
          <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center mx-auto mb-4">
            <BookOpen size={28} className="text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            选择一本书开始阅读
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            从书架中选择一本已生成知识树的书籍，
            <br />
            即可进入结构化阅读模式
          </p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mt-6 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium active:scale-[0.98] transition-transform"
          >
            前往书架
          </button>
        </div>

        <div className="mt-8 space-y-4">
          <h3 className="text-sm font-semibold text-foreground px-1">
            阅读功能
          </h3>
            <div className="grid grid-cols-2 gap-3">
             {[
               { title: '精读笔记', desc: '全景总览→板块→要点' },
               { title: '实例金句', desc: '结构化元素一目了然' },
               { title: '原文回溯', desc: '一键定位原文出处' },
               { title: '人物识别', desc: '人名一键查卡' },
             ].map((item) => (
              <div key={item.title} className="bg-secondary rounded-xl p-4">
                <p className="font-medium text-foreground text-sm">
                  {item.title}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 加载态
  if (loading) {
    return (
      <div className="px-5 pt-6">
        <div className="flex items-center gap-3 mb-6">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center active:scale-[0.98] transition-transform"
            aria-label="返回"
          >
            <ArrowLeft size={18} className="text-foreground" />
          </button>
          <div className="flex-1 h-6 bg-secondary rounded w-32 animate-pulse" />
        </div>
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 size={28} className="text-primary animate-spin" />
          <p className="mt-3 text-sm text-muted-foreground">加载中…</p>
        </div>
      </div>
    );
  }

  // 书籍不存在
  if (!book) {
    return (
      <div className="px-5 pt-6">
        <div className="flex items-center gap-3 mb-6">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center active:scale-[0.98] transition-transform"
            aria-label="返回"
          >
            <ArrowLeft size={18} className="text-foreground" />
          </button>
          <h1 className="text-lg font-semibold text-foreground">书籍不存在</h1>
        </div>
        <div className="bg-card rounded-2xl p-8 shadow-sm text-center">
          <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4">
            <AlertCircle size={28} className="text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            书籍不存在
          </h2>
          <p className="text-sm text-muted-foreground">
            该书籍可能已被删除或链接无效
          </p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mt-6 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium active:scale-[0.98] transition-transform"
          >
            返回书架
          </button>
        </div>
      </div>
    );
  }

  // 书籍尚未处理完成
  if (book.status !== 'done') {
    return (
      <div className="px-5 pt-6">
        <div className="flex items-center gap-3 mb-6">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center active:scale-[0.98] transition-transform"
            aria-label="返回"
          >
            <ArrowLeft size={18} className="text-foreground" />
          </button>
          <h1 className="text-lg font-semibold text-foreground truncate">
            {book.title}
          </h1>
        </div>
        <div className="bg-card rounded-2xl p-8 shadow-sm text-center">
          <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center mx-auto mb-4">
            <Sparkles size={28} className="text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            书籍尚未处理完成
          </h2>
          <p className="text-sm text-muted-foreground mb-1">
            当前状态：{STATUS_LABELS[book.status]}
          </p>
          <p className="text-sm text-muted-foreground">
            请前往 AI 处理页查看进度，完成后即可阅读
          </p>
          <button
            type="button"
            onClick={() => navigate('/process')}
            className="mt-6 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium active:scale-[0.98] transition-transform"
          >
            前往处理页
          </button>
        </div>
      </div>
    );
  }

  // 正常阅读态
  return (
    <div className="flex flex-col h-screen">
      {/* 顶部导航栏 */}
      <div className="flex-shrink-0 px-5 pt-4 pb-3 flex items-center gap-3 bg-background">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center active:scale-[0.98] transition-transform flex-shrink-0"
          aria-label="返回"
        >
          <ArrowLeft size={18} className="text-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-foreground truncate">
            {book.title}
          </h1>
          <p className="text-xs text-muted-foreground truncate">
            {book.author}
          </p>
        </div>
        {book.isDemo && (
          <span className="flex-shrink-0 text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 font-medium">
            演示数据
          </span>
        )}
        <div className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setShowMenu((prev) => !prev)}
            className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center active:scale-[0.98] transition-transform"
            aria-label="更多操作"
            disabled={regenerating}
          >
            {regenerating ? (
              <Loader2 size={18} className="text-foreground animate-spin" />
            ) : (
              <MoreHorizontal size={18} className="text-foreground" />
            )}
          </button>
          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowMenu(false)}
              />
              <div className="absolute right-0 top-11 z-50 w-56 rounded-xl bg-card shadow-lg border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={handleRegenerate}
                  className="w-full px-4 py-3 text-left text-sm text-foreground hover:bg-accent/50 active:bg-accent flex items-center gap-3"
                >
                  <RefreshCw size={16} className="text-primary" />
                  <div>
                    <div className="font-medium">
                      {book.isDemo ? '重新生成演示知识树' : '重新生成知识树'}
                    </div>
                    {!book.isDemo && !apiKeyConfigured && (
                      <div className="text-xs text-muted-foreground">
                        需先配置 API Key
                      </div>
                    )}
                  </div>
                </button>
                {book.isDemo && apiKeyConfigured && (
                  <button
                    type="button"
                    onClick={async () => {
                      setShowMenu(false);
                      setRegenerating(true);
                      try {
                        await bookProcessor.startProcessing(book.id, { forceRealAi: true });
                        await refresh();
                      } finally {
                        setRegenerating(false);
                      }
                    }}
                    className="w-full px-4 py-3 text-left text-sm text-foreground hover:bg-accent/50 active:bg-accent flex items-center gap-3 border-t border-border/60"
                  >
                    <Sparkles size={16} className="text-primary" />
                    <div className="font-medium">用真实 AI 重新生成</div>
                  </button>
                )}
                {!apiKeyConfigured && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false);
                      navigate('/settings');
                    }}
                    className="w-full px-4 py-3 text-left text-sm text-foreground hover:bg-accent/50 active:bg-accent flex items-center gap-3 border-t border-border/60"
                  >
                    <Settings size={16} className="text-muted-foreground" />
                    <div className="font-medium">配置 API Key</div>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 知识树内容区 */}
      <div
        className="flex-1 overflow-y-auto px-2 pb-[calc(60px+env(safe-area-inset-bottom))]"
        data-ai-section-type="card-list"
      >
        <div className="py-2">
          <KnowledgeTree nodes={nodes} rootNode={rootNode} />
        </div>
      </div>
    </div>
  );
};

export default ReadPage;
