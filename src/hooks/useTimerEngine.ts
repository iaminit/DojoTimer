import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  advanceWithOvershoot,
  applyRestScrubProgress,
  computeFillProgress,
  createIdleState,
  createQuickPresetProgram,
  deriveVisualState,
  getNextPhaseState,
  getPrevPhaseState,
  resolveEdgeCountdownCue,
  type AudioCue,
  type QuickPresetOptions,
  type TimerEngineState,
} from '../engine/timerMachine';
import { soundEngine } from '../services/soundEngine';
import type { DisciplineMode, VisualTimerState, WorkoutProgram } from '../types/timer';
import { shouldCommitTimerFrame } from '../utils/timerFrameCommit';
import { useWakeLock } from './useWakeLock';

export type FillProgressListener = (fillProgress: number) => void;
export type FillProgressSubscriber = (listener: FillProgressListener) => () => void;

export interface UseTimerEngineOptions {
  initialState?: TimerEngineState | null;
  onPersistState?: (snapshot: TimerEngineState) => void;
}

function emitAudioCue(cue: AudioCue | null): void {
  if (!cue) return;
  switch (cue) {
    case 'HAJIME':
      soundEngine.playHajime();
      break;
    case 'MATE':
      soundEngine.playMate();
      break;
    case 'ROUND_TRANSITION':
      soundEngine.playRoundTransition();
      break;
    case 'SOREMADE':
      soundEngine.playSoremade();
      break;
  }
}

export interface UseTimerEngineResult {
  state: TimerEngineState;
  visualState: VisualTimerState;
  fillProgress: number; // 0..1 elapsed fill fraction
  subscribeFillProgress: FillProgressSubscriber;
  wakeLockSupported: boolean;
  wakeLockActive: boolean;
  start: () => void;
  pause: () => void;
  resume: () => void;
  toggleStartPause: () => void;
  reset: () => void;
  skipForward: () => void;
  skipBackward: () => void;
  restartSession: () => void;
  beginRestScrub: () => void;
  scrubRestProgress: (progress: number) => void;
  endRestScrub: () => void;
  selectProgram: (program: WorkoutProgram, autoStart?: boolean) => void;
  triggerQuickPreset: (
    minutes: number,
    discipline?: DisciplineMode,
    options?: QuickPresetOptions,
  ) => void;
}

export function useTimerEngine(
  initialProgram: WorkoutProgram,
  options: UseTimerEngineOptions = {},
): UseTimerEngineResult {
  const seedStateRef = useRef<TimerEngineState | null>(null);
  if (seedStateRef.current === null) {
    seedStateRef.current = options.initialState ?? createIdleState(initialProgram);
  }
  const seedState = seedStateRef.current;

  const [state, setState] = useState<TimerEngineState>(() => seedState);
  const liveStateRef = useRef<TimerEngineState>(seedState);
  const committedStateRef = useRef<TimerEngineState>(seedState);
  const onPersistStateRef = useRef(options.onPersistState);
  onPersistStateRef.current = options.onPersistState;

  const progressListenersRef = useRef<Set<FillProgressListener>>(new Set());

  const initialPhaseEndRef = useRef<number | null>(null);
  if (initialPhaseEndRef.current === null) {
    initialPhaseEndRef.current =
      !seedState.isPaused && seedState.phase !== 'IDLE' && seedState.phase !== 'FINISHED'
        ? performance.now() + seedState.remainingMs
        : 0;
  }
  const phaseEndPerfRef = useRef<number>(initialPhaseEndRef.current);

  const initialWarningKeyRef = useRef<string | null>(null);
  if (initialWarningKeyRef.current === null) {
    initialWarningKeyRef.current =
      seedState.phase === 'WORK' &&
      seedState.program.warningSeconds > 0 &&
      seedState.program.workSeconds > seedState.program.warningSeconds &&
      seedState.remainingMs > 0 &&
      seedState.remainingMs <= seedState.program.warningSeconds * 1000
        ? `WARN-${seedState.currentRound}`
        : '';
  }
  const lastCountdownBeepKeyRef = useRef<string>('');
  const lastWarningKeyRef = useRef<string>(initialWarningKeyRef.current);
  const isScrubbingRestRef = useRef<boolean>(false);

  const isRunning = !state.isPaused && state.phase !== 'IDLE' && state.phase !== 'FINISHED';
  const hasActiveSession = state.phase !== 'IDLE' && state.phase !== 'FINISHED';
  const { isSupported: wakeLockSupported, isLocked: wakeLockActive } = useWakeLock(true);

  const notifyProgress = useCallback((fill: number) => {
    for (const listener of progressListenersRef.current) {
      listener(fill);
    }
  }, []);

  const commitState = useCallback(
    (next: TimerEngineState, persist = false) => {
      liveStateRef.current = next;
      committedStateRef.current = next;
      setState(next);
      notifyProgress(computeFillProgress(next));
      if (persist) {
        onPersistStateRef.current?.(next);
      }
    },
    [notifyProgress],
  );

  const resetEdgeDetectors = useCallback(() => {
    lastCountdownBeepKeyRef.current = '';
    lastWarningKeyRef.current = '';
  }, []);

  const checkEdgeAudio = useCallback((current: TimerEngineState) => {
    if (current.isPaused || current.phase === 'IDLE' || current.phase === 'FINISHED') {
      return;
    }

    // Conteggio vocale 10 -> 1 solo in PREP (nessun bip elettronico in PREP/WORK/REST)
    const countdownCue = resolveEdgeCountdownCue(current);
    if (countdownCue && lastCountdownBeepKeyRef.current !== countdownCue.key) {
      lastCountdownBeepKeyRef.current = countdownCue.key;
      soundEngine.playPrepCountdownSecond(countdownCue.sec);
    }

    // Ring once when entering the round's warning window.
    if (
      current.phase === 'WORK' &&
      current.program.warningSeconds > 0 &&
      current.program.workSeconds > current.program.warningSeconds &&
      current.remainingMs > 0 &&
      current.remainingMs <= current.program.warningSeconds * 1000
    ) {
      const warnKey = `WARN-${current.currentRound}`;
      if (lastWarningKeyRef.current !== warnKey) {
        lastWarningKeyRef.current = warnKey;
        soundEngine.playWarningBell();
      }
    }
  }, []);

  const tick = useCallback(() => {
    if (isScrubbingRestRef.current) {
      return;
    }
    const current = liveStateRef.current;
    if (current.isPaused || current.phase === 'IDLE' || current.phase === 'FINISHED') {
      return;
    }

    const now = performance.now();
    const diff = phaseEndPerfRef.current - now;

    if (diff > 0) {
      const updated: TimerEngineState = {
        ...current,
        remainingMs: diff,
      };
      liveStateRef.current = updated;
      notifyProgress(computeFillProgress(updated));
      checkEdgeAudio(updated);
      if (shouldCommitTimerFrame(committedStateRef.current, updated)) {
        committedStateRef.current = updated;
        setState(updated);
      }
      return;
    }

    const overshoot = -diff;
    const { nextState, audioEvents } = advanceWithOvershoot(current, overshoot);
    if (nextState.phase !== 'FINISHED' && nextState.phase !== 'IDLE') {
      phaseEndPerfRef.current = now + nextState.remainingMs;
    } else {
      phaseEndPerfRef.current = 0;
    }
    commitState(nextState, true);

    // Emit the latest relevant phase audio cue (or final SOREMADE if jumped across multiple phases)
    if (audioEvents.length > 0) {
      emitAudioCue(audioEvents[audioEvents.length - 1]);
    }
    checkEdgeAudio(nextState);
  }, [checkEdgeAudio, commitState, notifyProgress]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    let rafId = 0;
    const rafLoop = () => {
      tick();
      rafId = window.requestAnimationFrame(rafLoop);
    };
    rafId = window.requestAnimationFrame(rafLoop);

    const intervalId = window.setInterval(tick, 200);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isRunning, tick]);

  // Persist live timer snapshot when app goes to background or closes unexpectedly
  useEffect(() => {
    if (!hasActiveSession) {
      return;
    }

    const flushSnapshot = () => {
      const current = liveStateRef.current;
      if (current.phase === 'IDLE' || current.phase === 'FINISHED') {
        return;
      }
      const liveRemainingMs = current.isPaused
        ? current.remainingMs
        : Math.max(1, phaseEndPerfRef.current - performance.now());
      onPersistStateRef.current?.({
        ...current,
        remainingMs: liveRemainingMs,
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushSnapshot();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flushSnapshot);
    window.addEventListener('beforeunload', flushSnapshot);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flushSnapshot);
      window.removeEventListener('beforeunload', flushSnapshot);
    };
  }, [hasActiveSession]);

  const start = useCallback(() => {
    soundEngine.unlock();
    const current = liveStateRef.current;
    const baseState =
      current.phase === 'FINISHED'
        ? createIdleState(current.program, current.activeQuickPresetMinutes)
        : current;

    if (baseState.phase !== 'IDLE') {
      return;
    }

    resetEdgeDetectors();
    const { nextState, audioEvent } = getNextPhaseState(baseState);
    phaseEndPerfRef.current = performance.now() + nextState.remainingMs;
    commitState(nextState, true);
    emitAudioCue(audioEvent);
    checkEdgeAudio(nextState);
  }, [checkEdgeAudio, commitState, resetEdgeDetectors]);

  const pause = useCallback(() => {
    isScrubbingRestRef.current = false;
    const current = liveStateRef.current;
    if (current.isPaused || current.phase === 'IDLE' || current.phase === 'FINISHED') {
      return;
    }
    soundEngine.stopAllVoice();
    const frozenMs = Math.max(1, phaseEndPerfRef.current - performance.now());
    const pausedState: TimerEngineState = {
      ...current,
      remainingMs: frozenMs,
      isPaused: true,
    };
    commitState(pausedState, true);
  }, [commitState]);

  const resume = useCallback(() => {
    isScrubbingRestRef.current = false;
    soundEngine.unlock();
    const current = liveStateRef.current;
    if (!current.isPaused || current.phase === 'IDLE' || current.phase === 'FINISHED') {
      return;
    }
    phaseEndPerfRef.current = performance.now() + current.remainingMs;
    const resumedState: TimerEngineState = {
      ...current,
      isPaused: false,
    };
    commitState(resumedState, true);
    checkEdgeAudio(resumedState);
  }, [checkEdgeAudio, commitState]);

  const toggleStartPause = useCallback(() => {
    const current = liveStateRef.current;
    if (current.phase === 'IDLE' || current.phase === 'FINISHED') {
      start();
    } else if (current.isPaused) {
      resume();
    } else {
      pause();
    }
  }, [pause, resume, start]);

  const reset = useCallback(() => {
    isScrubbingRestRef.current = false;
    soundEngine.unlock();
    soundEngine.stopAllVoice();
    resetEdgeDetectors();
    phaseEndPerfRef.current = 0;
    const current = liveStateRef.current;
    const idle = createIdleState(current.program, current.activeQuickPresetMinutes);
    commitState(idle, true);
  }, [commitState, resetEdgeDetectors]);

  const restartSession = useCallback(() => {
    isScrubbingRestRef.current = false;
    soundEngine.unlock();
    soundEngine.stopAllVoice();
    resetEdgeDetectors();
    const current = liveStateRef.current;
    const idle = createIdleState(current.program, current.activeQuickPresetMinutes);
    const { nextState, audioEvent } = getNextPhaseState(idle);

    if (current.isPaused) {
      phaseEndPerfRef.current = 0;
      const pausedStart: TimerEngineState = {
        ...nextState,
        isPaused: true,
      };
      commitState(pausedStart, true);
      return;
    }

    phaseEndPerfRef.current = performance.now() + nextState.remainingMs;
    commitState(nextState, true);
    emitAudioCue(audioEvent);
    checkEdgeAudio(nextState);
  }, [checkEdgeAudio, commitState, resetEdgeDetectors]);

  const skipForward = useCallback(() => {
    isScrubbingRestRef.current = false;
    soundEngine.unlock();
    soundEngine.stopAllVoice();
    const current = liveStateRef.current;
    if (current.phase === 'FINISHED') {
      return;
    }
    resetEdgeDetectors();
    const { nextState, audioEvent } = getNextPhaseState(current);
    const preservedPause =
      current.isPaused && nextState.phase !== 'FINISHED' && nextState.phase !== 'IDLE';
    const finalState: TimerEngineState = {
      ...nextState,
      isPaused: preservedPause,
    };
    if (!preservedPause && finalState.phase !== 'FINISHED' && finalState.phase !== 'IDLE') {
      phaseEndPerfRef.current = performance.now() + finalState.remainingMs;
    } else {
      phaseEndPerfRef.current = 0;
    }
    commitState(finalState, true);
    if (!preservedPause || finalState.phase === 'FINISHED') {
      emitAudioCue(audioEvent);
    }
  }, [commitState, resetEdgeDetectors]);

  const skipBackward = useCallback(() => {
    isScrubbingRestRef.current = false;
    soundEngine.unlock();
    soundEngine.stopAllVoice();
    const current = liveStateRef.current;
    if (current.phase === 'IDLE') {
      return;
    }
    resetEdgeDetectors();

    const elapsedInPhaseMs = current.phaseDurationMs - current.remainingMs;
    // If more than 3 seconds elapsed in active phase, rewind current phase start
    if (current.phase !== 'FINISHED' && elapsedInPhaseMs > 3000) {
      const restarted: TimerEngineState = {
        ...current,
        remainingMs: current.phaseDurationMs,
      };
      if (!restarted.isPaused) {
        phaseEndPerfRef.current = performance.now() + restarted.remainingMs;
      }
      commitState(restarted, true);
      return;
    }

    const prevState = getPrevPhaseState(current);
    const preservedPause =
      current.isPaused && prevState.phase !== 'IDLE' && prevState.phase !== 'FINISHED';
    const finalState: TimerEngineState = {
      ...prevState,
      isPaused: preservedPause,
    };
    if (!preservedPause && finalState.phase !== 'IDLE' && finalState.phase !== 'FINISHED') {
      phaseEndPerfRef.current = performance.now() + finalState.remainingMs;
    } else {
      phaseEndPerfRef.current = 0;
    }
    commitState(finalState, true);
  }, [commitState, resetEdgeDetectors]);

  const selectProgram = useCallback(
    (program: WorkoutProgram, autoStart = false) => {
      isScrubbingRestRef.current = false;
      soundEngine.unlock();
      resetEdgeDetectors();
      const idle = createIdleState(program, null);
      if (!autoStart) {
        phaseEndPerfRef.current = 0;
        commitState(idle, true);
        return;
      }
      const { nextState, audioEvent } = getNextPhaseState(idle);
      phaseEndPerfRef.current = performance.now() + nextState.remainingMs;
      commitState(nextState, true);
      emitAudioCue(audioEvent);
      checkEdgeAudio(nextState);
    },
    [checkEdgeAudio, commitState, resetEdgeDetectors],
  );

  const triggerQuickPreset = useCallback(
    (
      minutes: number,
      discipline: DisciplineMode = 'JUDO',
      optionsParam: QuickPresetOptions = {},
    ) => {
      isScrubbingRestRef.current = false;
      const safeMinutes = Math.max(1, Math.round(minutes));
      soundEngine.unlock();
      resetEdgeDetectors();
      const quickProgram = createQuickPresetProgram(safeMinutes, discipline, optionsParam);
      const idle = createIdleState(quickProgram, safeMinutes);
      const { nextState, audioEvent } = getNextPhaseState(idle);
      phaseEndPerfRef.current = performance.now() + nextState.remainingMs;
      commitState(nextState, true);
      emitAudioCue(audioEvent);
      checkEdgeAudio(nextState);
    },
    [checkEdgeAudio, commitState, resetEdgeDetectors],
  );

  const beginRestScrub = useCallback(() => {
    const current = liveStateRef.current;
    if (current.phase !== 'REST' || current.phaseDurationMs <= 0) {
      return;
    }
    isScrubbingRestRef.current = true;
    if (!current.isPaused) {
      const frozenMs = Math.min(
        current.phaseDurationMs,
        Math.max(1, phaseEndPerfRef.current - performance.now()),
      );
      liveStateRef.current = {
        ...current,
        remainingMs: frozenMs,
      };
    }
  }, []);

  const scrubRestProgress = useCallback(
    (progress: number) => {
      const current = liveStateRef.current;
      if (current.phase !== 'REST' || current.phaseDurationMs <= 0) {
        return;
      }
      const next = applyRestScrubProgress(current, progress);
      liveStateRef.current = next;
      if (!next.isPaused) {
        phaseEndPerfRef.current = performance.now() + next.remainingMs;
      }
      notifyProgress(computeFillProgress(next));
      if (shouldCommitTimerFrame(committedStateRef.current, next)) {
        committedStateRef.current = next;
        setState(next);
      }
    },
    [notifyProgress],
  );

  const endRestScrub = useCallback(() => {
    if (!isScrubbingRestRef.current) {
      return;
    }
    isScrubbingRestRef.current = false;
    const current = liveStateRef.current;
    if (current.phase !== 'REST') {
      return;
    }
    if (!current.isPaused) {
      phaseEndPerfRef.current = performance.now() + current.remainingMs;
    }
    commitState(current, true);
  }, [commitState]);

  const subscribeFillProgress = useCallback<FillProgressSubscriber>((listener) => {
    progressListenersRef.current.add(listener);
    listener(computeFillProgress(liveStateRef.current));
    return () => {
      progressListenersRef.current.delete(listener);
    };
  }, []);

  const visualState = useMemo(() => deriveVisualState(state), [state]);

  const fillProgress = useMemo(() => computeFillProgress(state), [state]);

  return {
    state,
    visualState,
    fillProgress,
    subscribeFillProgress,
    wakeLockSupported,
    wakeLockActive,
    start,
    pause,
    resume,
    toggleStartPause,
    reset,
    skipForward,
    skipBackward,
    restartSession,
    beginRestScrub,
    scrubRestProgress,
    endRestScrub,
    selectProgram,
    triggerQuickPreset,
  };
}
