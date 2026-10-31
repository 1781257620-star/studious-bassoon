import { useRef, useState } from 'react';
import {
  X,
  Sparkles,
  BookDown,
  Loader2,
  FileText,
  ClipboardPaste,
  Upload,
} from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { bookProcessor } from '@client/src/services/book-processor';

interface AddBookDialogProps {
  open: boolean;
  onClose: () => void;
  onAdded: (bookId: string) => void;
}

type ImportMode = 'file' | 'paste';

const AddBookDialog = ({ open, onClose, onAdded }: AddBookDialogProps) => {
  const [showZlibInput, setShowZlibInput] = useState(false);
  const [zlibTitle, setZlibTitle] = useState('');
  const [loadingSample, setLoadingSample] = useState(false);
  const [loadingZlib, setLoadingZlib] = useState(false);

  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('paste');
  const [importText, setImportText] = useState('');
  const [importTitle, setImportTitle] = useState('');
  const [importAuthor, setImportAuthor] = useState('');
  const [loadingImport, setLoadingImport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSample = async () => {
    if (loadingSample) return;
    setLoadingSample(true);
    try {
      const book = await bookProcessor.addSampleBook();
      void bookProcessor.startProcessing(book.id);
      onAdded(book.id);
      onClose();
    } finally {
      setLoadingSample(false);
    }
  };

  const handleZlibDownload = async () => {
    if (loadingZlib || !zlibTitle.trim()) return;
    setLoadingZlib(true);
    try {
      const book = await bookProcessor.addZlibBook(zlibTitle.trim());
      void bookProcessor.startProcessing(book.id);
      onAdded(book.id);
      setZlibTitle('');
      setShowZlibInput(false);
      onClose();
    } finally {
      setLoadingZlib(false);
    }
  };

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      setImportText(text);
      if (!importTitle.trim()) {
        const defaultTitle = text
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 30);
        setImportTitle(defaultTitle);
      }
      logger.info('已读取文件', file.name, `${text.length} 字`);
    } catch (err) {
      logger.error('读取文件失败', err);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handlePasteText = () => {
    setImportMode('paste');
  };

  const handleImportConfirm = async () => {
    const text = importText.trim();
    if (loadingImport || text.length === 0) return;

    setLoadingImport(true);
    try {
      const title =
        importTitle.trim() || text.replace(/\s+/g, ' ').slice(0, 30);
      const book = await bookProcessor.addManualBook(
        title,
        importAuthor.trim(),
        text,
      );
      void bookProcessor.startProcessing(book.id);
      onAdded(book.id);
      resetImportPanel();
      onClose();
    } finally {
      setLoadingImport(false);
    }
  };

  const resetImportPanel = () => {
    setImportText('');
    setImportTitle('');
    setImportAuthor('');
    setImportMode('paste');
    setShowImportPanel(false);
  };

  const handleClose = () => {
    resetImportPanel();
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) handleClose();
  };

  const textLength = importText.length;
  const canImport = textLength > 0 && !loadingImport;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      onClick={handleBackdropClick}
      style={{
        backgroundColor: 'rgba(44, 59, 56, 0.4)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        className="w-full max-w-[480px] bg-card/95 backdrop-blur-md rounded-t-3xl p-5 pb-8 shadow-lg animate-slide-up max-h-[90vh] overflow-y-auto"
        style={{ animation: 'slideUp 0.3s ease-out' }}
      >
        {/* 顶部把手 */}
        <div className="w-10 h-1 bg-muted-foreground/20 rounded-full mx-auto mb-4" />

        {/* 标题与关闭 */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-semibold text-foreground">
            {showImportPanel ? '导入文本' : '添加书籍'}
          </h2>
          <button
            onClick={handleClose}
            className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground active:scale-95 transition-transform"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        {!showImportPanel && (
          <div className="space-y-3">
            {/* 内置示例文章卡片 */}
            <button
              onClick={handleSample}
              disabled={loadingSample}
              className="w-full text-left p-4 rounded-2xl bg-accent/50 border border-primary/20 active:scale-[0.99] transition-transform disabled:opacity-60"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center text-primary flex-shrink-0">
                  <Sparkles size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">
                      内置示例文章
                    </h3>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                      示例
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                    加载一篇完整示例文章，体验完整知识树阅读流程（演示数据）
                  </p>
                </div>
                {loadingSample && (
                  <Loader2
                    size={18}
                    className="text-primary animate-spin flex-shrink-0 mt-1"
                  />
                )}
              </div>
            </button>

            {/* 导入文本卡片 */}
            <div className="p-4 rounded-2xl bg-card border border-border shadow-sm">
              <button
                onClick={() => setShowImportPanel(true)}
                className="w-full text-left active:scale-[0.99] transition-transform"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center text-primary flex-shrink-0">
                    <FileText size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground">
                      导入文本
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                      粘贴文本或上传 .txt / .md 文件，生成专属知识树
                    </p>
                  </div>
                </div>
              </button>
            </div>

            {/* 输入书名下载卡片 */}
            <div className="p-4 rounded-2xl bg-card border border-border shadow-sm">
              <button
                onClick={() => setShowZlibInput(!showZlibInput)}
                disabled={loadingZlib}
                className="w-full text-left active:scale-[0.99] transition-transform disabled:opacity-60"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center text-primary flex-shrink-0">
                    <BookDown size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground">
                      输入书名下载
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                      从 Z-Library 镜像自动下载（占位，后续接入真实下载 agent）
                    </p>
                  </div>
                </div>
              </button>

              {showZlibInput && (
                <div className="mt-4 flex gap-2 animate-fade-in">
                  <input
                    type="text"
                    value={zlibTitle}
                    onChange={(e) => setZlibTitle(e.target.value)}
                    placeholder="请输入书名"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleZlibDownload();
                    }}
                    className="flex-1 h-10 px-3 rounded-xl bg-secondary text-foreground placeholder:text-muted-foreground border-none outline-none focus:ring-2 focus:ring-primary/30 transition-all text-sm"
                    autoFocus
                  />
                  <button
                    onClick={handleZlibDownload}
                    disabled={loadingZlib || !zlibTitle.trim()}
                    className="px-4 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loadingZlib ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      '下载'
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {showImportPanel && (
          <div className="space-y-4 animate-fade-in">
            {/* 导入方式切换 */}
            <div className="flex gap-2 bg-secondary rounded-xl p-1">
              <button
                type="button"
                onClick={() => setImportMode('paste')}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${
                  importMode === 'paste'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
              >
                <ClipboardPaste size={16} />
                粘贴文本
              </button>
              <button
                type="button"
                onClick={() => {
                  setImportMode('file');
                  fileInputRef.current?.click();
                }}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${
                  importMode === 'file'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
              >
                <Upload size={16} />
                选择文件
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              onChange={handleFileChange}
              className="hidden"
            />

            {/* 文本输入区 */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                文本内容
              </label>
              <textarea
                value={importText}
                onChange={(e) => {
                  setImportText(e.target.value);
                  if (!importTitle.trim() && e.target.value.trim()) {
                    const defaultTitle = e.target.value
                      .replace(/\s+/g, ' ')
                      .trim()
                      .slice(0, 30);
                    setImportTitle(defaultTitle);
                  }
                }}
                placeholder={
                  importMode === 'file'
                    ? '点击上方「选择文件」选择 .txt 或 .md 文件，或直接在此粘贴文本'
                    : '在此粘贴书籍或文章全文...'
                }
                className="w-full h-40 px-3 py-2 rounded-xl bg-secondary text-foreground placeholder:text-muted-foreground border-none outline-none focus:ring-2 focus:ring-primary/30 transition-all text-sm resize-y leading-relaxed"
              />
              <div className="flex justify-between mt-1.5 px-1">
                <span className="text-xs text-muted-foreground">
                  {textLength.toLocaleString()} 字
                </span>
                {textLength > 0 && (
                  <button
                    type="button"
                    onClick={() => setImportText('')}
                    className="text-xs text-muted-foreground hover:text-primary active:scale-95 transition-transform"
                  >
                    清空
                  </button>
                )}
              </div>
            </div>

            {/* 书籍信息 */}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  标题
                </label>
                <input
                  type="text"
                  value={importTitle}
                  onChange={(e) => setImportTitle(e.target.value)}
                  placeholder="自动取文本前 30 字，可修改"
                  className="w-full h-10 px-3 rounded-xl bg-secondary text-foreground placeholder:text-muted-foreground border-none outline-none focus:ring-2 focus:ring-primary/30 transition-all text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  作者（可选）
                </label>
                <input
                  type="text"
                  value={importAuthor}
                  onChange={(e) => setImportAuthor(e.target.value)}
                  placeholder="未知作者"
                  className="w-full h-10 px-3 rounded-xl bg-secondary text-foreground placeholder:text-muted-foreground border-none outline-none focus:ring-2 focus:ring-primary/30 transition-all text-sm"
                />
              </div>
            </div>

            {/* 导入按钮 */}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={resetImportPanel}
                className="w-[90px] h-11 rounded-xl bg-secondary text-foreground font-medium active:scale-[0.99] transition-transform"
              >
                返回
              </button>
              <button
                type="button"
                onClick={handleImportConfirm}
                disabled={!canImport}
                className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground font-medium flex items-center justify-center gap-2 active:scale-[0.99] transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingImport ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    导入中...
                  </>
                ) : (
                  '导入并生成知识树'
                )}
              </button>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              导入后将自动解析、切章并生成知识树，时间取决于文本长度
            </p>
          </div>
        )}

        {/* 底部关闭（仅主视图显示） */}
        {!showImportPanel && (
          <button
            onClick={handleClose}
            className="w-full mt-5 h-11 rounded-xl bg-secondary text-foreground font-medium active:scale-[0.99] transition-transform"
          >
            取消
          </button>
        )}
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up { animation: slideUp 0.3s ease-out; }
        .animate-fade-in { animation: fadeIn 0.2s ease-out; }
      `}</style>
    </div>
  );
};

export default AddBookDialog;
