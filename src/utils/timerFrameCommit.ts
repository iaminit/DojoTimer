import {
  computeFillProgress,
  deriveVisualState,
  type TimerEngineState,
} from '../engine/timerMachine';
import {
  resolveRestProportionalColor,
  resolveWorkProportionalColor,
} from './themePalette';

export function resolveActivePhaseColorHex(
  state: TimerEngineState,
  fillProgress = computeFillProgress(state),
): string {
  const effectiveVisual = state.isPaused
    ? deriveVisualState({ ...state, isPaused: false })
    : deriveVisualState(state);

  if (effectiveVisual === 'WORK' || effectiveVisual === 'WARNING') {
    return resolveWorkProportionalColor(fillProgress).hex;
  }
  if (effectiveVisual === 'REST') {
    return resolveRestProportionalColor(fillProgress).hex;
  }
  return effectiveVisual;
}

/**
 * Determines whether a timer tick needs to commit React state.
 * Sub-second 60fps progress is pushed via direct DOM refs; React only re-renders
 * on discrete transitions, whole-second ticks, warning entry, or active color blends.
 */
export function shouldCommitTimerFrame(
  committed: TimerEngineState,
  candidate: TimerEngineState,
): boolean {
  if (
    committed.phase !== candidate.phase ||
    committed.currentRound !== candidate.currentRound ||
    committed.isPaused !== candidate.isPaused ||
    committed.phaseDurationMs !== candidate.phaseDurationMs ||
    committed.program.id !== candidate.program.id ||
    committed.activeQuickPresetMinutes !== candidate.activeQuickPresetMinutes
  ) {
    return true;
  }

  const prevWholeSec = Math.ceil(Math.max(0, committed.remainingMs) / 1000);
  const nextWholeSec = Math.ceil(Math.max(0, candidate.remainingMs) / 1000);
  if (prevWholeSec !== nextWholeSec) {
    return true;
  }

  if (deriveVisualState(committed) !== deriveVisualState(candidate)) {
    return true;
  }

  if (
    Math.abs(committed.remainingMs - candidate.remainingMs) >= 125 &&
    resolveActivePhaseColorHex(committed) !== resolveActivePhaseColorHex(candidate)
  ) {
    return true;
  }

  return false;
}
