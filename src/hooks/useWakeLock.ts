import { useEffect, useState } from 'react';
import { createWakeLockController } from '../services/wakeLockManager';

interface WakeLockState {
  isSupported: boolean;
  isLocked: boolean;
}

/**
 * Forza lo schermo sempre attivo tramite Screen Wake Lock API (con ri-acquisizione automatica
 * su cambio visibilità, ritorno al focus o prima interazione utente se bloccato pre-gesture).
 */
export function useWakeLock(active = true): WakeLockState {
  const isSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    if (!active || typeof window === 'undefined' || typeof document === 'undefined') {
      setIsLocked(false);
      return;
    }

    const controller = createWakeLockController({
      onChange: setIsLocked,
    });
    void controller.setActive(true);

    const ensureLocked = () => {
      if (document.visibilityState === 'visible' && !controller.isLocked()) {
        void controller.acquire();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void controller.acquire();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', ensureLocked);
    window.addEventListener('pageshow', ensureLocked);
    window.addEventListener('pointerdown', ensureLocked, { passive: true, capture: true });
    window.addEventListener('touchstart', ensureLocked, { passive: true, capture: true });
    window.addEventListener('keydown', ensureLocked, { passive: true, capture: true });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', ensureLocked);
      window.removeEventListener('pageshow', ensureLocked);
      window.removeEventListener('pointerdown', ensureLocked, { capture: true });
      window.removeEventListener('touchstart', ensureLocked, { capture: true });
      window.removeEventListener('keydown', ensureLocked, { capture: true });
      void controller.dispose();
    };
  }, [active]);

  return { isSupported, isLocked };
}
