import { useState, useEffect, useCallback } from 'react';
import { storage } from '@client/src/services/storage';

export function useApiConfig() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    const key = storage.getApiKey();
    setApiKey(key);
    setIsConfigured(!!key);
  }, []);

  const saveApiKey = useCallback((key: string) => {
    storage.setApiKey(key);
    setApiKey(key);
    setIsConfigured(true);
  }, []);

  const clearApiKey = useCallback(() => {
    storage.clearApiKey();
    setApiKey(null);
    setIsConfigured(false);
  }, []);

  return { apiKey, isConfigured, saveApiKey, clearApiKey };
}
