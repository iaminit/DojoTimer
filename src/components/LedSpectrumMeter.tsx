import { useEffect, useRef, useState } from 'react';
import { AudioLines, Pause, Play, SkipForward } from 'lucide-react';
import { triggerButtonFeedback } from '../services/haptics';
import { localMusicPlayer, useLocalMusicPlayer } from '../services/musicPlayer';
import {
  isNativeAndroidRuntime,
  isNativeMusicActive,
  readNativeAudioSpectrum,
  requestNativePlaybackCapture,
  useNativePlaybackCaptureActive,
} from '../services/nativeAndroid';
import type { VuMeterMode } from '../types/timer';

interface LedSpectrumMeterProps {
  mode: VuMeterMode;
  accentHex: string;
  accentRgb: string;
  compact?: boolean;
  className?: string;
}

const COLUMN_COUNT = 16;
const COLOR_MODE_STORAGE_KEY = 'dojo_timer_vumeter_colorful_v1';

// Palette LED multicolore ad alto contrasto (attivabile con tap sul VU meter)
const LED_COLUMN_COLORS: readonly string[] = [
  '#FF6D00',
  '#00E676',
  '#00B0FF',
  '#FFD600',
  '#FF4081',
  '#E040FB',
  '#FF3B30',
  '#00E5FF',
  '#FFEA00',
  '#76FF03',
  '#2979FF',
  '#FF9100',
  '#00E676',
  '#00E5FF',
  '#FF3B30',
  '#E040FB',
];

const PEAK_CAP_COLORS: readonly string[] = [
  '#FF3D00',
  '#FFEA00',
  '#00E5FF',
  '#FF9100',
  '#FFEA00',
  '#FF80AB',
  '#FFEA00',
  '#80D8FF',
  '#B2FF59',
  '#FFEA00',
  '#40C4FF',
  '#FFD180',
  '#69F0AE',
  '#FF5252',
  '#FFEA00',
  '#FF80AB',
];

function loadSavedColorfulMode(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage?.getItem(COLOR_MODE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveColorfulMode(colorful: boolean): void {
  try {
    window.localStorage?.setItem(COLOR_MODE_STORAGE_KEY, colorful ? '1' : '0');
  } catch {
    // Ignore storage failures
  }
}

/**
 * VU Meter LED minimale 100% digitale e privo di distorsione (ZERO microfono fisico)
 * con tutte e 3 le modalità selezionabili in Opzioni:
 * 1. `PLAYBACK_CAPTURE`: cattura digitale `AudioPlaybackCapture` (`MediaProjection` solo audio) su Android 10+.
 * 2. `SESSION_VISUALIZER`: `Visualizer(sessionId)` agganciato a `OPEN_AUDIO_EFFECT_CONTROL_SESSION` / `Visualizer(0)`.
 * 3. `LOCAL_PLAYER`: player MP3/audio locale integrato con Web Audio `AnalyserNode` + mini controlli Play/Avanti.
 *
 * Default **monocolore** sincronizzato al colore attuale della fase (`accentRgb`);
 * toccando il VU meter alterna **Monocolore ↔ Multicolore**.
 */
export function LedSpectrumMeter({
  mode,
  accentHex,
  accentRgb,
  compact = false,
  className = '',
}: LedSpectrumMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const musicSnap = useLocalMusicPlayer();
  const isCaptureActive = useNativePlaybackCaptureActive();
  const [isNativeSignalVisible, setIsNativeSignalVisible] = useState(false);
  const [isColorful, setIsColorful] = useState<boolean>(() => loadSavedColorfulMode());

  const isCapacitorNative = isNativeAndroidRuntime();

  const visibleRef = useRef(false);
  const colorfulRef = useRef(isColorful);
  colorfulRef.current = isColorful;
  const accentRgbRef = useRef(accentRgb);
  accentRgbRef.current = accentRgb;
  const lastActiveAtRef = useRef(0);

  const fftRef = useRef<Float32Array>(new Float32Array(COLUMN_COUNT));
  const levelsRef = useRef<Float32Array>(new Float32Array(COLUMN_COUNT));
  const peaksRef = useRef<Float32Array>(new Float32Array(COLUMN_COUNT));
  const peakHoldTicksRef = useRef<Uint8Array>(new Uint8Array(COLUMN_COUNT));

  // Rilevamento attività solo per le modalità native (`SESSION_VISUALIZER` e `PLAYBACK_CAPTURE`)
  useEffect(() => {
    if (mode !== 'SESSION_VISUALIZER' && mode !== 'PLAYBACK_CAPTURE') {
      visibleRef.current = false;
      setIsNativeSignalVisible(false);
      return;
    }

    const checkNative = () => {
      if (mode === 'PLAYBACK_CAPTURE' && !isCaptureActive) {
        visibleRef.current = false;
        setIsNativeSignalVisible(false);
        return;
      }
      const sample = readNativeAudioSpectrum(fftRef.current);
      const extMusic = isNativeMusicActive();
      const now = performance.now();
      const hasAudio = sample.peak > 0.025;
      if (hasAudio) {
        lastActiveAtRef.current = now;
        if (!visibleRef.current) {
          visibleRef.current = true;
          setIsNativeSignalVisible(true);
        }
      } else if (visibleRef.current && now - lastActiveAtRef.current > (extMusic ? 1500 : 700)) {
        visibleRef.current = false;
        setIsNativeSignalVisible(false);
      }
    };

    checkNative();
    const id = window.setInterval(checkNative, 300);
    return () => {
      window.clearInterval(id);
    };
  }, [isCaptureActive, mode]);

  const showCanvas =
    (mode === 'LOCAL_PLAYER' && musicSnap.isPlaying) ||
    (mode === 'SESSION_VISUALIZER' && isNativeSignalVisible) ||
    (mode === 'PLAYBACK_CAPTURE' && isCaptureActive && isNativeSignalVisible);

  // Rendering LED 30fps esclusivamente quando c'è musica attiva (0% CPU da spento)
  useEffect(() => {
    if (!showCanvas) {
      levelsRef.current.fill(0);
      peaksRef.current.fill(0);
      peakHoldTicksRef.current.fill(0);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const rows = compact ? 5 : 7;
    let rafId = 0;
    let lastDrawAt = 0;

    const drawFrame = (now: number) => {
      rafId = window.requestAnimationFrame(drawFrame);
      if (now - lastDrawAt < 33) {
        return;
      }
      lastDrawAt = now;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW <= 0 || cssH <= 0) {
        return;
      }
      const targetW = Math.round(cssW * dpr);
      const targetH = Math.round(cssH * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const fft = fftRef.current;
      let peakVal = 0;
      if (mode === 'LOCAL_PLAYER') {
        peakVal = localMusicPlayer.sampleSpectrum(fft);
      } else {
        peakVal = readNativeAudioSpectrum(fft).peak;
      }
      if (peakVal > 0.025) {
        lastActiveAtRef.current = now;
      }

      const levels = levelsRef.current;
      const peaks = peaksRef.current;
      const holds = peakHoldTicksRef.current;

      for (let i = 0; i < COLUMN_COUNT; i += 1) {
        const target = fft[i];
        const cur = levels[i];
        levels[i] = target > cur ? cur + (target - cur) * 0.7 : Math.max(0, cur - 0.11);

        if (levels[i] >= peaks[i]) {
          peaks[i] = levels[i];
          holds[i] = 9;
        } else if (holds[i] > 0) {
          holds[i] -= 1;
        } else {
          peaks[i] = Math.max(0, peaks[i] - 0.05);
        }
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, cssW, cssH);

      const gapX = compact ? 2 : 2.5;
      const gapY = compact ? 1.5 : 2;
      const colW = (cssW - gapX * (COLUMN_COUNT - 1)) / COLUMN_COUNT;
      const segH = (cssH - gapY * (rows - 1)) / rows;
      const radius = Math.min(1.5, segH * 0.35);

      const useColorful = colorfulRef.current;
      const monoRgb = accentRgbRef.current;

      for (let c = 0; c < COLUMN_COUNT; c += 1) {
        const x = c * (colW + gapX);
        const litCount = Math.round(levels[c] * rows);
        const peakRow = Math.min(rows - 1, Math.floor(peaks[c] * rows));
        const hasPeakCap = peaks[c] > 0.08 && peakRow >= litCount;

        for (let r = 0; r < rows; r += 1) {
          const y = cssH - (r + 1) * segH - r * gapY;
          if (r < litCount) {
            if (useColorful) {
              ctx.fillStyle = LED_COLUMN_COLORS[c % LED_COLUMN_COLORS.length];
            } else {
              const rowAlpha = 0.62 + (r / Math.max(1, rows - 1)) * 0.38;
              ctx.fillStyle = `rgba(${monoRgb}, ${rowAlpha.toFixed(2)})`;
            }
          } else if (hasPeakCap && r === peakRow) {
            ctx.fillStyle = useColorful ? PEAK_CAP_COLORS[c % PEAK_CAP_COLORS.length] : '#FFFFFF';
          } else {
            ctx.fillStyle = useColorful
              ? 'rgba(255, 255, 255, 0.065)'
              : `rgba(${monoRgb}, 0.10)`;
          }

          if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(x, y, colW, segH, radius);
            ctx.fill();
          } else {
            ctx.fillRect(x, y, colW, segH);
          }
        }
      }

      ctx.restore();
    };

    rafId = window.requestAnimationFrame(drawFrame);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [compact, mode, showCanvas]);

  if (mode === 'OFF') {
    return null;
  }

  // Modalità 1 (`PLAYBACK_CAPTURE`) su Android: mostra pillola discreta 1-tap finché non è attivata
  if (mode === 'PLAYBACK_CAPTURE' && isCapacitorNative && !isCaptureActive) {
    return (
      <button
        type="button"
        onClick={() => {
          triggerButtonFeedback('soft');
          requestNativePlaybackCapture();
        }}
        data-testid="activate-digital-vu-btn"
        className={`inline-flex items-center justify-center gap-1.5 rounded-full border bg-black/88 font-extrabold tracking-[0.1em] text-white uppercase shadow-lg transition-all hover:bg-neutral-900 active:scale-95 cursor-pointer ${
          compact
            ? 'h-[24px] px-2.5 text-[9px]'
            : 'h-[36px] px-3.5 text-[10px] sm:h-[40px] sm:text-[11px]'
        } ${className}`}
        style={{ borderColor: `rgba(${accentRgb}, 0.55)` }}
        title="Attiva cattura audio digitale senza microfono"
      >
        <AudioLines className="h-3.5 w-3.5 shrink-0" style={{ color: accentHex }} />
        <span className="truncate">ATTIVA VU DIGITALE</span>
      </button>
    );
  }

  const handleToggleColorMode = () => {
    triggerButtonFeedback('soft');
    setIsColorful((prev) => {
      const next = !prev;
      saveColorfulMode(next);
      return next;
    });
  };

  // Modalità 3 (`LOCAL_PLAYER`): se ci sono brani caricati, integra mini controlli Play/Pausa + Avanti
  if (mode === 'LOCAL_PLAYER') {
    if (musicSnap.tracks.length === 0) {
      return null;
    }

    if (!showCanvas) {
      return (
        <button
          type="button"
          onClick={() => {
            triggerButtonFeedback('soft');
            localMusicPlayer.play();
          }}
          className={`inline-flex items-center justify-center gap-1.5 rounded-full border bg-black/88 font-extrabold tracking-[0.08em] text-white uppercase shadow-lg transition-all hover:bg-neutral-900 active:scale-95 cursor-pointer ${
            compact
              ? 'h-[24px] max-w-[190px] px-2.5 text-[9px]'
              : 'h-[36px] max-w-[240px] px-3.5 text-[10px] sm:h-[40px] sm:text-[11px]'
          } ${className}`}
          style={{ borderColor: `rgba(${accentRgb}, 0.45)` }}
          aria-label="Avvia musica locale"
        >
          <Play className="h-3 w-3 shrink-0" style={{ color: accentHex }} />
          <span className="truncate">
            {musicSnap.tracks[musicSnap.currentIndex]?.name ?? 'PLAY MUSICA'}
          </span>
        </button>
      );
    }

    return (
      <div className={`flex w-full items-center justify-center gap-1.5 ${className}`}>
        <button
          type="button"
          onClick={() => {
            triggerButtonFeedback('soft');
            localMusicPlayer.togglePlayPause();
          }}
          aria-label="Metti in pausa musica locale"
          className={`flex shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/90 text-white active:scale-95 cursor-pointer ${
            compact ? 'h-[24px] w-[24px]' : 'h-[34px] w-[34px] sm:h-[38px] sm:w-[38px]'
          }`}
        >
          <Pause className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        </button>

        <button
          type="button"
          onClick={handleToggleColorMode}
          data-testid="led-spectrum-meter"
          aria-label={
            isColorful
              ? 'VU meter multicolore — tocca per passare a monocolore fase'
              : 'VU meter monocolore fase — tocca per passare a multicolore'
          }
          title={isColorful ? 'Passa a VU meter monocolore' : 'Passa a VU meter multicolore'}
          className={`flex items-center justify-center overflow-hidden rounded-xl border bg-black/92 shadow-[0_4px_18px_rgba(0,0,0,0.75)] transition-all active:scale-95 cursor-pointer ${
            compact
              ? 'h-[24px] [@media(orientation:landscape)_and_(max-height:520px)]:h-[18px] w-full max-w-[140px] px-2 py-1'
              : 'h-[42px] w-full max-w-[200px] px-2.5 py-1.5 sm:h-[48px] sm:max-w-[240px]'
          }`}
          style={{
            borderColor: isColorful ? 'rgba(255, 255, 255, 0.24)' : `rgba(${accentRgb}, 0.48)`,
          }}
        >
          <canvas ref={canvasRef} className="pointer-events-none block h-full w-full" />
        </button>

        {musicSnap.tracks.length > 1 && (
          <button
            type="button"
            onClick={() => {
              triggerButtonFeedback('soft');
              localMusicPlayer.nextTrack(true);
            }}
            aria-label="Brano successivo"
            className={`flex shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/90 text-white active:scale-95 cursor-pointer ${
              compact ? 'h-[24px] w-[24px]' : 'h-[34px] w-[34px] sm:h-[38px] sm:w-[38px]'
            }`}
          >
            <SkipForward className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
          </button>
        )}
      </div>
    );
  }

  if (!showCanvas) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={handleToggleColorMode}
      data-testid="led-spectrum-meter"
      aria-label={
        isColorful
          ? 'VU meter multicolore — tocca per passare a monocolore fase'
          : 'VU meter monocolore fase — tocca per passare a multicolore'
      }
      title={isColorful ? 'Passa a VU meter monocolore' : 'Passa a VU meter multicolore'}
      className={`flex items-center justify-center overflow-hidden rounded-xl border bg-black/92 shadow-[0_4px_18px_rgba(0,0,0,0.75)] transition-all active:scale-95 cursor-pointer ${
        compact
          ? 'h-[24px] [@media(orientation:landscape)_and_(max-height:520px)]:h-[18px] w-full max-w-[190px] px-2 py-1'
          : 'h-[42px] w-full max-w-[240px] px-2.5 py-1.5 sm:h-[48px] sm:max-w-[290px]'
      } ${className}`}
      style={{
        borderColor: isColorful ? 'rgba(255, 255, 255, 0.24)' : `rgba(${accentRgb}, 0.48)`,
      }}
    >
      <canvas ref={canvasRef} className="pointer-events-none block h-full w-full" />
    </button>
  );
}
