import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  SkipBack,
  SkipForward,
  VolumeX,
  X,
} from 'lucide-react';
import {
  computeSessionSummary,
  REST_SCRUB_MIN_REMAINING_MS,
  type TimerEngineState,
} from '../engine/timerMachine';
import { useCurrentClock } from '../hooks/useCurrentClock';
import { useDialogFocusTrap } from '../hooks/useDialogFocusTrap';
import { useNativeBackHandler } from '../hooks/useNativeBackHandler';
import type { FillProgressSubscriber } from '../hooks/useTimerEngine';
import {
  triggerRestScrubEngage,
  triggerRestScrubRelease,
  triggerRestScrubStep,
} from '../services/haptics';
import { getNativeMediaVolumePercent } from '../services/nativeAndroid';
import { soundEngine, type SoundImpactEvent } from '../services/soundEngine';
import type { SolidColorKey, TimerColorMode, TimerLayoutMode, VuMeterMode } from '../types/timer';
import { formatDurationHuman, getClockDisplay } from '../utils/formatTime';
import { resolveProTimerPalette } from '../utils/proTimerTheme';
import {
  resolveTimerPhaseBannerLabel,
  type VisualThemeTokens,
} from '../utils/themePalette';
import { CircularTimerDisplay } from './CircularTimerDisplay';
import { ClassicWaveBackground } from './ClassicWaveBackground';
import { GongRippleOverlay } from './GongRippleOverlay';
import { GongVideoBackdrop } from './GongVideoBackdrop';
import { LedSpectrumMeter } from './LedSpectrumMeter';
import { RoundSegmentsBar } from './RoundSegmentsBar';
import { UltraModernTimerDisplay } from './UltraModernTimerDisplay';

const IMPACT_SHAKE_CLASSES = [
  'animate-gong-shake',
  'animate-warning-shake',
  'animate-end-bell-shake',
] as const;

const IMPACT_SHAKE_CONFIG: Record<
  SoundImpactEvent,
  { className: (typeof IMPACT_SHAKE_CLASSES)[number]; durationMs: number }
> = {
  START_GONG: { className: 'animate-gong-shake', durationMs: 720 },
  WARNING_BELL: { className: 'animate-warning-shake', durationMs: 500 },
  END_BELL: { className: 'animate-end-bell-shake', durationMs: 1000 },
};

interface MinimalTimerScreenProps {
  state: TimerEngineState;
  theme: VisualThemeTokens;
  timerLayout?: TimerLayoutMode;
  backgroundOpacity?: number;
  digitScale?: number;
  vuMeterMode?: VuMeterMode;
  colorMode?: TimerColorMode;
  solidColor?: SolidColorKey;
  fillProgress: number;
  subscribeFillProgress?: FillProgressSubscriber;
  onPause: () => void;
  onResume: () => void;
  onTogglePause: () => void;
  onRestartCurrentRound?: (resumeAfter?: boolean) => void;
  onSkipForward?: (resumeAfter?: boolean) => void;
  onSkipBackward?: (resumeAfter?: boolean) => void;
  onRestartSession: (resumeAfter?: boolean) => void;
  onBeginRestScrub?: () => void;
  onScrubRestProgress?: (progress: number) => void;
  onEndRestScrub?: () => void;
  isPipMode?: boolean;
  onConfirmExit: () => void;
}

const REST_SCRUB_DEADZONE_PX = 4;

interface RestScrubGesture {
  pointerId: number;
  startX: number;
  startY: number;
  startProgress: number;
  trackSpan: number;
  phaseDurationMs: number;
  isLandscape: boolean;
  engaged: boolean;
  lastEmittedSec: number;
}

export function MinimalTimerScreen({
  state,
  theme,
  timerLayout = 'CLASSIC',
  backgroundOpacity = 50,
  digitScale = 100,
  vuMeterMode = 'OFF',
  colorMode = 'AUTO',
  solidColor = 'GREEN',
  fillProgress,
  subscribeFillProgress,
  onPause,
  onResume,
  onTogglePause,
  onRestartCurrentRound,
  onSkipForward,
  onSkipBackward,
  onRestartSession,
  onBeginRestScrub,
  onScrubRestProgress,
  onEndRestScrub,
  isPipMode = false,
  onConfirmExit,
}: MinimalTimerScreenProps) {
  const isFinished = state.phase === 'FINISHED';
  const isProLayout = timerLayout === 'PRO';
  const bgOpacityAlpha = (Math.min(100, Math.max(0, backgroundOpacity)) / 100).toFixed(2);
  const phaseBannerLabel = resolveTimerPhaseBannerLabel(state.phase, state.program.discipline);
  const proClock = getClockDisplay(state.remainingMs);
  const proPalette = resolveProTimerPalette(
    state.phase,
    proClock.totalDisplaySeconds,
    fillProgress,
    { colorMode, solidColor },
  );
  const currentTime = useCurrentClock();
  const [gongRippleKey, setGongRippleKey] = useState(0);
  const [isGongVideoActive, setIsGongVideoActive] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const impactShakeTimeoutRef = useRef<number | null>(null);
  const [isExitModalOpen, setIsExitModalOpen] = useState(false);
  const [isRoundMenuOpen, setIsRoundMenuOpen] = useState(false);
  const [isMediaMuted, setIsMediaMuted] = useState(false);
  const [muteWarningDismissed, setMuteWarningDismissed] = useState(false);
  const wasRunningBeforeExitRef = useRef(false);
  const wasRunningBeforeRoundMenuRef = useRef(false);
  const exitDialogRef = useRef<HTMLDivElement | null>(null);
  const roundMenuDialogRef = useRef<HTMLDivElement | null>(null);
  const backBtnRef = useRef<HTMLButtonElement | null>(null);
  const restartBtnRef = useRef<HTMLButtonElement | null>(null);
  const confirmYesBtnRef = useRef<HTMLButtonElement | null>(null);
  const cancelNoBtnRef = useRef<HTMLButtonElement | null>(null);
  const restartRoundBtnRef = useRef<HTMLButtonElement | null>(null);
  const sessionSummary = useMemo(
    () => computeSessionSummary(state.program),
    [state.program],
  );

  const proTrackRef = useRef<HTMLDivElement | null>(null);
  const fillBarRef = useRef<HTMLDivElement | null>(null);
  const fillEdgeRef = useRef<HTMLDivElement | null>(null);
  const pipProgressBarRef = useRef<HTMLDivElement | null>(null);
  const latestFillRef = useRef<number>(fillProgress);
  const restScrubRef = useRef<RestScrubGesture | null>(null);
  const themeRgbRef = useRef<string>(theme.rgb);
  themeRgbRef.current = theme.rgb;
  const isRestScrubActive =
    !isPipMode &&
    state.phase === 'REST' &&
    state.phaseDurationMs > 0 &&
    !isExitModalOpen &&
    !isRoundMenuOpen;

  const handleOpenExitModal = useCallback(() => {
    const wasRunning = !state.isPaused && state.phase !== 'IDLE' && state.phase !== 'FINISHED';
    wasRunningBeforeExitRef.current = wasRunning;
    if (wasRunning) {
      onPause();
    }
    setIsExitModalOpen(true);
  }, [onPause, state.isPaused, state.phase]);

  const handleCancelExit = useCallback(() => {
    setIsExitModalOpen(false);
    if (wasRunningBeforeExitRef.current) {
      wasRunningBeforeExitRef.current = false;
      onResume();
    }
  }, [onResume]);

  const handleConfirmExit = useCallback(() => {
    wasRunningBeforeExitRef.current = false;
    setIsExitModalOpen(false);
    onConfirmExit();
  }, [onConfirmExit]);

  const handleOpenRoundMenu = useCallback(() => {
    if (isFinished) {
      onRestartSession(true);
      return;
    }
    const wasRunning = !state.isPaused && state.phase !== 'IDLE' && state.phase !== 'FINISHED';
    wasRunningBeforeRoundMenuRef.current = wasRunning;
    if (wasRunning) {
      onPause();
    }
    setIsRoundMenuOpen(true);
  }, [isFinished, onPause, onRestartSession, state.isPaused, state.phase]);

  const handleCancelRoundMenu = useCallback(() => {
    setIsRoundMenuOpen(false);
    if (wasRunningBeforeRoundMenuRef.current) {
      wasRunningBeforeRoundMenuRef.current = false;
      onResume();
    }
  }, [onResume]);

  const handleRestartCurrentRoundAction = useCallback(() => {
    const shouldResume = wasRunningBeforeRoundMenuRef.current;
    wasRunningBeforeRoundMenuRef.current = false;
    setIsRoundMenuOpen(false);
    onRestartCurrentRound?.(shouldResume);
  }, [onRestartCurrentRound]);

  const handleSkipBackwardAction = useCallback(() => {
    const shouldResume = wasRunningBeforeRoundMenuRef.current;
    wasRunningBeforeRoundMenuRef.current = false;
    setIsRoundMenuOpen(false);
    onSkipBackward?.(shouldResume);
  }, [onSkipBackward]);

  const handleSkipForwardAction = useCallback(() => {
    const shouldResume = wasRunningBeforeRoundMenuRef.current;
    wasRunningBeforeRoundMenuRef.current = false;
    setIsRoundMenuOpen(false);
    onSkipForward?.(shouldResume);
  }, [onSkipForward]);

  const handleRestartSessionAction = useCallback(() => {
    const shouldResume = wasRunningBeforeRoundMenuRef.current;
    wasRunningBeforeRoundMenuRef.current = false;
    setIsRoundMenuOpen(false);
    onRestartSession(shouldResume);
  }, [onRestartSession]);

  // Monitor native Android media volume so coaches get a subtle warning if volume is at 0%
  useEffect(() => {
    const checkVolume = () => {
      const pct = getNativeMediaVolumePercent();
      if (pct === null) {
        setIsMediaMuted(false);
        return;
      }
      if (pct === 0) {
        setIsMediaMuted(true);
      } else {
        setIsMediaMuted(false);
        setMuteWarningDismissed(false);
      }
    };

    checkVolume();
    window.addEventListener('focus', checkVolume);
    document.addEventListener('visibilitychange', checkVolume);
    const pollId = isMediaMuted ? window.setInterval(checkVolume, 1500) : null;

    return () => {
      window.removeEventListener('focus', checkVolume);
      document.removeEventListener('visibilitychange', checkVolume);
      if (pollId !== null) {
        window.clearInterval(pollId);
      }
    };
  }, [isMediaMuted]);

  useNativeBackHandler(
    true,
    () => {
      if (isRoundMenuOpen) {
        handleCancelRoundMenu();
      } else if (isExitModalOpen) {
        handleCancelExit();
      } else if (isFinished) {
        onConfirmExit();
      } else {
        handleOpenExitModal();
      }
      return true;
    },
    30,
  );

  const applyFillProgress = useCallback((p: number) => {
    const clamped = Math.min(1, Math.max(0, p));
    latestFillRef.current = clamped;
    const showEdge = clamped > 0 && clamped < 1;
    const rgb = themeRgbRef.current;

    const bar = fillBarRef.current;
    if (bar) {
      bar.style.setProperty('--fill-pct', `${(clamped * 100).toFixed(3)}%`);
      bar.style.setProperty(
        '--fill-shadow-portrait',
        showEdge ? `0 -4px 24px rgba(${rgb}, 0.65)` : 'none',
      );
      bar.style.setProperty(
        '--fill-shadow-landscape',
        showEdge ? `4px 0 24px rgba(${rgb}, 0.65)` : 'none',
      );
    }
    if (fillEdgeRef.current) {
      fillEdgeRef.current.style.opacity = showEdge ? '1' : '0';
    }
    if (pipProgressBarRef.current) {
      pipProgressBarRef.current.style.transform = `scaleX(${clamped.toFixed(4)})`;
    }
  }, []);

  useLayoutEffect(() => {
    if (!subscribeFillProgress) {
      return;
    }
    return subscribeFillProgress(applyFillProgress);
  }, [applyFillProgress, subscribeFillProgress]);

  useLayoutEffect(() => {
    if (subscribeFillProgress) {
      return;
    }
    applyFillProgress(fillProgress);
  }, [applyFillProgress, fillProgress, subscribeFillProgress]);

  useLayoutEffect(() => {
    applyFillProgress(latestFillRef.current);
  }, [applyFillProgress, isPipMode, isProLayout, proPalette.rgb, theme.rgb]);

  useDialogFocusTrap({
    isOpen: isExitModalOpen,
    containerRef: exitDialogRef,
    initialFocusRef: cancelNoBtnRef,
    fallbackFocusRef: backBtnRef,
    onEscape: handleCancelExit,
  });

  useDialogFocusTrap({
    isOpen: isRoundMenuOpen,
    containerRef: roundMenuDialogRef,
    initialFocusRef: restartRoundBtnRef,
    fallbackFocusRef: restartBtnRef,
    onEscape: handleCancelRoundMenu,
  });

  const clearImpactShake = useCallback(() => {
    if (impactShakeTimeoutRef.current !== null) {
      window.clearTimeout(impactShakeTimeoutRef.current);
      impactShakeTimeoutRef.current = null;
    }
    mainRef.current?.classList.remove(...IMPACT_SHAKE_CLASSES);
  }, []);

  const triggerImpactShake = useCallback(
    (event: SoundImpactEvent) => {
      clearImpactShake();

      const el = mainRef.current;
      if (!el) return;

      const { className, durationMs } = IMPACT_SHAKE_CONFIG[event];
      // Force style/layout flush so consecutive sound impacts replay the CSS shake from frame 0.
      void el.offsetWidth;
      el.classList.add(className);

      impactShakeTimeoutRef.current = window.setTimeout(() => {
        clearImpactShake();
      }, durationMs);
    },
    [clearImpactShake],
  );

  useEffect(() => {
    const unsubscribe = soundEngine.subscribeSoundImpact((event) => {
      if (event === 'START_GONG') {
        setGongRippleKey((prev) => prev + 1);
      }
      triggerImpactShake(event);
    });

    return () => {
      unsubscribe();
      clearImpactShake();
    };
  }, [clearImpactShake, triggerImpactShake]);

  useEffect(() => {
    if (state.phase === 'IDLE') {
      setGongRippleKey(0);
      clearImpactShake();
    }
  }, [state.phase, clearImpactShake]);

  const onBeginRestScrubRef = useRef(onBeginRestScrub);
  onBeginRestScrubRef.current = onBeginRestScrub;
  const onScrubRestProgressRef = useRef(onScrubRestProgress);
  onScrubRestProgressRef.current = onScrubRestProgress;
  const onEndRestScrubRef = useRef(onEndRestScrub);
  onEndRestScrubRef.current = onEndRestScrub;

  const finishRestScrubGesture = useCallback((pointerId?: number) => {
    const gesture = restScrubRef.current;
    if (!gesture) {
      return;
    }
    if (pointerId !== undefined && gesture.pointerId !== pointerId) {
      return;
    }
    const wasEngaged = gesture.engaged;
    restScrubRef.current = null;
    if (wasEngaged) {
      triggerRestScrubRelease();
      onEndRestScrubRef.current?.();
    }
  }, []);

  useEffect(() => {
    if (!isRestScrubActive && restScrubRef.current) {
      const wasEngaged = restScrubRef.current.engaged;
      restScrubRef.current = null;
      if (wasEngaged) {
        onEndRestScrubRef.current?.();
      }
    }
  }, [isRestScrubActive]);

  // Global window pointer tracking + non-passive touchmove guard so mobile touch drags
  // never break on implicit child pointer capture (lostpointercapture) or browser overscroll.
  useEffect(() => {
    if (!isRestScrubActive) {
      return;
    }

    const onWindowPointerMove = (e: PointerEvent) => {
      const gesture = restScrubRef.current;
      const scrubFn = onScrubRestProgressRef.current;
      if (!gesture || gesture.pointerId !== e.pointerId || !scrubFn) {
        return;
      }

      const rawAxisDelta = gesture.isLandscape
        ? e.clientX - gesture.startX
        : gesture.startY - e.clientY;

      if (!gesture.engaged) {
        if (Math.abs(rawAxisDelta) < REST_SCRUB_DEADZONE_PX) {
          return;
        }
        gesture.engaged = true;
        onBeginRestScrubRef.current?.();
        triggerRestScrubEngage();
      }

      if (e.cancelable) {
        e.preventDefault();
      }

      const effectiveDelta =
        rawAxisDelta > 0
          ? rawAxisDelta - REST_SCRUB_DEADZONE_PX
          : rawAxisDelta + REST_SCRUB_DEADZONE_PX;
      const nextProgress = Math.min(
        1,
        Math.max(0, gesture.startProgress + effectiveDelta / gesture.trackSpan),
      );

      scrubFn(nextProgress);

      const durationMs = gesture.phaseDurationMs;
      const minRemainingMs = Math.min(durationMs, REST_SCRUB_MIN_REMAINING_MS);
      const nextRemainingMs = Math.min(
        durationMs,
        Math.max(minRemainingMs, Math.round((1 - nextProgress) * durationMs)),
      );
      const nextDisplaySec = Math.ceil(nextRemainingMs / 1000);

      if (nextDisplaySec !== gesture.lastEmittedSec) {
        gesture.lastEmittedSec = nextDisplaySec;
        const isBoundary =
          nextRemainingMs <= minRemainingMs || nextRemainingMs >= durationMs;
        triggerRestScrubStep(nextDisplaySec, isBoundary);
      }
    };

    const onWindowPointerEnd = (e: PointerEvent) => {
      finishRestScrubGesture(e.pointerId);
    };

    const mainEl = mainRef.current;
    const onNativeTouchMove = (e: TouchEvent) => {
      if (restScrubRef.current && e.cancelable) {
        e.preventDefault();
      }
    };

    window.addEventListener('pointermove', onWindowPointerMove, { passive: false });
    window.addEventListener('pointerup', onWindowPointerEnd);
    window.addEventListener('pointercancel', onWindowPointerEnd);
    mainEl?.addEventListener('touchmove', onNativeTouchMove, { passive: false });

    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerEnd);
      window.removeEventListener('pointercancel', onWindowPointerEnd);
      mainEl?.removeEventListener('touchmove', onNativeTouchMove);
    };
  }, [finishRestScrubGesture, isRestScrubActive]);

  const handleMainPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!isRestScrubActive || !onScrubRestProgressRef.current) {
        return;
      }
      if (e.pointerType === 'mouse' && e.button !== 0) {
        return;
      }
      if (restScrubRef.current && restScrubRef.current.pointerId !== e.pointerId) {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          'button, [role="button"], [role="dialog"], a[href], header, footer',
        )
      ) {
        return;
      }

      const trackEl = isProLayout ? proTrackRef.current : mainRef.current;
      const rect = trackEl?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return;
      }

      const isLandscape =
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia('(orientation: landscape)').matches
          : rect.width > rect.height;
      const trackSpan = Math.max(120, isLandscape ? rect.width : rect.height);
      const startProgress = latestFillRef.current;
      const initialRemainingMs = Math.round((1 - startProgress) * state.phaseDurationMs);

      restScrubRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startProgress,
        trackSpan,
        phaseDurationMs: state.phaseDurationMs,
        isLandscape,
        engaged: false,
        lastEmittedSec: Math.ceil(Math.max(REST_SCRUB_MIN_REMAINING_MS, initialRemainingMs) / 1000),
      };
    },
    [isProLayout, isRestScrubActive, state.phaseDurationMs],
  );

  useEffect(() => {
    if (isExitModalOpen || isRoundMenuOpen) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        if (e.repeat) return;
        e.preventDefault();
        if (isFinished) {
          onConfirmExit();
        } else {
          handleOpenExitModal();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleOpenExitModal, isExitModalOpen, isFinished, isRoundMenuOpen, onConfirmExit]);

  if (isPipMode) {
    const pipAccentHex = isProLayout ? proPalette.hex : theme.hex;
    const pipAccentRgb = isProLayout ? proPalette.rgb : theme.rgb;
    const pipLabel = state.isPaused ? 'IN PAUSA' : phaseBannerLabel;

    return (
      <main
        ref={mainRef}
        className="relative flex h-[100dvh] w-screen flex-col items-center justify-between overflow-hidden bg-black px-3 py-2 text-white select-none"
        style={{
          background: `radial-gradient(circle at 50% 58%, rgba(${pipAccentRgb}, 0.28) 0%, rgba(${pipAccentRgb}, 0.08) 54%, #000000 100%)`,
          border: `1.5px solid rgba(${pipAccentRgb}, 0.55)`,
        }}
        data-testid="pip-timer-display"
      >
        <div className="flex w-full items-center justify-between gap-1.5 text-[11px] font-extrabold tracking-[0.12em] uppercase">
          <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-white/95">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor: pipAccentHex,
                boxShadow: `0 0 8px ${pipAccentHex}`,
              }}
              aria-hidden="true"
            />
            <span className="truncate">{pipLabel}</span>
          </span>
          <span
            className="tabular-digits shrink-0 font-bold"
            style={{ color: pipAccentHex }}
          >
            R {state.currentRound}/{state.program.rounds}
          </span>
        </div>

        <div
          className={`font-timer tabular-digits timer-digits-luminescent flex flex-1 items-center justify-center font-extrabold leading-none tracking-[-0.02em] text-white ${
            state.isPaused ? 'animate-paused-blink' : ''
          }`}
          style={{
            fontSize:
              proClock.minutes.length >= 3
                ? 'clamp(1.6rem, min(22vw, 46dvh), 4.5rem)'
                : 'clamp(1.9rem, min(28vw, 52dvh), 5.4rem)',
            ['--digit-stroke' as string]: '2px',
          }}
          role="timer"
          aria-label={`Tempo rimanente ${proClock.minutes} minuti e ${proClock.seconds} secondi`}
        >
          <span>{proClock.minutes}</span>
          <span className="mx-0.5 -translate-y-[0.04em] opacity-95">:</span>
          <span>{proClock.seconds}</span>
        </div>

        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15" aria-hidden="true">
          <div
            ref={pipProgressBarRef}
            className="h-full w-full origin-left will-change-transform"
            style={{
              backgroundColor: pipAccentHex,
              boxShadow: `0 0 10px rgba(${pipAccentRgb}, 0.65)`,
              transform: `scaleX(${Math.min(1, Math.max(0, latestFillRef.current)).toFixed(4)})`,
            }}
          />
        </div>
      </main>
    );
  }

  return (
    <main
      ref={mainRef}
      onPointerDown={handleMainPointerDown}
      style={isRestScrubActive ? { touchAction: 'none' } : undefined}
      className={
        isProLayout
          ? 'font-timer-pro relative flex h-[100dvh] w-screen flex-col items-center justify-between overflow-hidden bg-black text-white'
          : 'relative flex h-[100dvh] w-screen flex-col items-center justify-between overflow-hidden bg-black pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))] landscape:pl-[max(1.25rem,env(safe-area-inset-left,0px))] landscape:pr-[max(1.25rem,env(safe-area-inset-right,0px))] pt-[max(0.375rem,calc(env(safe-area-inset-top,0px)+0.25rem))] pb-[calc(env(safe-area-inset-bottom,0px)+1rem+1dvh)] text-white sm:pt-[max(0.625rem,calc(env(safe-area-inset-top,0px)+0.375rem))] sm:pb-[calc(1.5rem+1dvh)] [@media(orientation:landscape)_and_(max-height:520px)]:pt-[max(0.25rem,calc(env(safe-area-inset-top,0px)+0.25rem))] [@media(orientation:landscape)_and_(max-height:520px)]:pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)]'
      }
    >
      {/* 1. Full-Screen Background Progress Bar / Altimeter with user backgroundOpacity (default 20%) */}
      {isProLayout ? (
        <>
          <div
            ref={proTrackRef}
            className="pointer-events-none absolute inset-x-0 top-0 bottom-[calc(88px+env(safe-area-inset-bottom,0px))] sm:bottom-[calc(104px+env(safe-area-inset-bottom,0px))] landscape:bottom-[calc(68px+env(safe-area-inset-bottom,0px))] [@media(orientation:landscape)_and_(max-height:520px)]:bottom-[calc(58px+env(safe-area-inset-bottom,0px))] z-0 overflow-hidden bg-black"
            aria-hidden="true"
          >
            <div
              ref={fillBarRef}
              className="timer-altimeter-bar"
              style={{
                backgroundColor: `rgba(${proPalette.rgb}, ${bgOpacityAlpha})`,
              }}
            >
              <div ref={fillEdgeRef} className="pointer-events-none absolute inset-0">
                {/* Portrait top horizon line + left/right 22x4px index tabs */}
                <div className="landscape:hidden">
                  <div
                    className="absolute top-0 right-0 left-0 h-[1.5px]"
                    style={{
                      backgroundColor: `rgba(${proPalette.rgb}, 0.85)`,
                      boxShadow: `0 0 14px rgba(${proPalette.rgb}, 0.55)`,
                    }}
                  />
                  <div
                    className="absolute top-[-2px] left-0 h-[4px] w-[22px] rounded-r-full"
                    style={{
                      backgroundColor: proPalette.hex,
                      boxShadow: `0 0 12px ${proPalette.hex}`,
                    }}
                  />
                  <div
                    className="absolute top-[-2px] right-0 h-[4px] w-[22px] rounded-l-full"
                    style={{
                      backgroundColor: proPalette.hex,
                      boxShadow: `0 0 12px ${proPalette.hex}`,
                    }}
                  />
                </div>
                {/* Landscape vertical edge line + top/bottom 4x22px index tabs */}
                <div className="hidden landscape:block">
                  <div
                    className="absolute top-0 right-0 bottom-0 w-[1.5px]"
                    style={{
                      backgroundColor: `rgba(${proPalette.rgb}, 0.85)`,
                      boxShadow: `0 0 14px rgba(${proPalette.rgb}, 0.55)`,
                    }}
                  />
                  <div
                    className="absolute top-0 right-[-2px] h-[22px] w-[4px] rounded-b-full"
                    style={{
                      backgroundColor: proPalette.hex,
                      boxShadow: `0 0 12px ${proPalette.hex}`,
                    }}
                  />
                  <div
                    className="absolute right-[-2px] bottom-0 h-[22px] w-[4px] rounded-t-full"
                    style={{
                      backgroundColor: proPalette.hex,
                      boxShadow: `0 0 12px ${proPalette.hex}`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="timer-pro-ticks-left landscape:hidden" aria-hidden="true" />
          <div className="timer-pro-ticks-right landscape:hidden" aria-hidden="true" />
          <div className="timer-pro-ticks-top hidden landscape:block" aria-hidden="true" />
          <div className="timer-pro-ticks-bottom hidden landscape:block" aria-hidden="true" />
        </>
      ) : (
        <div
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-black"
          aria-hidden="true"
        >
          <ClassicWaveBackground
            rgb={theme.rgb}
            opacity={Number(bgOpacityAlpha)}
            fillProgress={fillProgress}
            isPaused={state.isPaused}
            subscribeFillProgress={subscribeFillProgress}
          />
        </div>
      )}

      {/* 1a. Cinematic Gong Strike Video Backdrop (random Karateka / Judoka / Sumotori) */}
      <GongVideoBackdrop
        isPaused={state.isPaused}
        isFinished={isFinished}
        onActiveChange={setIsGongVideoActive}
      />

      {/* 1b. Hajime Gong Concentric Wave Ripple (Proposta A) */}
      <GongRippleOverlay
        triggerKey={gongRippleKey}
        hex={isProLayout ? proPalette.hex : theme.hex}
        rgb={isProLayout ? proPalette.rgb : theme.rgb}
      />

      {/* 2. Top Bar */}
      {isProLayout ? (
        <header className="relative z-30 flex w-full shrink-0 flex-col pt-[max(0.375rem,calc(env(safe-area-inset-top,0px)+0.25rem))] pl-[max(14px,env(safe-area-inset-left,0px))] pr-[max(14px,env(safe-area-inset-right,0px))] sm:pt-[max(0.625rem,calc(env(safe-area-inset-top,0px)+0.375rem))] sm:pl-[max(20px,env(safe-area-inset-left,0px))] sm:pr-[max(20px,env(safe-area-inset-right,0px))] landscape:pt-[max(0.375rem,calc(env(safe-area-inset-top,0px)+0.25rem))]">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 sm:gap-2">
            <div className="justify-self-start">
              <button
                ref={backBtnRef}
                type="button"
                onClick={handleOpenExitModal}
                aria-label="Torna alle impostazioni"
                title="Torna alle impostazioni (Esc)"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-[rgba(5,5,5,0.72)] text-white transition-colors hover:border-white/50 hover:bg-neutral-900 active:scale-95 sm:h-[44px] sm:w-[44px] landscape:h-10 landscape:w-10 [@media(orientation:landscape)_and_(max-height:520px)]:h-9 [@media(orientation:landscape)_and_(max-height:520px)]:w-9 cursor-pointer"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            </div>

            <div className="justify-self-center">
              {/* Portrait ROUND Pill */}
              <div className="flex h-10 items-center whitespace-nowrap rounded-full border border-white/20 bg-black/38 px-3.5 text-[15px] font-bold leading-none tracking-[0.03em] sm:h-[44px] sm:px-5 sm:text-[19px] landscape:hidden">
                <span>ROUND&nbsp;</span>
                <span
                  className="tabular-digits transition-colors duration-200"
                  style={{ color: proPalette.hex }}
                >
                  {state.currentRound} / {state.program.rounds}
                </span>
              </div>

              {/* Landscape Unified Capsule: Dot + Phase | ROUND X / Y */}
              <div className="hidden h-10 items-center justify-center gap-3 whitespace-nowrap rounded-full border border-white/20 bg-black/45 px-4 text-sm font-bold leading-none sm:text-base landscape:inline-flex [@media(orientation:landscape)_and_(max-height:520px)]:h-9 [@media(orientation:landscape)_and_(max-height:520px)]:px-3.5 [@media(orientation:landscape)_and_(max-height:520px)]:text-xs">
                <span className="inline-flex items-center gap-2.5" aria-live="polite">
                  <span
                    className="h-[10px] w-[10px] shrink-0 rounded-full transition-colors duration-200"
                    style={{
                      backgroundColor: proPalette.hex,
                      boxShadow: `0 0 12px ${proPalette.hex}`,
                    }}
                    aria-hidden="true"
                  />
                  <span className="tracking-[0.18em] text-white uppercase">
                    {phaseBannerLabel}
                  </span>
                </span>
                <span className="h-4 w-px bg-white/20" aria-hidden="true" />
                <span className="inline-flex items-center">
                  <span>ROUND&nbsp;</span>
                  <span
                    className="tabular-digits transition-colors duration-200"
                    style={{ color: proPalette.hex }}
                  >
                    {state.currentRound} / {state.program.rounds}
                  </span>
                </span>
              </div>
            </div>

            <div
              className="tabular-digits pointer-events-none flex h-10 items-center justify-center justify-self-end whitespace-nowrap rounded-full border border-white/20 bg-black/38 px-3 text-[15px] font-bold leading-none sm:h-[44px] sm:px-4 sm:text-[19px] landscape:h-10 landscape:bg-black/45 landscape:px-3.5 landscape:text-sm sm:landscape:text-base [@media(orientation:landscape)_and_(max-height:520px)]:h-9 [@media(orientation:landscape)_and_(max-height:520px)]:px-3 [@media(orientation:landscape)_and_(max-height:520px)]:text-xs"
              aria-label={`Ora attuale ${currentTime}`}
            >
              {currentTime}
            </div>
          </div>

          {/* Portrait Phase Pill Centered Below Top Row */}
          <div className="mt-2.5 flex h-[32px] items-center gap-2.5 self-center whitespace-nowrap rounded-full border border-white/16 bg-black/38 pr-4 pl-3.5 text-[13px] font-bold leading-none tracking-[0.18em] text-white uppercase sm:mt-3 sm:h-[34px] sm:gap-3 sm:pr-5 sm:pl-4 sm:text-[15px] sm:tracking-[0.22em] landscape:hidden">
            <span
              className="h-[11px] w-[11px] shrink-0 rounded-full transition-colors duration-200"
              style={{
                backgroundColor: proPalette.hex,
                boxShadow: `0 0 12px ${proPalette.hex}`,
              }}
              aria-hidden="true"
            />
            <span aria-live="polite">{phaseBannerLabel}</span>
          </div>
        </header>
      ) : (
        <header className="relative z-30 grid w-full max-w-4xl landscape:max-w-none shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="justify-self-start">
            <button
              ref={backBtnRef}
              type="button"
              onClick={handleOpenExitModal}
              aria-label="Torna alle impostazioni"
              title="Torna alle impostazioni (Esc)"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/90 text-white shadow-lg transition-all hover:border-white/50 hover:bg-neutral-900 active:scale-95 sm:h-11 sm:w-11 [@media(orientation:landscape)_and_(max-height:520px)]:h-9 [@media(orientation:landscape)_and_(max-height:520px)]:w-9 cursor-pointer"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          </div>

          <div className="flex items-center justify-center gap-2 justify-self-center sm:gap-3">
            <div className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-white/25 bg-black/90 px-3.5 text-sm font-extrabold leading-none shadow-lg sm:h-11 sm:px-4 sm:text-base [@media(orientation:landscape)_and_(max-height:520px)]:h-9 [@media(orientation:landscape)_and_(max-height:520px)]:px-3 [@media(orientation:landscape)_and_(max-height:520px)]:text-xs">
              <span className="tracking-[0.08em] text-white uppercase">ROUND</span>
              <span
                className="tabular-digits tracking-[0.04em] transition-colors duration-300"
                style={{
                  color: theme.hex,
                  textShadow: `0 0 10px rgba(${theme.rgb}, 0.4)`,
                }}
              >
                {state.currentRound} / {state.program.rounds}
              </span>
            </div>

            <div
              className="hidden h-10 items-center justify-center whitespace-nowrap rounded-full border-2 bg-black/90 px-4 text-sm font-extrabold leading-none shadow-lg landscape:inline-flex sm:h-11 sm:px-5 sm:text-base [@media(orientation:landscape)_and_(max-height:520px)]:h-9 [@media(orientation:landscape)_and_(max-height:520px)]:px-3.5 [@media(orientation:landscape)_and_(max-height:520px)]:text-xs"
              style={{
                borderColor: `rgba(${theme.rgb}, 0.65)`,
                boxShadow: `0 0 18px rgba(${theme.rgb}, 0.25), 0 6px 20px rgba(0, 0, 0, 0.85)`,
              }}
              aria-live="polite"
            >
              <span
                className="tracking-[0.16em] text-white uppercase"
                style={{
                  textShadow: `0 0 12px rgba(${theme.rgb}, 0.45)`,
                }}
              >
                {phaseBannerLabel}
              </span>
            </div>
          </div>

          <div
            className="font-timer tabular-digits pointer-events-none inline-flex h-10 items-center justify-center justify-self-end whitespace-nowrap rounded-full border border-white/25 bg-black/90 px-3 text-sm font-extrabold leading-none tracking-[0.05em] text-white shadow-lg sm:h-11 sm:px-3.5 sm:text-base [@media(orientation:landscape)_and_(max-height:520px)]:h-9 [@media(orientation:landscape)_and_(max-height:520px)]:px-2.5 [@media(orientation:landscape)_and_(max-height:520px)]:text-xs"
            aria-label={`Ora attuale ${currentTime}`}
          >
            {currentTime}
          </div>
        </header>
      )}

      {/* 2b. Subtle Zero-Volume Android Warning Pill */}
      {isMediaMuted && !muteWarningDismissed && !isFinished && (
        <div
          role="status"
          aria-live="polite"
          className="relative z-30 mt-2 inline-flex max-w-[92vw] items-center gap-2 rounded-full border border-amber-400/55 bg-black/88 px-3.5 py-1.5 text-[11px] font-extrabold tracking-[0.06em] text-amber-300 shadow-lg uppercase sm:text-xs"
        >
          <VolumeX className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span className="truncate">Volume media a 0 — alza per sentire il gong</span>
          <button
            type="button"
            onClick={() => setMuteWarningDismissed(true)}
            aria-label="Chiudi avviso volume"
            className="ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-amber-200/80 hover:bg-white/10 hover:text-white cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 3. Modalità 1 (Classic Circle / Landscape) vs Modalità 2 (Versione B Scoreboard Pro) */}
      <div
        className="relative z-10 flex min-h-0 w-full flex-1 flex-col items-center transition-opacity ease-out"
        style={{
          opacity: isGongVideoActive ? 0.1 : 1,
          transitionDuration: isGongVideoActive ? '200ms' : '380ms',
        }}
      >
        {isProLayout ? (
          <UltraModernTimerDisplay state={state} palette={proPalette} digitScale={digitScale} />
        ) : (
          <CircularTimerDisplay
            state={state}
            theme={theme}
            digitScale={digitScale}
            fillProgress={fillProgress}
            subscribeFillProgress={subscribeFillProgress}
          />
        )}
      </div>

      {/* 4. Pause 50% Dimming Veil (preserves active phase color underneath) */}
      {state.isPaused && (
        <div
          className="pointer-events-none absolute inset-0 z-20 bg-black/50 transition-opacity duration-200"
          aria-hidden="true"
        />
      )}

      {/* 5. Prominent Central Play Button while Paused */}
      {state.isPaused && !isExitModalOpen && !isRoundMenuOpen && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <button
            type="button"
            onClick={onTogglePause}
            aria-label="Riprendi timer"
            className="pointer-events-auto flex h-28 w-28 items-center justify-center rounded-full border-2 border-white/85 bg-black/65 text-white shadow-[0_0_44px_rgba(0,0,0,0.9)] backdrop-blur-[2px] transition-transform hover:scale-105 active:scale-95 sm:h-36 sm:w-36 [@media(orientation:landscape)_and_(max-height:520px)]:h-24 [@media(orientation:landscape)_and_(max-height:520px)]:w-24 cursor-pointer"
          >
            <Play className="h-14 w-14 translate-x-1 stroke-[2.2] text-white sm:h-18 sm:w-18 [@media(orientation:landscape)_and_(max-height:520px)]:h-12 [@media(orientation:landscape)_and_(max-height:520px)]:w-12" />
          </button>
        </div>
      )}

      {/* 5b. Finished Session Completion Summary Overlay (SOREMADE / FINE SESSIONE) */}
      {isFinished && !isExitModalOpen && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/62 px-5 py-4 backdrop-blur-[2px]"
          data-testid="session-finished-summary"
        >
          <div
            className="flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border-2 bg-neutral-950/95 p-6 text-center text-white shadow-2xl sm:p-7"
            style={{
              borderColor: `rgba(${isProLayout ? proPalette.rgb : theme.rgb}, 0.65)`,
              boxShadow: `0 0 42px rgba(${isProLayout ? proPalette.rgb : theme.rgb}, 0.25), 0 18px 40px rgba(0, 0, 0, 0.9)`,
            }}
          >
            <div className="flex flex-col items-center gap-1.5">
              <CheckCircle2
                className="h-10 w-10"
                style={{ color: isProLayout ? proPalette.hex : theme.hex }}
              />
              <h2
                className="text-2xl font-extrabold tracking-[0.14em] uppercase sm:text-3xl"
                style={{ color: isProLayout ? proPalette.hex : theme.hex }}
              >
                {phaseBannerLabel}
              </h2>
              <p className="max-w-full truncate text-xs font-bold tracking-[0.1em] text-slate-300 uppercase sm:text-sm">
                {state.program.name}
              </p>
            </div>

            <div className="grid w-full grid-cols-2 gap-2.5">
              <div className="flex flex-col items-center rounded-2xl border border-white/12 bg-black/80 px-3 py-2.5">
                <span className="text-[10px] font-bold tracking-[0.12em] text-slate-400 uppercase">
                  ROUND COMPLETATI
                </span>
                <span className="tabular-digits mt-0.5 text-lg font-extrabold text-white sm:text-xl">
                  {sessionSummary.rounds}
                </span>
              </div>
              <div className="flex flex-col items-center rounded-2xl border border-white/12 bg-black/80 px-3 py-2.5">
                <span className="text-[10px] font-bold tracking-[0.12em] text-slate-400 uppercase">
                  TEMPO TOTALE
                </span>
                <span className="tabular-digits mt-0.5 text-lg font-extrabold text-white sm:text-xl">
                  {formatDurationHuman(sessionSummary.totalSessionSeconds)}
                </span>
              </div>
            </div>

            <div className="mt-1 flex w-full flex-col gap-2.5">
              <button
                type="button"
                onClick={() => onRestartSession(true)}
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full text-sm font-extrabold tracking-[0.14em] text-black uppercase transition-transform hover:brightness-110 active:scale-[0.98] cursor-pointer"
                style={{ backgroundColor: isProLayout ? proPalette.hex : theme.hex }}
              >
                <RefreshCw className="h-4 w-4 stroke-[2.6]" />
                <span>RIPARTI</span>
              </button>

              <button
                type="button"
                onClick={onConfirmExit}
                className="flex min-h-[50px] w-full items-center justify-center rounded-full border-2 border-white/25 bg-black text-sm font-extrabold tracking-[0.14em] text-white uppercase transition-colors hover:border-white/55 hover:bg-white/5 active:scale-[0.98] cursor-pointer"
              >
                TORNA AL SETUP
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Bottom Controls: Vivid Gradient Footer in Modalità 2 vs Minimal Circular Buttons in Modalità 1 */}
      {isProLayout ? (
        <footer
          className="relative z-30 flex h-[calc(88px+env(safe-area-inset-bottom,0px))] w-full shrink-0 items-center justify-between gap-2.5 pt-0 pr-[max(14px,env(safe-area-inset-right,0px))] pb-[env(safe-area-inset-bottom,0px)] pl-[max(14px,env(safe-area-inset-left,0px))] sm:h-[calc(104px+env(safe-area-inset-bottom,0px))] sm:gap-3 sm:pr-[max(19px,env(safe-area-inset-right,0px))] sm:pl-[max(19px,env(safe-area-inset-left,0px))] landscape:h-[calc(68px+env(safe-area-inset-bottom,0px))] [@media(orientation:landscape)_and_(max-height:520px)]:h-[calc(58px+env(safe-area-inset-bottom,0px))]"
          style={{
            background: `linear-gradient(to bottom, ${proPalette.footerTopHex}, ${proPalette.hex} 45%)`,
            borderTop: '2px solid rgba(255, 255, 255, 0.55)',
            boxShadow: `0 -18px 44px rgba(${proPalette.rgb}, 0.3)`,
          }}
        >
          <button
            ref={restartBtnRef}
            type="button"
            onClick={handleOpenRoundMenu}
            aria-label="Controlli round e riavvio"
            title="Riavvia round, salta o riavvia sessione"
            className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-full border-0 text-white shadow-[0_6px_18px_rgba(0,0,0,0.25)] transition-all hover:brightness-125 active:scale-95 sm:h-[66px] sm:w-[66px] landscape:h-[48px] landscape:w-[48px] [@media(orientation:landscape)_and_(max-height:520px)]:h-[44px] [@media(orientation:landscape)_and_(max-height:520px)]:w-[44px] cursor-pointer"
            style={{ backgroundColor: proPalette.footerControlBg }}
          >
            <RefreshCw className="h-[26px] w-[26px] sm:h-[30px] sm:w-[30px] landscape:h-6 landscape:w-6" />
          </button>

          <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1.5">
            <LedSpectrumMeter
              mode={vuMeterMode}
              compact
              accentHex={proPalette.hex}
              accentRgb={proPalette.rgb}
            />
            <RoundSegmentsBar
              currentRound={state.currentRound}
              totalRounds={state.program.rounds}
              phase={state.phase}
              controlBg={proPalette.footerControlBg}
            />
          </div>

          <button
            type="button"
            onClick={() => (isFinished ? onRestartSession(true) : onTogglePause())}
            aria-label={
              isFinished
                ? 'Riavvia sessione'
                : state.isPaused
                  ? 'Riprendi timer'
                  : 'Metti in pausa'
            }
            title={
              isFinished
                ? 'Riavvia sessione (Spazio)'
                : state.isPaused
                  ? 'Riprendi (Spazio)'
                  : 'Pausa (Spazio)'
            }
            className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-full border-0 text-white shadow-[0_6px_18px_rgba(0,0,0,0.25)] transition-all hover:brightness-125 active:scale-95 sm:h-[66px] sm:w-[66px] landscape:h-[48px] landscape:w-[48px] [@media(orientation:landscape)_and_(max-height:520px)]:h-[44px] [@media(orientation:landscape)_and_(max-height:520px)]:w-[44px] cursor-pointer"
            style={{ backgroundColor: proPalette.footerControlBg }}
          >
            {!state.isPaused && !isFinished ? (
              <Pause className="h-[25px] w-[25px] sm:h-[28px] sm:w-[28px] landscape:h-6 landscape:w-6" />
            ) : (
              <Play className="h-[25px] w-[25px] translate-x-0.5 sm:h-[28px] sm:w-[28px] landscape:h-6 landscape:w-6" />
            )}
          </button>
        </footer>
      ) : (
        <div className="relative z-30 flex w-full max-w-xl landscape:max-w-none landscape:px-0 shrink-0 items-center justify-between gap-4 px-3 sm:px-6">
          <button
            ref={restartBtnRef}
            type="button"
            onClick={handleOpenRoundMenu}
            aria-label="Controlli round e riavvio"
            title="Riavvia round, salta o riavvia sessione"
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-white/20 bg-neutral-900/90 text-white shadow-xl transition-all hover:border-white/50 hover:bg-neutral-800 active:scale-95 sm:h-20 sm:w-20 [@media(orientation:landscape)_and_(max-height:520px)]:h-14 [@media(orientation:landscape)_and_(max-height:520px)]:w-14 cursor-pointer"
          >
            <RefreshCw className="h-7 w-7 sm:h-8 sm:w-8 [@media(orientation:landscape)_and_(max-height:520px)]:h-6 [@media(orientation:landscape)_and_(max-height:520px)]:w-6" />
          </button>

          <div className="flex min-w-0 flex-1 items-center justify-center">
            <LedSpectrumMeter mode={vuMeterMode} accentHex={theme.hex} accentRgb={theme.rgb} />
          </div>

          <button
            type="button"
            onClick={() => (isFinished ? onRestartSession(true) : onTogglePause())}
            aria-label={
              isFinished
                ? 'Riavvia sessione'
                : state.isPaused
                  ? 'Riprendi timer'
                  : 'Metti in pausa'
            }
            title={
              isFinished
                ? 'Riavvia sessione (Spazio)'
                : state.isPaused
                  ? 'Riprendi (Spazio)'
                  : 'Pausa (Spazio)'
            }
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-white/20 bg-neutral-900/90 text-white shadow-xl transition-all hover:border-white/50 hover:bg-neutral-800 active:scale-95 sm:h-20 sm:w-20 [@media(orientation:landscape)_and_(max-height:520px)]:h-14 [@media(orientation:landscape)_and_(max-height:520px)]:w-14 cursor-pointer"
          >
            {!state.isPaused && !isFinished ? (
              <Pause className="h-7 w-7 sm:h-8 sm:w-8 [@media(orientation:landscape)_and_(max-height:520px)]:h-6 [@media(orientation:landscape)_and_(max-height:520px)]:w-6" />
            ) : (
              <Play className="h-7 w-7 translate-x-0.5 sm:h-8 sm:w-8 [@media(orientation:landscape)_and_(max-height:520px)]:h-6 [@media(orientation:landscape)_and_(max-height:520px)]:w-6" />
            )}
          </button>
        </div>
      )}

      {/* 7b. Round Control & Restart Sheet (Single Round vs Skip vs Full Session) */}
      {isRoundMenuOpen && (
        <div
          ref={roundMenuDialogRef}
          className="dojo-scroll fixed inset-0 z-50 flex overflow-y-auto bg-black/80 px-5 py-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="round-menu-title"
        >
          <div className="my-auto mx-auto w-full max-w-sm rounded-3xl border border-white/20 bg-neutral-950 p-6 text-white shadow-2xl sm:p-7 [@media(orientation:landscape)_and_(max-height:520px)]:p-5">
            <div className="flex flex-col items-center gap-1 text-center">
              <span className="text-[11px] font-bold tracking-[0.14em] text-slate-400 uppercase">
                ROUND {state.currentRound} / {state.program.rounds}
              </span>
              <h2
                id="round-menu-title"
                className="whitespace-nowrap text-lg font-extrabold tracking-wide text-white sm:text-xl"
              >
                Controllo Round
              </h2>
            </div>

            <div className="mt-5 flex flex-col gap-2.5">
              <button
                ref={restartRoundBtnRef}
                type="button"
                onClick={handleRestartCurrentRoundAction}
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full border-2 bg-black px-4 text-sm font-extrabold tracking-[0.12em] uppercase transition-all hover:bg-white/5 active:scale-[0.98] cursor-pointer"
                style={{
                  borderColor: theme.hex,
                  color: theme.hex,
                  boxShadow: `0 0 18px rgba(${theme.rgb}, 0.2)`,
                }}
              >
                <RotateCcw className="h-4 w-4 shrink-0" />
                <span>RIAVVIA ROUND CORRENTE</span>
              </button>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={handleSkipBackwardAction}
                  className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-full border border-white/25 bg-black px-3 text-xs font-extrabold tracking-[0.1em] text-white uppercase transition-colors hover:border-white/55 hover:bg-white/5 active:scale-[0.98] cursor-pointer"
                >
                  <SkipBack className="h-4 w-4 shrink-0" />
                  <span>PRECEDENTE</span>
                </button>
                <button
                  type="button"
                  onClick={handleSkipForwardAction}
                  className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-full border border-white/25 bg-black px-3 text-xs font-extrabold tracking-[0.1em] text-white uppercase transition-colors hover:border-white/55 hover:bg-white/5 active:scale-[0.98] cursor-pointer"
                >
                  <span>SUCCESSIVO</span>
                  <SkipForward className="h-4 w-4 shrink-0" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleRestartSessionAction}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full border border-white/20 bg-neutral-900 px-4 text-xs font-extrabold tracking-[0.12em] text-slate-200 uppercase transition-colors hover:border-white/45 hover:text-white active:scale-[0.98] cursor-pointer"
              >
                <RefreshCw className="h-4 w-4 shrink-0" />
                <span>RIAVVIA INTERA SESSIONE</span>
              </button>

              <button
                type="button"
                onClick={handleCancelRoundMenu}
                className="mt-1 min-h-[46px] w-full rounded-full border border-white/15 bg-black text-xs font-extrabold tracking-[0.16em] text-slate-400 uppercase transition-colors hover:border-white/40 hover:text-white active:scale-[0.98] cursor-pointer"
              >
                ANNULLA
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. Exit Confirmation Modal */}
      {isExitModalOpen && (
        <div
          ref={exitDialogRef}
          className="dojo-scroll fixed inset-0 z-50 flex overflow-y-auto bg-black/80 px-5 py-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="exit-modal-title"
        >
          <div className="my-auto mx-auto w-full max-w-sm rounded-3xl border border-white/20 bg-neutral-950 p-6 text-white shadow-2xl sm:p-8 [@media(orientation:landscape)_and_(max-height:520px)]:p-5">
            <h2
              id="exit-modal-title"
              className="whitespace-nowrap text-center text-lg font-extrabold tracking-wide text-white sm:text-2xl"
            >
              Confermi l&apos;uscita?
            </h2>

            <div className="mt-6 flex flex-col gap-3">
              <button
                ref={confirmYesBtnRef}
                type="button"
                onClick={handleConfirmExit}
                className="whitespace-nowrap min-h-[54px] w-full rounded-full border-2 bg-black text-base font-extrabold tracking-[0.16em] uppercase transition-all hover:bg-white/5 active:scale-[0.98] cursor-pointer"
                style={{
                  borderColor: theme.hex,
                  color: theme.hex,
                  boxShadow: `0 0 18px rgba(${theme.rgb}, 0.2)`,
                }}
              >
                SÌ
              </button>

              <button
                ref={cancelNoBtnRef}
                type="button"
                onClick={handleCancelExit}
                className="whitespace-nowrap min-h-[54px] w-full rounded-full border-2 border-white/30 bg-black text-base font-extrabold tracking-[0.16em] text-white uppercase transition-all hover:border-white/60 hover:bg-white/5 active:scale-[0.98] cursor-pointer"
              >
                NO
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
