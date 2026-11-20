export const WATER_MIN_OPACITY = 0.15;
export const WATER_MAX_OPACITY = 0.94;
export const WATER_CIRCLE_CENTER = 160;
export const WATER_INNER_RADIUS = 150;

export const WAVE_PERIOD_UNITS = 320;
export const WAVE_BASE_AMP = 9;
export const WAVE_BACK_AMP = Number((WAVE_BASE_AMP * 0.72).toFixed(2));
export const WAVE_BACK_OFFSET = 2.4;
export const WAVE_CREST_STROKE = 3.2;
export const WAVE_BACK_STROKE = 1.8;
export const CLASSIC_CIRCLE_DIAMETER_CSS = 'min(93vw, 62dvh, 660px)';
export const CIRCLE_WAVE_ZOOM = 1.5;

const WATER_TOP_Y = WATER_CIRCLE_CENTER - WATER_INNER_RADIUS; // 10
const WATER_BOTTOM_Y = WATER_CIRCLE_CENTER + WATER_INNER_RADIUS; // 310
const WATER_SPAN = WATER_BOTTOM_Y - WATER_TOP_Y; // 300

export interface WaterFillMetrics {
  clampedFill: number;
  isVisible: boolean;
  baseOpacity: number;
  backWaveOpacity: number;
  crestOpacity: number;
  waterSurfaceY: number;
  waveAmplitude: number;
}

/**
 * Calcola livello e saturazione progressiva del liquido nel cerchio:
 * parte al 15% di opacità (0.15) e sale fino a saturare completamente il cerchio (0.94).
 */
export function computeWaterFillMetrics(fillProgress: number): WaterFillMetrics {
  const p = Number.isFinite(fillProgress) ? Math.min(1, Math.max(0, fillProgress)) : 0;

  if (p <= 0.0005) {
    return {
      clampedFill: 0,
      isVisible: false,
      baseOpacity: 0,
      backWaveOpacity: 0,
      crestOpacity: 0,
      waterSurfaceY: WATER_BOTTOM_Y,
      waveAmplitude: 0,
    };
  }

  const baseOpacity = Number(
    (WATER_MIN_OPACITY + (WATER_MAX_OPACITY - WATER_MIN_OPACITY) * p).toFixed(4),
  );
  const backWaveOpacity = Number(Math.min(0.96, baseOpacity * 0.72).toFixed(4));
  const crestOpacity = Number(Math.min(0.85, 0.35 + p * 0.45).toFixed(4));
  const waterSurfaceY = Number((WATER_BOTTOM_Y - p * WATER_SPAN).toFixed(2));
  const edgeTaper = p >= 0.996 ? 0 : Math.min(1, p * 12, (1 - p) * 14);
  const waveAmplitude = Number((6.5 * edgeTaper).toFixed(2));

  return {
    clampedFill: p,
    isVisible: true,
    baseOpacity,
    backWaveOpacity,
    crestOpacity,
    waterSurfaceY,
    waveAmplitude,
  };
}

function buildWaveCurve(
  surfaceY: number,
  amplitude: number,
  startX: number,
  periods = 2,
): string {
  const ctrlY = Number((surfaceY - amplitude * 2).toFixed(2));
  const halfStep = WAVE_PERIOD_UNITS / 2;
  const segments = [
    `M ${startX} ${surfaceY}`,
    `Q ${startX + halfStep / 2} ${ctrlY} ${startX + halfStep} ${surfaceY}`,
  ];
  for (let half = 2; half <= periods * 2; half += 1) {
    segments.push(`T ${startX + half * halfStep} ${surfaceY}`);
  }
  return segments.join(' ');
}

/**
 * Costruisce una path SVG periodica su `periods` lunghezze d'onda (default 2 = larghezza 640 in viewBox 320x320)
 * per uno scorrimento orizzontale infinito senza discontinuità.
 */
export function buildPeriodicWavePath(
  surfaceY: number,
  amplitude: number,
  startX: number,
  bottomY = 330,
  periods = 2,
): string {
  const span = periods * WAVE_PERIOD_UNITS;
  return `${buildWaveCurve(surfaceY, amplitude, startX, periods)} L ${startX + span} ${bottomY} L ${startX} ${bottomY} Z`;
}

/** Traccia della sola cresta luminosa superficiale lungo la curva d'onda. */
export function buildPeriodicCrestPath(
  surfaceY: number,
  amplitude: number,
  startX: number,
  periods = 2,
): string {
  return buildWaveCurve(surfaceY, amplitude, startX, periods);
}

function buildVerticalWaveCurve(
  surfaceX: number,
  amplitude: number,
  startY: number,
  periods = 2,
): string {
  const ctrlX = Number((surfaceX + amplitude * 2).toFixed(2));
  const halfStep = WAVE_PERIOD_UNITS / 2;
  const segments = [
    `M ${surfaceX} ${startY}`,
    `Q ${ctrlX} ${startY + halfStep / 2} ${surfaceX} ${startY + halfStep}`,
  ];
  for (let half = 2; half <= periods * 2; half += 1) {
    segments.push(`T ${surfaceX} ${startY + half * halfStep}`);
  }
  return segments.join(' ');
}

/**
 * Costruisce una path SVG periodica verticale su `periods` lunghezze d'onda
 * per il riempimento laterale sinistro -> destro in landscape.
 */
export function buildVerticalPeriodicWavePath(
  surfaceX: number,
  amplitude: number,
  startY: number,
  trailingX = -2,
  periods = 2,
): string {
  const span = periods * WAVE_PERIOD_UNITS;
  return `${buildVerticalWaveCurve(surfaceX, amplitude, startY, periods)} L ${trailingX} ${startY + span} L ${trailingX} ${startY} Z`;
}

/** Traccia verticale della sola cresta luminosa superficiale per il riempimento landscape. */
export function buildVerticalPeriodicCrestPath(
  surfaceX: number,
  amplitude: number,
  startY: number,
  periods = 2,
): string {
  return buildVerticalWaveCurve(surfaceX, amplitude, startY, periods);
}
