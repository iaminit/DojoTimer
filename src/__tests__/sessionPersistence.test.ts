import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdleState, type TimerEngineState } from '../engine/timerMachine';
import {
  ACTIVE_SESSION_SCHEMA_VERSION,
  clearPersistedSession,
  loadPersistedSession,
  MAX_PERSISTED_SESSION_AGE_MS,
  restorePersistedSession,
  savePersistedSession,
} from '../services/sessionPersistence';
import { STORAGE_KEYS } from '../services/storage';
import type { WorkoutProgram } from '../types/timer';

const SAMPLE_PROGRAM: WorkoutProgram = {
  id: 'prog-test-session',
  name: 'Randori Test',
  discipline: 'JUDO',
  rounds: 3,
  workSeconds: 180,
  restSeconds: 60,
  prepSeconds: 10,
  warningSeconds: 30,
  createdAt: 1000,
  updatedAt: 1000,
};

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
}

describe('sessionPersistence active session recovery', () => {
  let memoryStorage: Storage;

  beforeEach(() => {
    memoryStorage = createMemoryStorage();
    vi.stubGlobal('window', { localStorage: memoryStorage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists and restores a paused session without subtracting wall-clock time', () => {
    const t0 = 1_700_000_000_000;
    const pausedState: TimerEngineState = {
      program: SAMPLE_PROGRAM,
      phase: 'WORK',
      currentRound: 2,
      remainingMs: 95_400,
      phaseDurationMs: 180_000,
      isPaused: true,
      activeQuickPresetMinutes: null,
    };

    savePersistedSession('JUDO', pausedState, t0);
    expect(memoryStorage.getItem(STORAGE_KEYS.ACTIVE_SESSION)).not.toBeNull();

    const restored = loadPersistedSession(t0 + 45_000);
    expect(restored).not.toBeNull();
    expect(restored!.discipline).toBe('JUDO');
    expect(restored!.engineState.phase).toBe('WORK');
    expect(restored!.engineState.currentRound).toBe(2);
    expect(restored!.engineState.remainingMs).toBe(95_400);
    expect(restored!.engineState.isPaused).toBe(true);
  });

  it('subtracts exact wall-clock elapsed time when restoring a running session mid-phase', () => {
    const t0 = 1_700_000_000_000;
    const runningState: TimerEngineState = {
      program: SAMPLE_PROGRAM,
      phase: 'WORK',
      currentRound: 1,
      remainingMs: 120_000,
      phaseDurationMs: 180_000,
      isPaused: false,
      activeQuickPresetMinutes: null,
    };

    savePersistedSession('JUDO', runningState, t0);

    const restored = loadPersistedSession(t0 + 18_500);
    expect(restored).not.toBeNull();
    expect(restored!.engineState.phase).toBe('WORK');
    expect(restored!.engineState.currentRound).toBe(1);
    expect(restored!.engineState.remainingMs).toBe(101_500);
    expect(restored!.engineState.isPaused).toBe(false);
  });

  it('advances across phase and round boundaries when restored after phase expiration', () => {
    const t0 = 1_700_000_000_000;
    const runningPrep: TimerEngineState = {
      program: SAMPLE_PROGRAM,
      phase: 'PREP',
      currentRound: 1,
      remainingMs: 4_000,
      phaseDurationMs: 10_000,
      isPaused: false,
      activeQuickPresetMinutes: null,
    };

    savePersistedSession('JUDO', runningPrep, t0);

    // 4s PREP finishes + 180s WORK R1 finishes + 60s REST R1 finishes + 10s into WORK R2 = 254s
    const restored = loadPersistedSession(t0 + 254_000);
    expect(restored).not.toBeNull();
    expect(restored!.engineState.phase).toBe('WORK');
    expect(restored!.engineState.currentRound).toBe(2);
    expect(restored!.engineState.remainingMs).toBe(170_000);
  });

  it('returns null and clears storage when a running session already finished while closed', () => {
    const t0 = 1_700_000_000_000;
    const lastRound: TimerEngineState = {
      program: SAMPLE_PROGRAM,
      phase: 'WORK',
      currentRound: 3,
      remainingMs: 25_000,
      phaseDurationMs: 180_000,
      isPaused: false,
      activeQuickPresetMinutes: null,
    };

    savePersistedSession('JUDO', lastRound, t0);
    expect(loadPersistedSession(t0 + 30_000)).toBeNull();
    expect(memoryStorage.getItem(STORAGE_KEYS.ACTIVE_SESSION)).toBeNull();
  });

  it('discards stale, malformed, or wrong-version snapshots and clears IDLE/FINISHED', () => {
    const t0 = 1_700_000_000_000;
    const stale = restorePersistedSession(
      {
        version: ACTIVE_SESSION_SCHEMA_VERSION,
        discipline: 'JUDO',
        program: SAMPLE_PROGRAM,
        phase: 'WORK',
        currentRound: 1,
        remainingMs: 60_000,
        phaseDurationMs: 180_000,
        isPaused: true,
        activeQuickPresetMinutes: null,
        savedAtEpochMs: t0,
      },
      t0 + MAX_PERSISTED_SESSION_AGE_MS + 1000,
    );
    expect(stale).toBeNull();

    const wrongVersion = restorePersistedSession(
      {
        version: 99,
        discipline: 'JUDO',
        program: SAMPLE_PROGRAM,
        phase: 'WORK',
        currentRound: 1,
        remainingMs: 60_000,
        phaseDurationMs: 180_000,
        isPaused: true,
        activeQuickPresetMinutes: null,
        savedAtEpochMs: t0,
      },
      t0 + 1000,
    );
    expect(wrongVersion).toBeNull();

    memoryStorage.setItem(STORAGE_KEYS.ACTIVE_SESSION, '{broken json');
    expect(loadPersistedSession(t0)).toBeNull();
    expect(memoryStorage.getItem(STORAGE_KEYS.ACTIVE_SESSION)).toBeNull();

    const activeState: TimerEngineState = {
      program: SAMPLE_PROGRAM,
      phase: 'WORK',
      currentRound: 1,
      remainingMs: 60_000,
      phaseDurationMs: 180_000,
      isPaused: false,
      activeQuickPresetMinutes: null,
    };
    savePersistedSession('JUDO', activeState, t0);
    expect(memoryStorage.getItem(STORAGE_KEYS.ACTIVE_SESSION)).not.toBeNull();

    savePersistedSession('JUDO', createIdleState(SAMPLE_PROGRAM), t0 + 10);
    expect(memoryStorage.getItem(STORAGE_KEYS.ACTIVE_SESSION)).toBeNull();

    savePersistedSession('JUDO', activeState, t0 + 20);
    clearPersistedSession();
    expect(memoryStorage.getItem(STORAGE_KEYS.ACTIVE_SESSION)).toBeNull();
  });
});
