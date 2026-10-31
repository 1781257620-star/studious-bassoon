import type { Book, Chapter, KnowledgeNode, EntityItem } from '@client/src/types/book';

const STORAGE_KEYS = {
  BOOKS: 'ai_reader_books',
  CHAPTERS: 'ai_reader_chapters',
  NODES: 'ai_reader_nodes',
  ENTITIES: 'ai_reader_entities',
} as const;

function readArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function writeArray<T>(key: string, items: T[]): void {
  localStorage.setItem(key, JSON.stringify(items));
}

interface Store<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  add(item: T): Promise<T>;
  bulkAdd(items: T[]): Promise<T[]>;
  update(id: string, patch: Partial<T>): Promise<T | undefined>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  listByBook?(bookId: string): Promise<T[]>;
}

function createStore<T extends { id: string }>(key: string): Store<T> {
  return {
    async list(): Promise<T[]> {
      return readArray<T>(key);
    },

    async get(id: string): Promise<T | undefined> {
      const items = readArray<T>(key);
      return items.find((item: T) => item.id === id);
    },

    async add(item: T): Promise<T> {
      const items = readArray<T>(key);
      items.push(item);
      writeArray(key, items);
      return item;
    },

    async bulkAdd(newItems: T[]): Promise<T[]> {
      const items = readArray<T>(key);
      items.push(...newItems);
      writeArray(key, items);
      return newItems;
    },

    async update(id: string, patch: Partial<T>): Promise<T | undefined> {
      const items = readArray<T>(key);
      const index = items.findIndex((item: T) => item.id === id);
      if (index === -1) return undefined;
      items[index] = { ...items[index], ...patch };
      writeArray(key, items);
      return items[index];
    },

    async remove(id: string): Promise<void> {
      const items = readArray<T>(key);
      writeArray(
        key,
        items.filter((item: T) => item.id !== id),
      );
    },

    async clear(): Promise<void> {
      writeArray(key, []);
    },
  };
}

function createBookChildStore<T extends { id: string; bookId: string }>(
  key: string,
) {
  const base = createStore<T>(key);
  return {
    ...base,
    async listByBook(bookId: string): Promise<T[]> {
      const items = await base.list();
      return items.filter((item: T) => item.bookId === bookId);
    },
    async clearByBook(bookId: string): Promise<void> {
      const items = await base.list();
      const remaining = items.filter((item: T) => item.bookId !== bookId);
      writeArray(key, remaining);
    },
  };
}

export const db = {
  books: createStore<Book>(STORAGE_KEYS.BOOKS),
  chapters: createBookChildStore<Chapter>(STORAGE_KEYS.CHAPTERS),
  nodes: createBookChildStore<KnowledgeNode>(STORAGE_KEYS.NODES),
  entities: createBookChildStore<EntityItem>(STORAGE_KEYS.ENTITIES),
};
