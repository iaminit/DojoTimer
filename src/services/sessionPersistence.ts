import { advanceWithOvershoot, type TimerEngineState } from '../engine/timerMachine';
import type { DisciplineMode, WorkoutProgram } from '../types/timer';
import { sanitizeWorkoutProgram, STORAGE_KEYS } from './storage';

export const ACTIVE_SESSION_SCHEMA_VERSION = 1;
export const MAX_PERSISTED_SESSION_AGE_MS = 2 * 60 * 60 * 1000;

export type PersistableTimerPhase = 'PREP' | 'WORK' | 'REST';

export interface PersistedTimerSession {
  version: number;
  discipline: DisciplineMode;
  program: WorkoutProgram;
  phase: PersistableTimerPhase;
  currentRound: number;
  remainingMs: number;
  phaseDurationMs: number;
  isPaused: boolean;
  activeQuickPresetMinutes: number | null;
  savedAtEpochMs: number;
}

export interface RestoredTimerSession {
  discipline: DisciplineMode;
  engineState: TimerEngineState;
}

function getLocalStorageSafe(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

function resolveCanonicalPhaseDurationMs(
  program: WorkoutProgram,
  phase: PersistableTimerPhase,
): number {
  switch (phase) {
    case 'PREP':
      return Math.max(0, program.prepSeconds * 1000);
    case 'WORK':
      return Math.max(1000, program.workSeconds * 1000);
    case 'REST':
      return Math.max(0, program.restSeconds * 1000);
  }
}

function isPersistablePhase(value: unknown): value is PersistableTimerPhase {
  return value === 'PREP' || value === 'WORK' || value === 'REST';
}

export function restorePersistedSession(
  raw: unknown,
  nowEpochMs = Date.now(),
): RestoredTimerSession | null {
  if (!raw || typeof raw !== 'object' || !Number.isFinite(nowEpochMs)) {
    return null;
  }

  const obj = raw as Record<string, unknown>;
  if (obj.version !== ACTIVE_SESSION_SCHEMA_VERSION) {
    return null;
  }

  const discipline: DisciplineMode | null =
    obj.discipline === 'JUDO' || obj.discipline === 'BJJ' ? obj.discipline : null;
  if (!discipline) {
    return null;
  }

  if (!isPersistablePhase(obj.phase)) {
    return null;
  }

  if (typeof obj.isPaused !== 'boolean') {
    return null;
  }

  if (
    typeof obj.savedAtEpochMs !== 'number' ||
    !Number.isFinite(obj.savedAtEpochMs) ||
    typeof obj.remainingMs !== 'number' ||
    !Number.isFinite(obj.remainingMs) ||
    typeof obj.currentRound !== 'number' ||
    !Number.isFinite(obj.currentRound)
  ) {
    return null;
  }

  const sanitizedProgram = sanitizeWorkoutProgram(obj.program);
  if (!sanitizedProgram) {
    return null;
  }

  const deltaMs = nowEpochMs - obj.savedAtEpochMs;
  if (deltaMs > MAX_PERSISTED_SESSION_AGE_MS || deltaMs < -MAX_PERSISTED_SESSION_AGE_MS) {
    return null;
  }
  const elapsedMs = Math.max(0, deltaMs);

  const canonicalPhaseDurationMs = resolveCanonicalPhaseDurationMs(sanitizedProgram, obj.phase);
  if (canonicalPhaseDurationMs <= 0) {
    return null;
  }

  const currentRound = Math.min(sanitizedProgram.rounds, Math.max(1, Math.round(obj.currentRound)));
  const remainingMs = Math.min(canonicalPhaseDurationMs, Math.max(1, obj.remainingMs));
  const activeQuickPresetMinutes =
    typeof obj.activeQuickPresetMinutes === 'number' &&
    Number.isFinite(obj.activeQuickPresetMinutes) &&
    obj.activeQuickPresetMinutes > 0
      ? Math.round(obj.activeQuickPresetMinutes)
      : null;

  const baseState: TimerEngineState = {
    program: sanitizedProgram,
    phase: obj.phase,
    currentRound,
    remainingMs,
    phaseDurationMs: canonicalPhaseDurationMs,
    isPaused: obj.isPaused,
    activeQuickPresetMinutes,
  };

  if (obj.isPaused) {
    return {
      discipline,
      engineState: baseState,
    };
  }

  if (elapsedMs < remainingMs) {
    return {
      discipline,
      engineState: {
        ...baseState,
        remainingMs: Math.max(1, remainingMs - elapsedMs),
      },
    };
  }

  const overshootMs = elapsedMs - remainingMs;
  const { nextState } = advanceWithOvershoot(baseState, overshootMs);
  if (nextState.phase === 'FINISHED' || nextState.phase === 'IDLE') {
    return null;
  }

  return {
    discipline,
    engineState: nextState,
  };
}

export function clearPersistedSession(): void {
  const storage = getLocalStorageSafe();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEYS.ACTIVE_SESSION);
  } catch {
    // Ignore storage removal errors
  }
}

export function savePersistedSession(
  discipline: DisciplineMode,
  state: TimerEngineState,
  nowEpochMs = Date.now(),
): void {
  if (!isPersistablePhase(state.phase)) {
    clearPersistedSession();
    return;
  }
  const storage = getLocalStorageSafe();
  if (!storage) return;

  const payload: PersistedTimerSession = {
    version: ACTIVE_SESSION_SCHEMA_VERSION,
    discipline,
    program: state.program,
    phase: state.phase,
    currentRound: state.currentRound,
    remainingMs: Math.max(1, state.remainingMs),
    phaseDurationMs: state.phaseDurationMs,
    isPaused: state.isPaused,
    activeQuickPresetMinutes: state.activeQuickPresetMinutes,
    savedAtEpochMs: nowEpochMs,
  };

  try {
    storage.setItem(STORAGE_KEYS.ACTIVE_SESSION, JSON.stringify(payload));
  } catch {
    // Ignore storage quota or private mode errors
  }
}

export function loadPersistedSession(nowEpochMs = Date.now()): RestoredTimerSession | null {
  const storage = getLocalStorageSafe();
  if (!storage) return null;

  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEYS.ACTIVE_SESSION);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearPersistedSession();
    return null;
  }

  const restored = restorePersistedSession(parsed, nowEpochMs);
  if (!restored) {
    clearPersistedSession();
    return null;
  }

  return restored;
}
