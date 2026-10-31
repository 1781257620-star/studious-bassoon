import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, BookOpen, AlertTriangle } from 'lucide-react';
import { useBooks } from '@client/src/hooks/useBooks';
import { bookProcessor } from '@client/src/services/book-processor';
import BookCard from '@client/src/components/BookCard';
import AddBookDialog from '@client/src/components/AddBookDialog';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type { BookStatus } from '@client/src/types/book';
import { showConfirm } from '@lark-apaas/client-toolkit';

const TERMINAL_STATUSES: BookStatus[] = ['done', 'error'];

const ShelfPage = () => {
  const navigate = useNavigate();
  const { books, loading, refresh } = useBooks();
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 轮询刷新：存在非终态书籍时每 1 秒刷新
  const hasProcessing = books.some(
    (b) => !TERMINAL_STATUSES.includes(b.status),
  );

  useEffect(() => {
    if (hasProcessing) {
      if (intervalRef.current) return;
      intervalRef.current = setInterval(() => {
        void refresh();
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [hasProcessing, refresh]);

  const filteredBooks = books.filter(
    (b) =>
      b.title.toLowerCase().includes(query.toLowerCase()) ||
      b.author.toLowerCase().includes(query.toLowerCase()),
  );

  const handleBookClick = useCallback(
    (book: { id: string; status: BookStatus }) => {
      if (book.status === 'done') {
        navigate(`/read?bookId=${book.id}`);
      } else if (book.status === 'error') {
        // 错误状态也跳转到处理页查看详情
        navigate('/process');
      } else {
        navigate('/process');
      }
    },
    [navigate],
  );

  const handleAdded = useCallback(() => {
    void refresh();
  }, [refresh]);

  const handleResume = useCallback(
    (bookId: string) => {
      void bookProcessor.resumeProcessing(bookId);
      void refresh();
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (bookId: string) => {
      const book = books.find((b) => b.id === bookId);
      const title = book?.title || '该书';
      if (
        await showConfirm(`确定删除《${title}》吗？书籍及所有处理数据将被永久删除，无法恢复。`)
      ) {
        void bookProcessor.deleteBook(bookId).then(() => {
          void refresh();
        }).catch((err: unknown) => {
          logger.error('删除书籍失败', err);
        });
      }
    },
    [books, refresh],
  );

  return (
    <div className="px-5 pt-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">书架</h1>
          <p className="text-sm text-muted-foreground mt-1">
            共 {books.length} 本书
          </p>
        </div>
        <button
          onClick={() => setDialogOpen(true)}
          className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-sm active:scale-95 transition-transform"
          aria-label="添加书籍"
        >
          <Plus size={20} />
        </button>
      </div>

      <div className="relative mb-6">
        <Search
          size={18}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索书名或作者"
          className="w-full h-11 pl-11 pr-4 rounded-xl bg-secondary text-foreground placeholder:text-muted-foreground border-none outline-none focus:ring-2 focus:ring-primary/30 transition-all"
        />
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="text-center py-16 text-muted-foreground">
            加载中...
          </div>
        ) : books.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-20 mx-auto mb-4 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground">
              <BookOpen size={28} strokeWidth={1.5} />
            </div>
            <p className="text-foreground font-medium mb-1">书架空空如也</p>
            <p className="text-sm text-muted-foreground">
              点击右上角「+」添加你的第一本书
            </p>
          </div>
        ) : filteredBooks.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            没有找到相关书籍
          </div>
        ) : (
          filteredBooks.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onClick={() => handleBookClick(book)}
              onResume={handleResume}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>

      <AddBookDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onAdded={handleAdded}
      />
    </div>
  );
};

export default ShelfPage;
