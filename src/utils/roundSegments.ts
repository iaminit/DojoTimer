import type { TimerPhase } from '../types/timer';

export type RoundSegmentStatus = 'completed' | 'active' | 'upcoming';

export const MAX_DISCRETE_ROUND_SEGMENTS = 12;

export interface RoundSegmentsModel {
  mode: 'discrete' | 'continuous';
  segments: RoundSegmentStatus[];
  progressRatio: number;
  completedCount: number;
  totalRounds: number;
}

/**
 * Resolves either discrete per-round progress pills (<= 12 rounds) or a
 * smooth continuous progress bar (> 12 rounds) for the Scoreboard Pro dock.
 */
export function resolveRoundSegments(
  currentRound: number,
  totalRounds: number,
  phase: TimerPhase,
): RoundSegmentsModel {
  const total = Math.max(1, Math.round(totalRounds));
  const current = Math.min(total, Math.max(1, Math.round(currentRound)));

  let completedCount: number;
  let progressRatio: number;
  const segments: RoundSegmentStatus[] = [];

  if (phase === 'FINISHED') {
    completedCount = total;
    progressRatio = 1;
    if (total <= MAX_DISCRETE_ROUND_SEGMENTS) {
      for (let i = 1; i <= total; i += 1) {
        segments.push('completed');
      }
    }
  } else if (phase === 'IDLE') {
    completedCount = 0;
    progressRatio = 0;
    if (total <= MAX_DISCRETE_ROUND_SEGMENTS) {
      for (let i = 1; i <= total; i += 1) {
        segments.push('upcoming');
      }
    }
  } else {
    completedCount = current;
    progressRatio = current / total;
    if (total <= MAX_DISCRETE_ROUND_SEGMENTS) {
      for (let i = 1; i <= total; i += 1) {
        segments.push(i < current ? 'completed' : i === current ? 'active' : 'upcoming');
      }
    }
  }

  return {
    mode: total <= MAX_DISCRETE_ROUND_SEGMENTS ? 'discrete' : 'continuous',
    segments,
    progressRatio,
    completedCount,
    totalRounds: total,
  };
}
