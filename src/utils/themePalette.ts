import { DISCIPLINES } from '../config/disciplines';
import type {
  DisciplineMode,
  DisplaySettings,
  PaletteColorKey,
  SolidColorKey,
  TimerPhase,
  VisualTimerState,
} from '../types/timer';

export interface SolidColorOption {
  key: SolidColorKey;
  label: string;
  hex: string;
  rgb: string;
}

export const SOLID_COLOR_OPTIONS: Record<SolidColorKey, SolidColorOption> = {
  RED: { key: 'RED', label: 'ROSSO', hex: '#FF3B30', rgb: '255, 59, 48' },
  GREEN: { key: 'GREEN', label: 'VERDE', hex: '#00E676', rgb: '0, 230, 118' },
  ORANGE: { key: 'ORANGE', label: 'ARANCIO', hex: '#FF9100', rgb: '255, 145, 0' },
  AZURE: { key: 'AZURE', label: 'AZZURRO', hex: '#00E5FF', rgb: '0, 229, 255' },
};

export interface PaletteOption {
  key: PaletteColorKey;
  label: string;
  hex: string;
  rgb: string;
  complementaryHex: string;
  complementaryRgb: string;
}

export const PALETTE_OPTIONS: Record<PaletteColorKey, PaletteOption> = {
  YELLOW: {
    key: 'YELLOW',
    label: 'YELLOW',
    hex: '#FFD600',
    rgb: '255, 214, 0',
    complementaryHex: '#00E676',
    complementaryRgb: '0, 230, 118',
  },
  GREEN: {
    key: 'GREEN',
    label: 'GREEN',
    hex: '#00E676',
    rgb: '0, 230, 118',
    complementaryHex: '#00E5FF',
    complementaryRgb: '0, 229, 255',
  },
  RED: {
    key: 'RED',
    label: 'RED',
    hex: '#FF3B30',
    rgb: '255, 59, 48',
    complementaryHex: '#00E5FF',
    complementaryRgb: '0, 229, 255',
  },
  ORANGE: {
    key: 'ORANGE',
    label: 'ORANGE',
    hex: '#FF9100',
    rgb: '255, 145, 0',
    complementaryHex: '#00E5FF',
    complementaryRgb: '0, 229, 255',
  },
};

type RgbTuple = readonly [number, number, number];

const WORK_GREEN: RgbTuple = [0, 230, 118]; // #00E676
const WORK_ORANGE: RgbTuple = [255, 145, 0]; // #FF9100
const WORK_RED: RgbTuple = [255, 59, 48]; // #FF3B30

const REST_BLUE: RgbTuple = [41, 121, 255]; // #2979FF
const REST_LIGHT_BLUE: RgbTuple = [0, 229, 255]; // #00E5FF

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerpRgb(a: RgbTuple, b: RgbTuple, t: number): { hex: string; rgb: string } {
  const clamped = Math.max(0, Math.min(1, t));
  const r = Math.round(a[0] + (b[0] - a[0]) * clamped);
  const g = Math.round(a[1] + (b[1] - a[1]) * clamped);
  const bl = Math.round(a[2] + (b[2] - a[2]) * clamped);
  const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  return {
    hex: `#${toHex(r)}${toHex(g)}${toHex(bl)}`,
    rgb: `${r}, ${g}, ${bl}`,
  };
}

/**
 * Calcola il colore della fase di lavoro dividendo la durata in 3 terzi uguali:
 * - 0% .. 33.3%: Verde (#00E676)
 * - 33.3% .. 66.7%: Arancione (#FF9100)
 * - 66.7% .. 100%: Rosso (#FF3B30)
 */
export function resolveWorkProportionalColor(fillProgress: number): { hex: string; rgb: string } {
  const p = Math.max(0, Math.min(1, fillProgress));
  const b1 = 1 / 3;
  const b2 = 2 / 3;
  const halfWindow = 0.03;

  if (p <= b1 - halfWindow) {
    return lerpRgb(WORK_GREEN, WORK_GREEN, 0);
  }
  if (p < b1 + halfWindow) {
    return lerpRgb(WORK_GREEN, WORK_ORANGE, smoothstep(b1 - halfWindow, b1 + halfWindow, p));
  }
  if (p <= b2 - halfWindow) {
    return lerpRgb(WORK_ORANGE, WORK_ORANGE, 0);
  }
  if (p < b2 + halfWindow) {
    return lerpRgb(WORK_ORANGE, WORK_RED, smoothstep(b2 - halfWindow, b2 + halfWindow, p));
  }
  return lerpRgb(WORK_RED, WORK_RED, 0);
}

/**
 * Calcola il colore della fase di recupero usando esclusivamente Blu e Azzurro
 * in proporzioni uguali (50% Blu -> 50% Azzurro):
 * - 0% .. 50%: Blu (#2979FF)
 * - 50% .. 100%: Azzurro (#00E5FF)
 */
export function resolveRestProportionalColor(fillProgress: number): { hex: string; rgb: string } {
  const p = Math.max(0, Math.min(1, fillProgress));
  const mid = 0.5;
  const halfWindow = 0.05;

  if (p <= mid - halfWindow) {
    return lerpRgb(REST_BLUE, REST_BLUE, 0);
  }
  if (p < mid + halfWindow) {
    return lerpRgb(REST_BLUE, REST_LIGHT_BLUE, smoothstep(mid - halfWindow, mid + halfWindow, p));
  }
  return lerpRgb(REST_LIGHT_BLUE, REST_LIGHT_BLUE, 0);
}

export interface VisualThemeTokens {
  visualState: VisualTimerState;
  label: string;
  subLabel: string;
  hex: string;
  rgb: string;
  glowShadow: string;
  ringGlow: string;
  isWarning: boolean;
  isPaused: boolean;
}

export function resolveVisualTheme(
  visualState: VisualTimerState,
  settings: DisplaySettings,
  discipline: DisciplineMode = 'JUDO',
  fillProgress = 0,
): VisualThemeTokens {
  const labels = DISCIPLINES[discipline].labels;
  const glowRatio = Math.max(0, Math.min(1, settings.contrastLevel / 100));
  const glowAlpha = (0.15 + glowRatio * 0.55).toFixed(2);
  const textAlpha = (0.12 + glowRatio * 0.45).toFixed(2);

  let label = 'PRONTO';
  let subLabel = 'STANDBY';
  let hex = discipline === 'BJJ' ? '#FF9100' : '#FFD600';
  let rgb = discipline === 'BJJ' ? '255, 145, 0' : '255, 214, 0';

  switch (visualState) {
    case 'IDLE':
      label = 'PRONTO';
      subLabel = 'STANDBY';
      hex = discipline === 'BJJ' ? '#FF9100' : '#FFD600';
      rgb = discipline === 'BJJ' ? '255, 145, 0' : '255, 214, 0';
      break;
    case 'PREP':
      label = 'PREPARAZIONE';
      subLabel = 'PREP INTERVAL';
      hex = '#FFAB00';
      rgb = '255, 171, 0';
      break;
    case 'WORK': {
      const workColor = resolveWorkProportionalColor(fillProgress);
      label = labels.work;
      subLabel = 'WORK INTERVAL';
      hex = workColor.hex;
      rgb = workColor.rgb;
      break;
    }
    case 'WARNING': {
      const warnColor = resolveWorkProportionalColor(fillProgress);
      label = labels.work;
      subLabel = 'ULTIMI SECONDI';
      hex = warnColor.hex;
      rgb = warnColor.rgb;
      break;
    }
    case 'REST': {
      const restColor = resolveRestProportionalColor(fillProgress);
      label = labels.rest;
      subLabel = 'REST INTERVAL';
      hex = restColor.hex;
      rgb = restColor.rgb;
      break;
    }
    case 'PAUSED':
      label = 'IN PAUSA';
      subLabel = 'PAUSED';
      hex = '#94A3B8';
      rgb = '148, 163, 184';
      break;
    case 'FINISHED':
      label = labels.finished;
      subLabel = 'SESSION COMPLETE';
      hex = '#00E676';
      rgb = '0, 230, 118';
      break;
  }

  if (settings.colorMode === 'SOLID' && visualState !== 'PAUSED') {
    const solid = SOLID_COLOR_OPTIONS[settings.solidColor] ?? SOLID_COLOR_OPTIONS.GREEN;
    hex = solid.hex;
    rgb = solid.rgb;
  }

  return {
    visualState,
    label,
    subLabel,
    hex,
    rgb,
    glowShadow: `0 0 ${Math.round(18 + glowRatio * 28)}px rgba(${rgb}, ${textAlpha})`,
    ringGlow: `drop-shadow(0 0 ${Math.round(6 + glowRatio * 14)}px rgba(${rgb}, ${glowAlpha}))`,
    isWarning: visualState === 'WARNING',
    isPaused: visualState === 'PAUSED',
  };
}

/**
 * Restituisce la dicitura principale sopra il cerchio del timer:
 * - WORK: RANDORI (Judo) / SPARRING (BJJ)
 * - REST: RECUPERO (entrambi)
 * - PREP / IDLE / FINISHED: etichetta di stato corrispondente
 */
export function resolveTimerPhaseBannerLabel(
  phase: TimerPhase,
  discipline: DisciplineMode,
): string {
  switch (phase) {
    case 'WORK':
      return discipline === 'JUDO' ? 'RANDORI' : 'SPARRING';
    case 'REST':
      return 'RECUPERO';
    case 'PREP':
      return 'PREPARAZIONE';
    case 'FINISHED':
      return DISCIPLINES[discipline].labels.finished;
    case 'IDLE':
      return 'PRONTO';
  }
}
