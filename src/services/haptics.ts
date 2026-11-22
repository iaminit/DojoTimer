import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNativeAndroidRuntime } from './nativeAndroid';
import { soundEngine, type SoundImpactEvent } from './soundEngine';

let lastButtonFeedbackAt = 0;
let lastRestScrubHapticAt = 0;
let soundEventHapticsEnabled = true;
let activeSoundHapticTimers: number[] = [];

function isNativeCapacitor(): boolean {
  return isNativeAndroidRuntime();
}

function triggerWebVibration(pattern: number | number[]): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Ignore blocked or unsupported browser vibration calls
    }
  }
}

export function cancelSoundEventHaptics(): void {
  if (typeof globalThis.clearTimeout === 'function') {
    for (const id of activeSoundHapticTimers) {
      globalThis.clearTimeout(id);
    }
  }
  activeSoundHapticTimers = [];
  triggerWebVibration(0);
}

export function setSoundEventHapticsEnabled(enabled: boolean): void {
  soundEventHapticsEnabled = Boolean(enabled);
  if (!soundEventHapticsEnabled) {
    cancelSoundEventHaptics();
  }
}

export function isSoundEventHapticsEnabled(): boolean {
  return soundEventHapticsEnabled;
}

function scheduleSoundHapticStep(delayMs: number, step: () => void): void {
  if (delayMs <= 0) {
    step();
    return;
  }
  const setTimer =
    typeof window !== 'undefined' && typeof window.setTimeout === 'function'
      ? window.setTimeout.bind(window)
      : (globalThis.setTimeout as unknown as (handler: () => void, timeout: number) => number);
  const id = setTimer(() => {
    activeSoundHapticTimers = activeSoundHapticTimers.filter((entry) => entry !== id);
    if (soundEventHapticsEnabled) {
      step();
    }
  }, delayMs);
  activeSoundHapticTimers.push(id);
}

/**
 * Feedback aptico + vibrazione sincronizzato con gli eventi sonori chiave del timer:
 * - START_GONG: colpo pesante + risonanza (+300ms)
 * - WARNING_BELL: avviso netto a -30s
 * - END_BELL: tre impulsi sincronizzati con i rintocchi reali (0ms, 240ms, 480ms)
 */
export function triggerSoundEventHaptic(event: SoundImpactEvent): void {
  if (!soundEventHapticsEnabled) {
    return;
  }

  cancelSoundEventHaptics();

  if (!isNativeCapacitor()) {
    switch (event) {
      case 'START_GONG':
        triggerWebVibration([240, 60, 110]);
        break;
      case 'WARNING_BELL':
        triggerWebVibration([150]);
        break;
      case 'END_BELL':
        triggerWebVibration([115, 125, 115, 125, 185]);
        break;
    }
    return;
  }

  switch (event) {
    case 'START_GONG':
      scheduleSoundHapticStep(0, () => {
        void Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
        void Haptics.vibrate({ duration: 240 }).catch(() => {});
      });
      scheduleSoundHapticStep(300, () => {
        void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
        void Haptics.vibrate({ duration: 110 }).catch(() => {});
      });
      break;
    case 'WARNING_BELL':
      scheduleSoundHapticStep(0, () => {
        void Haptics.notification({ type: NotificationType.Warning }).catch(() => {});
        void Haptics.vibrate({ duration: 150 }).catch(() => {});
      });
      break;
    case 'END_BELL':
      scheduleSoundHapticStep(0, () => {
        void Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
        void Haptics.vibrate({ duration: 115 }).catch(() => {});
      });
      scheduleSoundHapticStep(240, () => {
        void Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
        void Haptics.vibrate({ duration: 115 }).catch(() => {});
      });
      scheduleSoundHapticStep(480, () => {
        void Haptics.notification({ type: NotificationType.Success }).catch(() => {});
        void Haptics.vibrate({ duration: 185 }).catch(() => {});
      });
      break;
  }
}

export function triggerWheelHaptic(isHotspot: boolean): void {
  soundEngine.playWheelDetentClick(isHotspot);
  if (isHotspot) {
    void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(20);
      }
    });
  } else {
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(6);
      }
    });
  }
}

export function triggerButtonFeedback(emphasis: 'soft' | 'firm' = 'firm'): void {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - lastButtonFeedbackAt < 25) {
    return;
  }
  lastButtonFeedbackAt = now;

  soundEngine.playUiButtonClick(emphasis);
  if (emphasis === 'firm') {
    void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(14);
      }
    });
  } else {
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(6);
      }
    });
  }
}

/**
 * Feedback tattile all'aggancio dello slider di sfondo durante RECUPERO:
 * click pulsante deciso + impulso aptico/vibrazione.
 */
export function triggerRestScrubEngage(): void {
  soundEngine.unlock();
  soundEngine.playUiButtonClick('firm');
  if (isNativeCapacitor()) {
    void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
  } else {
    triggerWebVibration(14);
  }
}

/**
 * Feedback aptico a ogni tacca da 1 secondo durante lo scorrimento della barra di RECUPERO:
 * click leggero + micro-vibrazione (leggermente più decisa sui multipli di 10s o agli estremi).
 */
export function triggerRestScrubStep(displaySecond: number, isBoundary = false): void {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (!isBoundary && now - lastRestScrubHapticAt < 24) {
    return;
  }
  lastRestScrubHapticAt = now;

  const isMajor = isBoundary || (displaySecond > 0 && displaySecond % 10 === 0);
  soundEngine.playWheelDetentClick(isMajor);

  if (isNativeCapacitor()) {
    if (isBoundary) {
      void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
    } else if (isMajor) {
      void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    } else {
      void Haptics.vibrate({ duration: 10 }).catch(() => {});
    }
  } else {
    triggerWebVibration(isBoundary ? 18 : isMajor ? 12 : 7);
  }
}

/**
 * Conferma morbida al rilascio della barra di RECUPERO.
 */
export function triggerRestScrubRelease(): void {
  soundEngine.playUiButtonClick('soft');
  if (isNativeCapacitor()) {
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  } else {
    triggerWebVibration(10);
  }
}
