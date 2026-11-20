import type { SolidColorKey, TimerColorMode, TimerPhase } from '../types/timer';
import {
  resolveRestProportionalColor,
  resolveWorkProportionalColor,
  SOLID_COLOR_OPTIONS,
} from './themePalette';

export interface ProTimerPalette {
  isUrgent: boolean;
  hex: string;
  rgb: string;
  footerTopHex: string;
  footerControlBg: string;
  secondsColor: string;
}

function parseRgbTuple(rgb: string): [number, number, number] {
  const parts = rgb
    .split(',')
    .map((part) => Math.max(0, Math.min(255, Math.round(Number(part.trim()) || 0))));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function toHexByte(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0');
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

function buildProPaletteFromRgb(rgb: string, hex: string, isUrgent: boolean): ProTimerPalette {
  const [r, g, b] = parseRgbTuple(rgb);
  const footerTopHex = rgbToHex(
    r + (255 - r) * 0.14,
    g + (255 - g) * 0.14,
    b + (255 - b) * 0.14,
  );
  const footerControlBg = rgbToHex(r * 0.18, g * 0.18, b * 0.18);

  return {
    isUrgent,
    hex,
    rgb,
    footerTopHex,
    footerControlBg,
    secondsColor: isUrgent ? '#ff4d4d' : '#ffffff',
  };
}

/**
 * Resolves the Scoreboard Pro (Modalità 2) palette with proportional
 * Green -> Orange -> Red WORK transitions (and Blue -> Light-Blue REST),
 * or a user-selected SOLID color override, highlighting seconds in urgent
 * #ff4d4d for the final 1..9s of WORK.
 */
export function resolveProTimerPalette(
  phase: TimerPhase,
  totalDisplaySeconds: number,
  fillProgress = 0,
  colorOverride?: { colorMode: TimerColorMode; solidColor: SolidColorKey },
): ProTimerPalette {
  const isUrgent = phase === 'WORK' && totalDisplaySeconds <= 9 && totalDisplaySeconds > 0;

  if (colorOverride?.colorMode === 'SOLID') {
    const solid = SOLID_COLOR_OPTIONS[colorOverride.solidColor] ?? SOLID_COLOR_OPTIONS.GREEN;
    return buildProPaletteFromRgb(solid.rgb, solid.hex, isUrgent);
  }

  if (isUrgent) {
    return {
      isUrgent: true,
      hex: '#ff4d4d',
      rgb: '255, 77, 77',
      footerTopHex: '#ff6e6e',
      footerControlBg: '#380a0a',
      secondsColor: '#ff4d4d',
    };
  }

  if (phase === 'WORK') {
    const { hex, rgb } = resolveWorkProportionalColor(fillProgress);
    return buildProPaletteFromRgb(rgb, hex, false);
  }

  if (phase === 'REST') {
    const { hex, rgb } = resolveRestProportionalColor(fillProgress);
    return buildProPaletteFromRgb(rgb, hex, false);
  }

  if (phase === 'PREP') {
    return buildProPaletteFromRgb('255, 171, 0', '#FFAB00', false);
  }

  return buildProPaletteFromRgb('0, 230, 118', '#00E676', false);
}

/**
 * Computes the black cutout percentage (0..100%) on the horizontal seconds bar
 * representing elapsed seconds inside the current minute.
 */
export function computeSecondsNegativeBarPct(
  totalDisplaySeconds: number,
  phase: TimerPhase,
): number {
  if (phase === 'IDLE') {
    return 0;
  }
  if (phase === 'FINISHED' || totalDisplaySeconds <= 0) {
    return 100;
  }
  const s = Math.max(0, Math.floor(totalDisplaySeconds)) % 60;
  return (((60 - s) % 60) / 60) * 100;
}
