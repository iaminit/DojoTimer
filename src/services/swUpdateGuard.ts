export interface SwUpdateGuard {
  setTimerSessionActive: (active: boolean) => void;
  notifyControllerChange: () => void;
  isTimerSessionActive: () => boolean;
  hasPendingReload: () => boolean;
}

/**
 * Evita che un aggiornamento del Service Worker ricarichi la pagina mentre
 * è in corso un incontro: rinvia il reload all'uscita dalla schermata TIMER.
 */
export function createSwUpdateGuard(onReload: () => void): SwUpdateGuard {
  let timerActive = false;
  let pendingReload = false;
  let reloaded = false;

  const triggerReloadOnce = () => {
    if (reloaded) return;
    reloaded = true;
    pendingReload = false;
    onReload();
  };

  return {
    setTimerSessionActive(active: boolean) {
      timerActive = active;
      if (!active && pendingReload) {
        triggerReloadOnce();
      }
    },
    notifyControllerChange() {
      if (reloaded) return;
      if (timerActive) {
        pendingReload = true;
        return;
      }
      triggerReloadOnce();
    },
    isTimerSessionActive: () => timerActive,
    hasPendingReload: () => pendingReload,
  };
}

const defaultGuard = createSwUpdateGuard(() => {
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
});

export function setTimerSessionActive(active: boolean): void {
  defaultGuard.setTimerSessionActive(active);
}

export function notifySwControllerChange(): void {
  defaultGuard.notifyControllerChange();
}
