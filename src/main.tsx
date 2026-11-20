import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/plus-jakarta-sans/wght-italic.css';
import '@fontsource-variable/space-grotesk';
import './index.css';
import { App } from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { notifySwControllerChange } from './services/swUpdateGuard';

const isCapacitorNative =
  typeof window !== 'undefined' &&
  Boolean(
    (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
      ?.isNativePlatform?.(),
  );

if (!isCapacitorNative && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    notifySwControllerChange();
  });
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => {
      regs.forEach((r) => void r.update());
    })
    .catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
