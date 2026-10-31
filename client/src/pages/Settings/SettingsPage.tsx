import { useState, useEffect } from 'react';
import {
  Key,
  Save,
  Check,
  ChevronRight,
  Info,
  Trash2,
} from 'lucide-react';
import { useApiConfig } from '@client/src/hooks/useApiConfig';
import { storage } from '@client/src/services/storage';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';

const SettingsPage = () => {
  const { apiKey, isConfigured, saveApiKey, clearApiKey } = useApiConfig();
  const [inputKey, setInputKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (isConfigured && apiKey) {
      setInputKey(apiKey);
    }
  }, [isConfigured, apiKey]);

  const handleSave = () => {
    if (!inputKey.trim()) return;
    saveApiKey(inputKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClear = () => {
    clearApiKey();
    setInputKey('');
    setShowKey(false);
  };

  return (
    <div className="px-5 pt-6">
      <h1 className="text-2xl font-semibold text-foreground mb-6">设置</h1>

      <div className="space-y-5">
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3 px-1 uppercase tracking-wider">
            API 配置
          </h2>
          <div className="bg-card rounded-2xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border/60">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
                    <Key size={18} className="text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground text-sm">
                      DeepSeek API Key
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {isConfigured ? '已配置' : '尚未配置'}
                    </p>
                  </div>
                </div>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                    isConfigured
                      ? 'bg-accent text-primary'
                      : 'bg-secondary text-muted-foreground'
                  }`}
                >
                  {isConfigured ? '✓ 就绪' : '未配置'}
                </span>
              </div>
            </div>

            <div className="p-4 space-y-3">
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  placeholder="请输入 DeepSeek API Key"
                  className="w-full h-11 px-4 pr-20 rounded-xl bg-secondary text-foreground placeholder:text-muted-foreground border-none outline-none focus:ring-2 focus:ring-primary/30 transition-all text-sm font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showKey ? '隐藏' : '显示'}
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={!inputKey.trim()}
                  className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-40 disabled:active:scale-100"
                >
                  {saved ? (
                    <>
                      <Check size={18} />
                      已保存
                    </>
                  ) : (
                    <>
                      <Save size={16} />
                      保存
                    </>
                  )}
                </button>
                {isConfigured && (
                  <button
                    onClick={handleClear}
                    className="h-11 px-4 rounded-xl bg-secondary text-muted-foreground hover:text-destructive flex items-center justify-center active:scale-95 transition-all"
                    aria-label="清除 API Key"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              <div className="flex gap-2 p-3 bg-accent/40 rounded-xl">
                <Info size={16} className="text-primary flex-shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  API Key 仅保存在本地浏览器中，不会上传到任何服务器。
                  你可以在{' '}
                  <UniversalLink
                    to="https://platform.deepseek.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    DeepSeek 开放平台
                  </UniversalLink>{' '}
                  获取 API Key。
                </p>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3 px-1 uppercase tracking-wider">
            阅读设置
          </h2>
          <div className="bg-card rounded-2xl shadow-sm overflow-hidden">
            {[
              { label: '字体大小', value: '默认' },
              { label: '行间距', value: '舒适' },
              { label: '翻译风格', value: '大白话' },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between px-4 py-3.5 border-b border-border/60 last:border-b-0 active:bg-secondary/50 transition-colors cursor-pointer"
              >
                <span className="text-sm text-foreground">{item.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {item.value}
                  </span>
                  <ChevronRight
                    size={16}
                    className="text-muted-foreground/60"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3 px-1 uppercase tracking-wider">
            数据
          </h2>
          <div className="bg-card rounded-2xl shadow-sm overflow-hidden">
            {[
              { label: '本地存储占用', value: storage.getSizeLabel() },
              { label: '清空所有数据', value: '', danger: true },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between px-4 py-3.5 border-b border-border/60 last:border-b-0 active:bg-secondary/50 transition-colors cursor-pointer"
              >
                <span
                  className={`text-sm ${
                    item.danger ? 'text-destructive' : 'text-foreground'
                  }`}
                >
                  {item.label}
                </span>
                <div className="flex items-center gap-2">
                  {item.value && (
                    <span className="text-sm text-muted-foreground">
                      {item.value}
                    </span>
                  )}
                  <ChevronRight
                    size={16}
                    className="text-muted-foreground/60"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3 px-1 uppercase tracking-wider">
            关于
          </h2>
          <div className="bg-card rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3.5">
              <span className="text-sm text-foreground">版本</span>
              <span className="text-sm text-muted-foreground">0.1.0</span>
            </div>
          </div>
        </section>
      </div>

      <div className="h-8" />
    </div>
  );
};

export default SettingsPage;
