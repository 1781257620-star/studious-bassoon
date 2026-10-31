import { storage } from './storage';

const INIT_MARKER_KEY = 'ai_reader_initialized_v1';

const DEFAULT_API_KEY = 'sk-8f22df71d82644c0b983729b2013fa16';

export function runAppInit(): void {
  try {
    const initialized = localStorage.getItem(INIT_MARKER_KEY);
    if (initialized) return;

    if (!storage.hasApiKey() && DEFAULT_API_KEY) {
      storage.setApiKey(DEFAULT_API_KEY);
    }

    localStorage.setItem(INIT_MARKER_KEY, '1');
  } catch {
    // 静默失败，不影响应用启动
  }
}
