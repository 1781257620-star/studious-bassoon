import { BookOpen, Play, Trash2 } from 'lucide-react';
import { STATUS_LABELS } from '@client/src/types/book';
import type { Book, BookStatus } from '@client/src/types/book';

interface BookCardProps {
  book: Book;
  onClick?: () => void;
  onResume?: (bookId: string) => void;
  onDelete?: (bookId: string) => void;
}

const PROCESSING_STATUSES: BookStatus[] = [
  'pending',
  'downloading',
  'parsing',
  'chapterizing',
  'tree_generating',
  'entity_matching',
];

const RESUMABLE_STATUSES: BookStatus[] = [
  'downloading',
  'parsing',
  'chapterizing',
  'tree_generating',
  'entity_matching',
  'error',
];

function getStatusClass(status: BookStatus): string {
  if (status === 'done') return 'bg-accent text-primary';
  if (status === 'error') return 'bg-red-100 text-red-600';
  if (PROCESSING_STATUSES.includes(status))
    return 'bg-secondary text-primary';
  return 'bg-secondary text-muted-foreground';
}

const BookCard = ({ book, onClick, onResume, onDelete }: BookCardProps) => {
  const showProgress = PROCESSING_STATUSES.includes(book.status);
  const showActions = RESUMABLE_STATUSES.includes(book.status);

  const handleResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    onResume?.(book.id);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(book.id);
  };

  return (
    <div
      onClick={onClick}
      className="bg-card rounded-2xl p-4 shadow-sm flex gap-4 items-start active:scale-[0.99] transition-transform cursor-pointer"
      role="button"
      aria-label={`打开 ${book.title}`}
    >
      <div
        className="w-16 h-24 rounded-lg flex-shrink-0 flex items-center justify-center text-primary-foreground text-xs font-medium shadow-sm"
        style={{ backgroundColor: book.coverColor }}
      >
        <BookOpen size={24} strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-foreground truncate flex-1">
            {book.title}
          </h3>
          {book.isDemo && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 flex-shrink-0">
              演示
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-0.5 truncate">
          {book.author}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <span
            className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${getStatusClass(
              book.status,
            )}`}
          >
            {STATUS_LABELS[book.status]}
          </span>
          {showProgress && (
            <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${book.progress}%` }}
              />
            </div>
          )}
        </div>
        {showProgress && (
          <p className="text-xs text-muted-foreground mt-1.5">
            {book.progress}% 已处理
          </p>
        )}
        {book.status === 'error' && book.errorMessage && (
          <p className="text-xs text-red-500 mt-1.5 truncate">
            {book.errorMessage}
          </p>
        )}
        {showActions && (
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={handleResume}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium active:scale-95 transition-transform"
              aria-label={`继续处理 ${book.title}`}
            >
              <Play size={12} fill="currentColor" />
              {book.status === 'error' ? '重试' : '继续处理'}
            </button>
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground text-xs active:scale-95 transition-transform hover:text-red-500"
              aria-label={`删除 ${book.title}`}
            >
              <Trash2 size={12} />
              删除
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default BookCard;
