export interface WakeLockSentinelLike {
  readonly released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
  removeEventListener?: (type: 'release', listener: () => void) => void;
}

export interface WakeLockNavigatorLike {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
}

export interface WakeLockControllerOptions {
  nav?: WakeLockNavigatorLike;
  doc?: Pick<Document, 'visibilityState'>;
  onChange?: (locked: boolean) => void;
}

export interface WakeLockController {
  readonly isSupported: boolean;
  isLocked: () => boolean;
  setActive: (nextActive: boolean) => Promise<void>;
  acquire: () => Promise<boolean>;
  release: () => Promise<void>;
  dispose: () => Promise<void>;
}

/**
 * Controller resiliente per Screen Wake Lock API:
 * evita richieste duplicate concorrenti, riacquisisce automaticamente al ritorno
 * in primo piano o dopo un rilascio involontario del sistema.
 */
export function createWakeLockController(
  options: WakeLockControllerOptions = {},
): WakeLockController {
  const nav =
    options.nav ??
    (typeof navigator !== 'undefined' ? (navigator as unknown as WakeLockNavigatorLike) : undefined);
  const doc = options.doc ?? (typeof document !== 'undefined' ? document : undefined);
  const wakeLockApi = nav?.wakeLock;
  const isSupported = Boolean(wakeLockApi && typeof wakeLockApi.request === 'function');

  let active = false;
  let disposed = false;
  let locked = false;
  let sentinel: WakeLockSentinelLike | null = null;
  let detachRelease: (() => void) | null = null;
  let inFlight: Promise<boolean> | null = null;

  const notify = (nextLocked: boolean) => {
    if (locked === nextLocked) return;
    locked = nextLocked;
    options.onChange?.(nextLocked);
  };

  const clearSentinel = () => {
    if (detachRelease) {
      detachRelease();
      detachRelease = null;
    }
    sentinel = null;
  };

  const release = async (): Promise<void> => {
    const current = sentinel;
    clearSentinel();
    notify(false);
    if (current && !current.released) {
      try {
        await current.release();
      } catch {
        // Ignore release errors
      }
    }
  };

  const acquire = async (): Promise<boolean> => {
    if (!isSupported || !wakeLockApi || !active || disposed) {
      return false;
    }
    if (doc && doc.visibilityState !== 'visible') {
      return false;
    }
    if (sentinel && !sentinel.released) {
      notify(true);
      return true;
    }
    if (inFlight) {
      return inFlight;
    }

    inFlight = (async () => {
      try {
        const next = await wakeLockApi.request('screen');
        if (!active || disposed) {
          try {
            await next.release();
          } catch {
            // Ignore release errors
          }
          notify(false);
          return false;
        }

        clearSentinel();
        sentinel = next;

        const onReleased = () => {
          if (sentinel === next) {
            clearSentinel();
          }
          notify(false);
          if (active && !disposed && (!doc || doc.visibilityState === 'visible')) {
            void acquire();
          }
        };

        next.addEventListener('release', onReleased);
        detachRelease = () => {
          next.removeEventListener?.('release', onReleased);
        };
        notify(true);
        return true;
      } catch {
        notify(false);
        return false;
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  };

  const setActive = async (nextActive: boolean): Promise<void> => {
    if (disposed) return;
    active = nextActive;
    if (!nextActive) {
      await release();
      return;
    }
    await acquire();
  };

  const dispose = async (): Promise<void> => {
    active = false;
    disposed = true;
    await release();
  };

  return {
    isSupported,
    isLocked: () => locked,
    setActive,
    acquire,
    release,
    dispose,
  };
}
