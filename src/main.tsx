import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/plus-jakarta-sans/wght-italic.css';
import '@fontsource-variable/space-grotesk';
import './index.css';
import { App } from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { isNativeAndroidRuntime } from './services/nativeAndroid';
import { notifySwControllerChange } from './services/swUpdateGuard';

const isCapacitorNative = isNativeAndroidRuntime();

// Disabilita pinch-zoom su Android WebView, PWA mobile (incl. iOS Safari) e trackpad desktop
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const preventGesture = (event: Event) => {
    event.preventDefault();
  };
  const preventMultiTouch = (event: TouchEvent) => {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  };
  const preventWheelPinch = (event: WheelEvent) => {
    if (event.ctrlKey) {
      event.preventDefault();
    }
  };

  document.addEventListener('gesturestart', preventGesture, { passive: false });
  document.addEventListener('gesturechange', preventGesture, { passive: false });
  document.addEventListener('gestureend', preventGesture, { passive: false });
  document.addEventListener('touchstart', preventMultiTouch, { passive: false });
  document.addEventListener('touchmove', preventMultiTouch, { passive: false });
  window.addEventListener('wheel', preventWheelPinch, { passive: false });
}

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
