import type { WorkoutProgram } from '../types/timer';

export interface ClockDisplay {
  minutes: string;
  seconds: string;
  centiseconds: string;
  totalDisplaySeconds: number;
}

/**
 * Calcola la durata totale della sessione in secondi:
 * prepSeconds + (rounds * workSeconds) + ((rounds - 1) * restSeconds)
 */
export function calculateTotalDurationSeconds(
  program: Pick<WorkoutProgram, 'prepSeconds' | 'rounds' | 'workSeconds' | 'restSeconds'>,
): number {
  const prep = Math.max(0, Math.trunc(program.prepSeconds));
  const rounds = Math.max(1, Math.trunc(program.rounds));
  const work = Math.max(0, Math.trunc(program.workSeconds));
  const rest = Math.max(0, Math.trunc(program.restSeconds));
  return prep + rounds * work + Math.max(0, rounds - 1) * rest;
}

/**
 * Converte millisecondi rimanenti in MM:SS:CC senza ritardo sullo 00:00.
 * Ogni secondo intero corrisponde a un intervallo esatto di 1000ms.
 */
export function getClockDisplay(remainingMs: number): ClockDisplay {
  const safeMs = Math.max(0, remainingMs);
  const totalSec = safeMs <= 0 ? 0 : Math.ceil(safeMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const centis = Math.floor((safeMs % 1000) / 10);

  return {
    minutes: String(mins).padStart(2, '0'),
    seconds: String(secs).padStart(2, '0'),
    centiseconds: String(centis).padStart(2, '0'),
    totalDisplaySeconds: totalSec,
  };
}

/**
 * Formatta un numero di secondi in formato compatto MM:SS (o HH:MM:SS se >= 1h).
 */
export function formatMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Formatta la durata totale in formato leggibile per riepiloghi e card programma.
 */
export function formatDurationHuman(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return `${hours}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  }
  if (mins > 0 && secs > 0) {
    return `${mins}m ${String(secs).padStart(2, '0')}s`;
  }
  if (mins > 0) {
    return `${mins}m 00s`;
  }
  return `${secs}s`;
}
