import { useEffect, useState } from 'react';

export interface NativeTimerSyncPayload {
  active: boolean;
  running: boolean;
  paused: boolean;
  phaseLabel: string;
  roundLabel: string;
  timeText: string;
  remainingMs: number;
  colorHex: string;
}

interface DojoNativeInterface {
  syncTimerState?: (
    active: boolean,
    running: boolean,
    paused: boolean,
    phaseLabel: string,
    roundLabel: string,
    timeText: string,
    remainingMs: number,
    colorHex: string,
  ) => void;
}

type DojoWindow = Window & {
  DojoNative?: DojoNativeInterface;
  __dojoSetPipMode?: (isInPip: boolean) => void;
  __dojoNativeTogglePause?: () => void;
};

let currentPipMode = false;
const pipListeners = new Set<(isInPip: boolean) => void>();
let lastSyncedSignature = '';
let lastSyncedRemainingMs = 0;
let lastSyncedAtMs = 0;

function getDojoWindow(): DojoWindow | null {
  return typeof window !== 'undefined' ? (window as DojoWindow) : null;
}

function ensurePipHookInstalled(): void {
  const win = getDojoWindow();
  if (!win) return;
  win.__dojoSetPipMode = (isInPip: boolean) => {
    const next = Boolean(isInPip);
    if (currentPipMode === next) return;
    currentPipMode = next;
    for (const listener of pipListeners) {
      listener(next);
    }
  };
}

export function subscribeAndroidPipMode(listener: (isInPip: boolean) => void): () => void {
  ensurePipHookInstalled();
  pipListeners.add(listener);
  listener(currentPipMode);
  return () => {
    pipListeners.delete(listener);
  };
}

export function useAndroidPipMode(): boolean {
  const [isPip, setIsPip] = useState<boolean>(currentPipMode);
  useEffect(() => subscribeAndroidPipMode(setIsPip), []);
  return isPip;
}

export function registerNativeTogglePauseHandler(handler: () => void): () => void {
  const win = getDojoWindow();
  if (!win) {
    return () => {};
  }
  win.__dojoNativeTogglePause = handler;
  return () => {
    if (win.__dojoNativeTogglePause === handler) {
      delete win.__dojoNativeTogglePause;
    }
  };
}

export function resetNativeTimerSyncCache(): void {
  lastSyncedSignature = '';
  lastSyncedRemainingMs = 0;
  lastSyncedAtMs = 0;
}

/**
 * Sincronizza lo stato del timer con Android (PiP + icona tray bar + notifica live).
 * Evita di spammare `notify()` ogni secondo quando il countdown scorre linearmente
 * (Android ChronometerCountDown aggiorna i secondi nativamente), ma invia subito
 * aggiornamenti su cambi fase, round, pausa/ripresa, colore o scrub manuale del recupero.
 */
export function syncNativeTimerState(
  payload: NativeTimerSyncPayload,
  nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now(),
): boolean {
  const win = getDojoWindow();
  const bridge = win?.DojoNative;
  if (!bridge || typeof bridge.syncTimerState !== 'function') {
    return false;
  }

  const safeRemainingMs = Math.max(0, Math.round(payload.remainingMs));
  const signature = [
    payload.active ? '1' : '0',
    payload.running ? '1' : '0',
    payload.paused ? '1' : '0',
    payload.phaseLabel,
    payload.roundLabel,
    payload.paused || !payload.running ? payload.timeText : '',
    payload.colorHex,
  ].join('|');

  let shouldSend = signature !== lastSyncedSignature;
  if (!shouldSend && payload.active && payload.running && !payload.paused) {
    // Re-sync Android Chronometer if the remaining time jumped (e.g. manual REST bar scrub or skip)
    const expectedRemainingMs = Math.max(0, lastSyncedRemainingMs - (nowMs - lastSyncedAtMs));
    if (Math.abs(safeRemainingMs - expectedRemainingMs) >= 1200) {
      shouldSend = true;
    }
  }

  if (!shouldSend) {
    return false;
  }

  lastSyncedSignature = signature;
  lastSyncedRemainingMs = safeRemainingMs;
  lastSyncedAtMs = nowMs;

  try {
    bridge.syncTimerState(
      payload.active,
      payload.running,
      payload.paused,
      payload.phaseLabel,
      payload.roundLabel,
      payload.timeText,
      safeRemainingMs,
      payload.colorHex,
    );
    return true;
  } catch {
    return false;
  }
}
