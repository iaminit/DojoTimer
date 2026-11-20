import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyRestScrubProgress,
  computeFillProgress,
  REST_SCRUB_MIN_REMAINING_MS,
  type TimerEngineState,
} from '../engine/timerMachine';
import {
  triggerRestScrubEngage,
  triggerRestScrubRelease,
  triggerRestScrubStep,
} from '../services/haptics';
import type { WorkoutProgram } from '../types/timer';

const SAMPLE_PROGRAM: WorkoutProgram = {
  id: 'rest-scrub-prog',
  name: 'Sparring BJJ',
  discipline: 'BJJ',
  rounds: 6,
  workSeconds: 240,
  restSeconds: 60,
  prepSeconds: 10,
  warningSeconds: 30,
  createdAt: 1000,
  updatedAt: 1000,
};

function makeState(overrides: Partial<TimerEngineState> = {}): TimerEngineState {
  return {
    program: SAMPLE_PROGRAM,
    phase: 'REST',
    currentRound: 1,
    remainingMs: 30_000,
    phaseDurationMs: 60_000,
    isPaused: false,
    activeQuickPresetMinutes: null,
    ...overrides,
  };
}

describe('applyRestScrubProgress', () => {
  it('scrubs elapsed/remaining time across REST from 0% (full rest) to 100% (safe 00:01 cap)', () => {
    const rest = makeState({ remainingMs: 30_000, phaseDurationMs: 60_000 });

    const atStart = applyRestScrubProgress(rest, 0);
    expect(atStart.remainingMs).toBe(60_000);
    expect(computeFillProgress(atStart)).toBe(0);

    const atQuarter = applyRestScrubProgress(rest, 0.25);
    expect(atQuarter.remainingMs).toBe(45_000);

    const atThreeQuarters = applyRestScrubProgress(rest, 0.75);
    expect(atThreeQuarters.remainingMs).toBe(15_000);

    const atTop = applyRestScrubProgress(rest, 1);
    expect(atTop.remainingMs).toBe(REST_SCRUB_MIN_REMAINING_MS);
    expect(Math.ceil(atTop.remainingMs / 1000)).toBe(1);

    // Out-of-bounds progress values clamp cleanly
    expect(applyRestScrubProgress(rest, -0.4).remainingMs).toBe(60_000);
    expect(applyRestScrubProgress(rest, 1.8).remainingMs).toBe(REST_SCRUB_MIN_REMAINING_MS);
  });

  it('preserves paused state when scrubbing a paused REST phase', () => {
    const pausedRest = makeState({ isPaused: true, remainingMs: 40_000 });
    const scrubbed = applyRestScrubProgress(pausedRest, 0.5);
    expect(scrubbed.remainingMs).toBe(30_000);
    expect(scrubbed.isPaused).toBe(true);
  });

  it('is a strict no-op outside REST (WORK, PREP, IDLE, FINISHED)', () => {
    for (const phase of ['IDLE', 'PREP', 'WORK', 'FINISHED'] as const) {
      const st = makeState({
        phase,
        phaseDurationMs: phase === 'FINISHED' ? 0 : 180_000,
        remainingMs: phase === 'FINISHED' ? 0 : 90_000,
      });
      expect(applyRestScrubProgress(st, 0.8)).toBe(st);
    }
  });
});

describe('REST slider tactile haptic & vibration feedback', () => {
  const originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalWindowDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let vibrateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vibrateMock = vi.fn(() => true);
    Object.defineProperty(globalThis, 'navigator', {
      value: { vibrate: vibrateMock },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {},
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    if (originalNavigatorDesc) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDesc);
    }
    if (originalWindowDesc) {
      Object.defineProperty(globalThis, 'window', originalWindowDesc);
    }
  });

  it('triggers distinct engage, 1-second step, 10-second major/boundary, and release vibrations', () => {
    triggerRestScrubEngage();
    expect(vibrateMock).toHaveBeenLastCalledWith(14);

    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(50);
      triggerRestScrubStep(29, false);
      expect(vibrateMock).toHaveBeenLastCalledWith(7);

      vi.advanceTimersByTime(50);
      triggerRestScrubStep(20, false);
      expect(vibrateMock).toHaveBeenLastCalledWith(12);

      triggerRestScrubStep(1, true);
      expect(vibrateMock).toHaveBeenLastCalledWith(18);
    } finally {
      vi.useRealTimers();
    }

    triggerRestScrubRelease();
    expect(vibrateMock).toHaveBeenLastCalledWith(10);
  });
});
