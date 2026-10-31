import { useState, useEffect, useCallback } from 'react';
import { db } from '@client/src/services/db';
import type { Book } from '@client/src/types/book';

export function useBooks() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const list = await db.books.list();
    list.sort((a: Book, b: Book) => b.createdAt - a.createdAt);
    setBooks(list);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return { books, loading, refresh };
}
