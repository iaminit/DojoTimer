import type { DisciplineMode, TimerPhase, VisualTimerState, WorkoutProgram } from '../types/timer';

export type AudioCue = 'HAJIME' | 'MATE' | 'ROUND_TRANSITION' | 'SOREMADE';

export interface TimerEngineState {
  program: WorkoutProgram;
  phase: TimerPhase;
  currentRound: number;
  remainingMs: number;
  phaseDurationMs: number;
  isPaused: boolean;
  activeQuickPresetMinutes: number | null;
}

export interface PhaseTransitionResult {
  nextState: TimerEngineState;
  audioEvent: AudioCue | null;
}

export interface OvershootAdvanceResult {
  nextState: TimerEngineState;
  audioEvents: AudioCue[];
}

export function createIdleState(
  program: WorkoutProgram,
  activeQuickPresetMinutes: number | null = null,
): TimerEngineState {
  const initialDisplayMs = Math.max(1000, program.workSeconds * 1000);
  return {
    program,
    phase: 'IDLE',
    currentRound: 1,
    remainingMs: initialDisplayMs,
    phaseDurationMs: initialDisplayMs,
    isPaused: false,
    activeQuickPresetMinutes,
  };
}

export function deriveVisualState(state: TimerEngineState): VisualTimerState {
  if (state.isPaused && state.phase !== 'IDLE' && state.phase !== 'FINISHED') {
    return 'PAUSED';
  }
  switch (state.phase) {
    case 'IDLE':
      return 'IDLE';
    case 'PREP':
      return 'PREP';
    case 'REST':
      return 'REST';
    case 'FINISHED':
      return 'FINISHED';
    case 'WORK': {
      const warningMs = state.program.warningSeconds * 1000;
      if (
        warningMs > 0 &&
        state.phaseDurationMs > warningMs &&
        state.remainingMs > 0 &&
        state.remainingMs <= warningMs
      ) {
        return 'WARNING';
      }
      return 'WORK';
    }
  }
}

export function getNextPhaseState(state: TimerEngineState): PhaseTransitionResult {
  const { program, phase, currentRound } = state;
  const workMs = Math.max(1000, program.workSeconds * 1000);
  const restMs = Math.max(0, program.restSeconds * 1000);
  const prepMs = Math.max(0, program.prepSeconds * 1000);

  switch (phase) {
    case 'IDLE': {
      if (prepMs > 0) {
        return {
          nextState: {
            ...state,
            phase: 'PREP',
            currentRound: 1,
            remainingMs: prepMs,
            phaseDurationMs: prepMs,
            isPaused: false,
          },
          audioEvent: null,
        };
      }
      return {
        nextState: {
          ...state,
          phase: 'WORK',
          currentRound: 1,
          remainingMs: workMs,
          phaseDurationMs: workMs,
          isPaused: false,
        },
        audioEvent: 'HAJIME',
      };
    }

    case 'PREP': {
      return {
        nextState: {
          ...state,
          phase: 'WORK',
          currentRound: 1,
          remainingMs: workMs,
          phaseDurationMs: workMs,
          isPaused: false,
        },
        audioEvent: 'HAJIME',
      };
    }

    case 'WORK': {
      if (currentRound < program.rounds) {
        if (restMs > 0) {
          return {
            nextState: {
              ...state,
              phase: 'REST',
              currentRound,
              remainingMs: restMs,
              phaseDurationMs: restMs,
              isPaused: false,
            },
            audioEvent: 'MATE',
          };
        }
        return {
          nextState: {
            ...state,
            phase: 'WORK',
            currentRound: currentRound + 1,
            remainingMs: workMs,
            phaseDurationMs: workMs,
            isPaused: false,
          },
          audioEvent: 'ROUND_TRANSITION',
        };
      }

      return {
        nextState: {
          ...state,
          phase: 'FINISHED',
          currentRound: program.rounds,
          remainingMs: 0,
          phaseDurationMs: 0,
          isPaused: false,
        },
        audioEvent: 'SOREMADE',
      };
    }

    case 'REST': {
      const nextRound = Math.min(program.rounds, currentRound + 1);
      return {
        nextState: {
          ...state,
          phase: 'WORK',
          currentRound: nextRound,
          remainingMs: workMs,
          phaseDurationMs: workMs,
          isPaused: false,
        },
        audioEvent: 'HAJIME',
      };
    }

    case 'FINISHED': {
      return {
        nextState: state,
        audioEvent: null,
      };
    }
  }
}

export function getPrevPhaseState(state: TimerEngineState): TimerEngineState {
  const { program, phase, currentRound } = state;
  const workMs = Math.max(1000, program.workSeconds * 1000);
  const restMs = Math.max(0, program.restSeconds * 1000);
  const prepMs = Math.max(0, program.prepSeconds * 1000);

  switch (phase) {
    case 'IDLE':
      return state;

    case 'PREP':
      return {
        ...createIdleState(program, state.activeQuickPresetMinutes),
        isPaused: false,
      };

    case 'WORK': {
      if (currentRound > 1) {
        if (restMs > 0) {
          return {
            ...state,
            phase: 'REST',
            currentRound: currentRound - 1,
            remainingMs: restMs,
            phaseDurationMs: restMs,
          };
        }
        return {
          ...state,
          phase: 'WORK',
          currentRound: currentRound - 1,
          remainingMs: workMs,
          phaseDurationMs: workMs,
        };
      }
      if (prepMs > 0) {
        return {
          ...state,
          phase: 'PREP',
          currentRound: 1,
          remainingMs: prepMs,
          phaseDurationMs: prepMs,
        };
      }
      return createIdleState(program, state.activeQuickPresetMinutes);
    }

    case 'REST': {
      return {
        ...state,
        phase: 'WORK',
        currentRound,
        remainingMs: workMs,
        phaseDurationMs: workMs,
      };
    }

    case 'FINISHED': {
      return {
        ...state,
        phase: 'WORK',
        currentRound: program.rounds,
        remainingMs: workMs,
        phaseDurationMs: workMs,
        isPaused: true,
      };
    }
  }
}

/**
 * Avanza alla fase successiva compensando eventuali ritardi (overshoot) dovuti a
 * throttling del browser in background, evitando qualsiasi deriva temporale.
 */
export function advanceWithOvershoot(
  state: TimerEngineState,
  overshootMs: number,
): OvershootAdvanceResult {
  let remainingOvershoot = Math.max(0, overshootMs);
  let cursor = state;
  const audioEvents: AudioCue[] = [];

  for (let guard = 0; guard < 250; guard++) {
    const { nextState, audioEvent } = getNextPhaseState(cursor);
    if (audioEvent) {
      audioEvents.push(audioEvent);
    }
    cursor = nextState;

    if (cursor.phase === 'FINISHED' || cursor.phase === 'IDLE') {
      return { nextState: cursor, audioEvents };
    }

    if (remainingOvershoot < cursor.phaseDurationMs) {
      return {
        nextState: {
          ...cursor,
          remainingMs: Math.max(1, cursor.phaseDurationMs - remainingOvershoot),
        },
        audioEvents,
      };
    }

    remainingOvershoot -= cursor.phaseDurationMs;
  }

  return { nextState: cursor, audioEvents };
}

export const REST_SCRUB_MIN_REMAINING_MS = 1000;

/**
 * Aggiorna il tempo rimanente durante la sola fase REST in base al progresso trascinato (0..1):
 * - progress = 0 -> inizio recupero (remainingMs = phaseDurationMs)
 * - progress = 1 -> limite sicuro 00:01 (remainingMs = min(phaseDurationMs, 1000ms))
 * Non modifica mai altre fasi (IDLE, PREP, WORK, FINISHED).
 */
export function applyRestScrubProgress(
  state: TimerEngineState,
  progress: number,
): TimerEngineState {
  if (state.phase !== 'REST' || state.phaseDurationMs <= 0) {
    return state;
  }
  const clampedProgress = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const minRemainingMs = Math.min(state.phaseDurationMs, REST_SCRUB_MIN_REMAINING_MS);
  const rawRemainingMs = Math.round((1 - clampedProgress) * state.phaseDurationMs);
  const nextRemainingMs = Math.min(state.phaseDurationMs, Math.max(minRemainingMs, rawRemainingMs));

  if (nextRemainingMs === state.remainingMs) {
    return state;
  }
  return {
    ...state,
    remainingMs: nextRemainingMs,
  };
}

/**
 * Calcola la frazione di riempimento (0 -> 1) della fase corrente:
 * 0 in IDLE (pronto a riempirsi), crescente 0->1 durante PREP/WORK/REST, 1 in FINISHED.
 */
export function computeFillProgress(state: TimerEngineState): number {
  if (state.phase === 'IDLE') {
    return 0;
  }
  if (state.phase === 'FINISHED') {
    return 1;
  }
  if (state.phaseDurationMs <= 0) {
    return 0;
  }
  return Math.min(
    1,
    Math.max(0, (state.phaseDurationMs - state.remainingMs) / state.phaseDurationMs),
  );
}

export interface QuickPresetOptions {
  prepSeconds?: number;
  warningSeconds?: number;
}

export function createQuickPresetProgram(
  minutes: number,
  discipline: DisciplineMode = 'JUDO',
  options: QuickPresetOptions = {},
): WorkoutProgram {
  const safeMinutes = Math.max(1, Math.round(minutes));
  const prepSeconds =
    typeof options.prepSeconds === 'number' && Number.isFinite(options.prepSeconds)
      ? Math.min(300, Math.max(0, Math.round(options.prepSeconds)))
      : 10;
  const warningSeconds =
    typeof options.warningSeconds === 'number' && Number.isFinite(options.warningSeconds)
      ? Math.min(120, Math.max(0, Math.round(options.warningSeconds)))
      : 30;
  const now = Date.now();
  return {
    id: `quick-preset-${safeMinutes}min`,
    name: `Incontro Rapido ${safeMinutes} MIN`,
    discipline,
    rounds: 1,
    workSeconds: safeMinutes * 60,
    restSeconds: 0,
    prepSeconds,
    warningSeconds,
    createdAt: now,
    updatedAt: now,
  };
}

export interface EdgeCountdownCue {
  key: string;
  kind: 'PREP_VOICE_COUNT';
  sec: number;
}

/**
 * Determina il segnale second-by-second attivo nella fase corrente:
 * - Solo PREP: conteggio vocale 10 -> 1 (`PREP_VOICE_COUNT`), nessun suono in WORK e REST.
 */
export function resolveEdgeCountdownCue(state: TimerEngineState): EdgeCountdownCue | null {
  if (
    state.isPaused ||
    state.phase === 'IDLE' ||
    state.phase === 'FINISHED' ||
    state.remainingMs <= 0
  ) {
    return null;
  }

  const displaySec = Math.ceil(state.remainingMs / 1000);
  if (state.phase === 'PREP' && displaySec >= 1 && displaySec <= 10) {
    return {
      key: `PREP-${state.currentRound}-${displaySec}`,
      kind: 'PREP_VOICE_COUNT',
      sec: displaySec,
    };
  }

  return null;
}
