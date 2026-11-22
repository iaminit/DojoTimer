import { useEffect, useState } from 'react';
import type { VuMeterMode } from '../types/timer';

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
  requestAudioDucking?: (durationMs: number) => void;
  getMediaVolumePercent?: () => number;
  setVuMeterMode?: (mode: VuMeterMode) => void;
  requestPlaybackCapture?: () => void;
  stopPlaybackCapture?: () => void;
  isPlaybackCaptureActive?: () => boolean;
  isExternalMusicActive?: () => boolean;
  getAudioSpectrumCsv?: () => string;
  fetchVersionManifestAsync?: (
    reqId: number,
    currentBuild: number,
    currentVersion: string,
  ) => void;
  openOfficialApkDownload?: (url: string) => void;
  exitApp?: () => void;
}

type DojoWindow = Window & {
  DojoNative?: DojoNativeInterface;
  __dojoSetPipMode?: (isInPip: boolean) => void;
  __dojoNativeTogglePause?: () => void;
  __dojoSetPlaybackCaptureActive?: (active: boolean) => void;
  __dojoOnUpdateManifest?: (reqId: number, payload: string | null) => void;
};

let currentPipMode = false;
const pipListeners = new Set<(isInPip: boolean) => void>();
let lastSyncedSignature = '';
let lastSyncedRemainingMs = 0;
let lastSyncedAtMs = 0;

function getDojoWindow(): DojoWindow | null {
  return typeof window !== 'undefined' ? (window as DojoWindow) : null;
}

/**
 * Restituisce `true` quando l'app gira dentro la shell nativa Android (APK Capacitor),
 * verificando sia il bridge nativo `window.DojoNative` sia `Capacitor.isNativePlatform()`.
 */
export function isNativeAndroidRuntime(): boolean {
  const win = getDojoWindow();
  if (!win) {
    return false;
  }
  const cap = (win as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(win.DojoNative || cap?.isNativePlatform?.());
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

/**
 * Richiede su Android AudioFocus transitorio con ducking (`AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK`)
 * per abbassare temporaneamente eventuale musica di sottofondo (es. Spotify) durante gong/voce.
 */
export function requestNativeAudioDucking(durationMs: number): boolean {
  const bridge = getDojoWindow()?.DojoNative;
  if (!bridge || typeof bridge.requestAudioDucking !== 'function') {
    return false;
  }
  const safeDuration = Math.max(300, Math.min(8000, Math.round(durationMs)));
  try {
    bridge.requestAudioDucking(safeDuration);
    return true;
  } catch {
    return false;
  }
}

/**
 * Restituisce il volume multimediale Android corrente (0..100), oppure `null` su Web/PWA.
 */
export function getNativeMediaVolumePercent(): number | null {
  const bridge = getDojoWindow()?.DojoNative;
  if (!bridge || typeof bridge.getMediaVolumePercent !== 'function') {
    return null;
  }
  try {
    const raw = bridge.getMediaVolumePercent();
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
      return null;
    }
    return Math.max(0, Math.min(100, Math.round(raw)));
  } catch {
    return null;
  }
}

export interface NativeSpectrumSample {
  mode: 'P' | 'V' | '0';
  peak: number;
}

let currentPlaybackCaptureActive = false;
const playbackCaptureListeners = new Set<(active: boolean) => void>();

function ensurePlaybackCaptureHookInstalled(): void {
  const win = getDojoWindow();
  if (!win) return;
  win.__dojoSetPlaybackCaptureActive = (active: boolean) => {
    const next = Boolean(active);
    if (currentPlaybackCaptureActive === next) return;
    currentPlaybackCaptureActive = next;
    for (const listener of playbackCaptureListeners) {
      listener(next);
    }
  };
}

export function isNativePlaybackCaptureActive(): boolean {
  const bridge = getDojoWindow()?.DojoNative;
  if (bridge && typeof bridge.isPlaybackCaptureActive === 'function') {
    try {
      currentPlaybackCaptureActive = Boolean(bridge.isPlaybackCaptureActive());
    } catch {
      // Ignore
    }
  }
  return currentPlaybackCaptureActive;
}

export function subscribeNativePlaybackCaptureState(
  listener: (active: boolean) => void,
): () => void {
  ensurePlaybackCaptureHookInstalled();
  playbackCaptureListeners.add(listener);
  listener(isNativePlaybackCaptureActive());
  return () => {
    playbackCaptureListeners.delete(listener);
  };
}

export function useNativePlaybackCaptureActive(): boolean {
  const [active, setActive] = useState<boolean>(() => isNativePlaybackCaptureActive());
  useEffect(() => subscribeNativePlaybackCaptureState(setActive), []);
  return active;
}

export function setNativeVuMeterMode(mode: VuMeterMode): boolean {
  const bridge = getDojoWindow()?.DojoNative;
  if (!bridge || typeof bridge.setVuMeterMode !== 'function') {
    return false;
  }
  try {
    bridge.setVuMeterMode(mode);
    return true;
  } catch {
    return false;
  }
}

export function requestNativePlaybackCapture(): boolean {
  const bridge = getDojoWindow()?.DojoNative;
  if (!bridge || typeof bridge.requestPlaybackCapture !== 'function') {
    return false;
  }
  try {
    bridge.requestPlaybackCapture();
    return true;
  } catch {
    return false;
  }
}

export function stopNativePlaybackCapture(): boolean {
  const bridge = getDojoWindow()?.DojoNative;
  if (!bridge || typeof bridge.stopPlaybackCapture !== 'function') {
    return false;
  }
  try {
    bridge.stopPlaybackCapture();
    return true;
  } catch {
    return false;
  }
}

export function isNativeMusicActive(): boolean {
  const bridge = getDojoWindow()?.DojoNative;
  if (!bridge || typeof bridge.isExternalMusicActive !== 'function') {
    return false;
  }
  try {
    return Boolean(bridge.isExternalMusicActive());
  } catch {
    return false;
  }
}

/**
 * Legge lo spettro FFT 100% digitale da Android:
 * - `P|...`: `AudioPlaybackCapture` (`MediaProjection` solo audio, zero microfono, zero distorsione)
 * - `V|...`: `Visualizer(sessionId)` su sessione player esterna / mix digitale
 */
export function readNativeAudioSpectrum(targetBands: Float32Array): NativeSpectrumSample {
  const bridge = getDojoWindow()?.DojoNative;
  if (!bridge || typeof bridge.getAudioSpectrumCsv !== 'function') {
    targetBands.fill(0);
    return { mode: '0', peak: 0 };
  }
  try {
    const raw = bridge.getAudioSpectrumCsv();
    if (typeof raw !== 'string' || raw.length < 2) {
      targetBands.fill(0);
      return { mode: '0', peak: 0 };
    }
    const modeChar = raw[0];
    const mode: 'P' | 'V' | '0' = modeChar === 'P' || modeChar === 'V' ? modeChar : '0';
    const sep = raw.indexOf('|');
    if (mode === '0' || sep === -1 || sep + 1 >= raw.length) {
      targetBands.fill(0);
      return { mode: '0', peak: 0 };
    }
    const parts = raw.slice(sep + 1).split(',');
    const count = Math.min(targetBands.length, parts.length);
    let peak = 0;
    for (let i = 0; i < targetBands.length; i += 1) {
      if (i < count) {
        const parsed = Number.parseInt(parts[i], 10);
        const norm = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed / 100)) : 0;
        targetBands[i] = norm;
        if (norm > peak) peak = norm;
      } else {
        targetBands[i] = 0;
      }
    }
    return { mode, peak };
  } catch {
    targetBands.fill(0);
    return { mode: '0', peak: 0 };
  }
}

let nativeUpdateManifestSeq = 0;
const pendingUpdateManifestRequests = new Map<number, (payload: string | null) => void>();

/**
 * Esegue la query HTTPS a `https://1ms.it/timer/version.json` tramite client nativo Android
 * (evita blocchi CORS della WebView su `https://localhost`).
 * Restituisce il JSON parsato oppure `null` se offline/non disponibile.
 */
export function fetchNativeRemoteVersionManifest(
  currentBuildNumber: number,
  currentVersion: string,
): Promise<unknown | null> | null {
  const win = getDojoWindow();
  const bridge = win?.DojoNative;
  if (!win || !bridge || typeof bridge.fetchVersionManifestAsync !== 'function') {
    return null;
  }

  win.__dojoOnUpdateManifest = (reqId: number, payload: string | null) => {
    const resolver = pendingUpdateManifestRequests.get(reqId);
    if (!resolver) return;
    pendingUpdateManifestRequests.delete(reqId);
    resolver(payload);
  };

  nativeUpdateManifestSeq += 1;
  const reqId = nativeUpdateManifestSeq;

  return new Promise<unknown | null>((resolve) => {
    let settled = false;
    const finish = (raw: string | null) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null && typeof globalThis.clearTimeout === 'function') {
        globalThis.clearTimeout(timeoutId);
      }
      pendingUpdateManifestRequests.delete(reqId);
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    };

    const timeoutId =
      typeof globalThis.setTimeout === 'function'
        ? globalThis.setTimeout(() => finish(null), 6000)
        : null;

    pendingUpdateManifestRequests.set(reqId, finish);
    try {
      bridge.fetchVersionManifestAsync!(reqId, Math.max(0, Math.round(currentBuildNumber)), currentVersion);
    } catch {
      finish(null);
    }
  });
}

/**
 * Apre il download dell'APK ufficiale (`https://1ms.it/timer/DojoTimer.apk`) tramite Intent Android
 * nativo così il browser/download manager avvia subito il download dell'aggiornamento.
 */
export function openNativeApkDownload(url: string): boolean {
  const bridge = getDojoWindow()?.DojoNative;
  if (!bridge || typeof bridge.openOfficialApkDownload !== 'function') {
    return false;
  }
  try {
    bridge.openOfficialApkDownload(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Chiude in modo pulito l'app Android (ferma servizi, audio e rimuove il task dai Recenti).
 */
export function exitNativeApp(): boolean {
  const bridge = getDojoWindow()?.DojoNative;
  if (!bridge || typeof bridge.exitApp !== 'function') {
    return false;
  }
  try {
    bridge.exitApp();
    return true;
  } catch {
    return false;
  }
}
