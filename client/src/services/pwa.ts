import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';

const SW_VERSION = 'v3';
const SW_PATH = `sw.js?v=${SW_VERSION}`;

let registration: ServiceWorkerRegistration | undefined;
let hasNewVersion = false;

export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  const rawBase = (window as any).__BASENAME__ || '/';
  const basePath = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

  if (!document.querySelector('link[rel="manifest"]')) {
    const manifest = {
      name: 'AI 阅读工作台',
      short_name: 'AI 阅读',
      description: '本地 PWA 阅读应用，知识树阅读器',
      theme_color: '#F2ECDF',
      background_color: '#F2ECDF',
      display: 'standalone',
      start_url: basePath,
      scope: basePath,
      icons: [
        {
          src: `${basePath}favicon.svg`,
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any',
        },
      ],
    };
    const blob = new Blob([JSON.stringify(manifest)], {
      type: 'application/manifest+json',
    });
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = URL.createObjectURL(blob);
    document.head.appendChild(link);
  }

  const swUrl = `${basePath}${SW_PATH}`;

  navigator.serviceWorker
    .register(swUrl, {
      updateViaCache: 'none',
      scope: basePath,
    })
    .then((reg) => {
      registration = reg;
      logger.info('SW registered:', reg.scope);

      if (reg.waiting) {
        notifyUpdate();
      }

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            notifyUpdate();
          }
        });
      });

      setInterval(() => {
        reg.update().catch(() => {});
      }, 5 * 60 * 1000);
    })
    .catch((err) => {
      logger.error('SW registration failed:', err);
    });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

function notifyUpdate(): void {
  if (hasNewVersion) return;
  hasNewVersion = true;

  toast('发现新版本', {
    description: '点击刷新以使用最新版本',
    action: {
      label: '刷新',
      onClick: () => {
        if (registration?.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        } else {
          window.location.reload();
        }
      },
    },
    duration: Infinity,
    closeButton: true,
  });
}
