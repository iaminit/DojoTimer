import { describe, expect, it } from 'vitest';
import type { TimerEngineState } from '../engine/timerMachine';
import type { WorkoutProgram } from '../types/timer';
import {
  resolveActivePhaseColorHex,
  shouldCommitTimerFrame,
} from '../utils/timerFrameCommit';

const WORK_PROGRAM: WorkoutProgram = {
  id: 'commit-test-prog',
  name: 'Commit Throttle Test',
  discipline: 'JUDO',
  rounds: 3,
  workSeconds: 300,
  restSeconds: 60,
  prepSeconds: 10,
  warningSeconds: 30,
  createdAt: 1000,
  updatedAt: 1000,
};

function makeState(overrides: Partial<TimerEngineState> = {}): TimerEngineState {
  return {
    program: WORK_PROGRAM,
    phase: 'WORK',
    currentRound: 1,
    remainingMs: 250_500,
    phaseDurationMs: 300_000,
    isPaused: false,
    activeQuickPresetMinutes: null,
    ...overrides,
  };
}

describe('shouldCommitTimerFrame rAF throttling', () => {
  it('skips React commits for intra-second ticks inside steady color regions', () => {
    const committed = makeState({ remainingMs: 250_500 });
    const nextFrame = makeState({ remainingMs: 250_484 });
    expect(shouldCommitTimerFrame(committed, nextFrame)).toBe(false);
  });

  it('commits immediately when displayed whole second changes', () => {
    const committed = makeState({ remainingMs: 250_005 });
    const nextFrame = makeState({ remainingMs: 249_990 });
    expect(shouldCommitTimerFrame(committed, nextFrame)).toBe(true);
  });

  it('commits immediately when entering WARNING from WORK', () => {
    const beforeWarn = makeState({ remainingMs: 30_005 });
    const atWarn = makeState({ remainingMs: 30_000 });
    expect(shouldCommitTimerFrame(beforeWarn, atWarn)).toBe(true);
  });

  it('commits during proportional color crossfade bands when hex shifts after throttle interval, while skipping 60fps per-frame color storms', () => {
    // 300s WORK transitions Verde -> Arancione around fillProgress ~0.333 (remaining ~200s)
    const a = makeState({ remainingMs: 200_900 });
    const frameNext = makeState({ remainingMs: 200_884 });
    const b = makeState({ remainingMs: 200_100 });
    expect(Math.ceil(a.remainingMs / 1000)).toBe(Math.ceil(b.remainingMs / 1000));
    expect(resolveActivePhaseColorHex(a)).not.toBe(resolveActivePhaseColorHex(b));
    expect(shouldCommitTimerFrame(a, frameNext)).toBe(false);
    expect(shouldCommitTimerFrame(a, b)).toBe(true);
  });

  it('commits on phase, round, or pause state transitions', () => {
    const base = makeState({ remainingMs: 250_500 });
    expect(shouldCommitTimerFrame(base, makeState({ isPaused: true }))).toBe(true);
    expect(shouldCommitTimerFrame(base, makeState({ currentRound: 2 }))).toBe(true);
    expect(shouldCommitTimerFrame(base, makeState({ phase: 'REST', remainingMs: 59_500, phaseDurationMs: 60_000 }))).toBe(true);
  });
});
