const STORAGE_KEYS = {
  API_KEY: 'ai_reader_api_key',
  BOOKS: 'ai_reader_books',
  SETTINGS: 'ai_reader_settings',
} as const;

class StorageService {
  getApiKey(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEYS.API_KEY);
    } catch {
      return null;
    }
  }

  setApiKey(key: string): void {
    localStorage.setItem(STORAGE_KEYS.API_KEY, key);
  }

  clearApiKey(): void {
    localStorage.removeItem(STORAGE_KEYS.API_KEY);
  }

  hasApiKey(): boolean {
    return !!this.getApiKey();
  }

  getSizeLabel(): string {
    try {
      let total = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('ai_reader_')) {
          const value = localStorage.getItem(key) || '';
          total += key.length + value.length;
        }
      }
      if (total < 1024) return `${total} B`;
      if (total < 1024 * 1024) return `${(total / 1024).toFixed(1)} KB`;
      return `${(total / (1024 * 1024)).toFixed(2)} MB`;
    } catch {
      return '未知';
    }
  }
}

export const storage = new StorageService();
