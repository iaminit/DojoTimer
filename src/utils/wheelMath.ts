export type WheelKind = 'WORK' | 'REST';

export const HOTSPOT_MINUTES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const HOTSPOT_SECONDS: readonly number[] = HOTSPOT_MINUTES.map((m) => m * 60);
export const REST_HOTSPOT_SECONDS: readonly number[] = [
  15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180,
] as const;

export const WHEEL_MIN_SECONDS = 15;
export const WHEEL_MAX_SECONDS = 720;
export const WHEEL_MIN_ANGLE_DEG = 7.5;
export const WHEEL_MAX_ANGLE_DEG = 360;

export interface WheelHotspotItem {
  value: number;
  label: string;
  angleDeg: number;
}

export interface WheelScaleConfig {
  kind: WheelKind;
  minSeconds: number;
  maxSeconds: number;
  stepSeconds: number;
  defaultSeconds: number;
  minAngleDeg: number;
  maxAngleDeg: number;
  totalTicks: number;
  majorTickEvery: number;
  magneticSnapSeconds: number;
  topSnapLowDeg: number;
  topSnapHighDeg: number;
  hotspotSeconds: readonly number[];
  hotspots: readonly WheelHotspotItem[];
}

const WORK_CONFIG: WheelScaleConfig = {
  kind: 'WORK',
  minSeconds: WHEEL_MIN_SECONDS,
  maxSeconds: WHEEL_MAX_SECONDS,
  stepSeconds: 15,
  defaultSeconds: 180,
  minAngleDeg: WHEEL_MIN_ANGLE_DEG,
  maxAngleDeg: WHEEL_MAX_ANGLE_DEG,
  totalTicks: 48,
  majorTickEvery: 4,
  magneticSnapSeconds: 9,
  topSnapLowDeg: 4,
  topSnapHighDeg: 351,
  hotspotSeconds: HOTSPOT_SECONDS,
  hotspots: HOTSPOT_MINUTES.map((m) => ({
    value: m * 60,
    label: String(m),
    angleDeg: (m / 12) * 360,
  })),
};

const REST_CONFIG: WheelScaleConfig = {
  kind: 'REST',
  minSeconds: 5,
  maxSeconds: 180,
  stepSeconds: 5,
  defaultSeconds: 60,
  minAngleDeg: 10,
  maxAngleDeg: 360,
  totalTicks: 36,
  majorTickEvery: 3,
  magneticSnapSeconds: 3,
  topSnapLowDeg: 5,
  topSnapHighDeg: 352,
  hotspotSeconds: REST_HOTSPOT_SECONDS,
  hotspots: REST_HOTSPOT_SECONDS.map((s) => ({
    value: s,
    label: String(s),
    angleDeg: (s / 180) * 360,
  })),
};

const WORK_HOTSPOT_SET: ReadonlySet<number> = new Set(HOTSPOT_SECONDS);
const REST_HOTSPOT_SET: ReadonlySet<number> = new Set(REST_HOTSPOT_SECONDS);

export function getWheelConfig(kind: WheelKind = 'WORK'): WheelScaleConfig {
  return kind === 'REST' ? REST_CONFIG : WORK_CONFIG;
}

export function normalizeWheelInitialSeconds(
  seconds: number,
  kind: WheelKind = 'WORK',
): number {
  const cfg = getWheelConfig(kind);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return cfg.defaultSeconds;
  }
  const snapped = Math.round(seconds / cfg.stepSeconds) * cfg.stepSeconds;
  return Math.min(cfg.maxSeconds, Math.max(cfg.minSeconds, snapped));
}

export function isHotspotDuration(seconds: number, kind: WheelKind = 'WORK'): boolean {
  return kind === 'REST' ? REST_HOTSPOT_SET.has(seconds) : WORK_HOTSPOT_SET.has(seconds);
}

/**
 * Converte coordinate puntatore relative al centro della ghiera in angolo orario [0..360]
 * partendo dalle ore 12 (alto). Il polo esatto a ore 12 restituisce 360°.
 */
export function pointerToClockwiseAngleDeg(
  clientX: number,
  clientY: number,
  centerX: number,
  centerY: number,
): number {
  const dx = clientX - centerX;
  const dy = clientY - centerY;
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  if (deg <= 0) {
    deg += 360;
  }
  return deg;
}

export function wheelSecondsToAngleDeg(
  seconds: number,
  kind: WheelKind = 'WORK',
): number {
  const cfg = getWheelConfig(kind);
  const clamped = Math.min(cfg.maxSeconds, Math.max(cfg.minSeconds, seconds));
  return (clamped / cfg.maxSeconds) * 360;
}

/**
 * Converte un angolo in secondi secondo la scala della ghiera ('WORK' o 'REST'),
 * con aggancio magnetico ai punti caldi.
 */
export function angleDegToWheelSeconds(
  angleDeg: number,
  enableMagneticSnap = true,
  kind: WheelKind = 'WORK',
): number {
  const cfg = getWheelConfig(kind);
  const clamped = Math.min(cfg.maxAngleDeg, Math.max(cfg.minAngleDeg, angleDeg));
  const rawSeconds = (clamped / 360) * cfg.maxSeconds;

  if (enableMagneticSnap) {
    let closestHotspot = -1;
    let closestDist = Infinity;
    for (const h of cfg.hotspotSeconds) {
      const dist = Math.abs(rawSeconds - h);
      if (dist < closestDist) {
        closestDist = dist;
        closestHotspot = h;
      }
    }
    if (closestHotspot > 0 && closestDist <= cfg.magneticSnapSeconds) {
      return closestHotspot;
    }
  }

  return Math.min(
    cfg.maxSeconds,
    Math.max(cfg.minSeconds, Math.round(rawSeconds / cfg.stepSeconds) * cfg.stepSeconds),
  );
}

/**
 * Gestisce il tocco iniziale sul cerchio: vicino alle ore 12 interpreta
 * la posizione come fine scala anziché il minimo iniziale.
 */
export function tapAngleDegToWheelSeconds(
  rawClockwiseDeg: number,
  kind: WheelKind = 'WORK',
): number {
  const cfg = getWheelConfig(kind);
  if (rawClockwiseDeg >= cfg.topSnapHighDeg || rawClockwiseDeg < cfg.topSnapLowDeg) {
    return cfg.maxSeconds;
  }
  return angleDegToWheelSeconds(Math.max(cfg.minAngleDeg, rawClockwiseDeg), true, kind);
}

/**
 * Avanza l'angolo continuo della ghiera lungo il delta più breve, bloccando fisicamente
 * agli estremi della scala senza avvolgimenti oltre le ore 12.
 */
export function advanceUnwrappedAngleDeg(
  currentUnwrappedDeg: number,
  prevPointerDeg: number,
  nextPointerDeg: number,
  kind: WheelKind = 'WORK',
): number {
  const cfg = getWheelConfig(kind);
  let delta = nextPointerDeg - prevPointerDeg;
  if (delta > 180) {
    delta -= 360;
  } else if (delta < -180) {
    delta += 360;
  }
  return Math.min(
    cfg.maxAngleDeg,
    Math.max(cfg.minAngleDeg, currentUnwrappedDeg + delta),
  );
}

export interface HorizontalScrubResult {
  nextValue: number;
  nextResidualPx: number;
  stepsChanged: number;
}

/**
 * Converte uno slide orizzontale (destra = +1, sinistra = -1) sopra un valore
 * numerico in scatti discreti, scartando l'eventuale accumulo oltre min/max.
 */
export function advanceHorizontalScrub(params: {
  value: number;
  residualPx: number;
  deltaX: number;
  min: number;
  max: number;
  step: number | ((currentValue: number, direction: 1 | -1) => number);
  pxPerStep?: number;
}): HorizontalScrubResult {
  const { value, residualPx, deltaX, min, max, step, pxPerStep = 14 } = params;
  const safePxPerStep = Math.max(4, pxPerStep);
  let totalPx = residualPx + deltaX;
  let nextValue = Math.min(max, Math.max(min, value));
  let stepsChanged = 0;

  while (Math.abs(totalPx) >= safePxPerStep) {
    const dir: 1 | -1 = totalPx > 0 ? 1 : -1;
    const stepSize = typeof step === 'function' ? step(nextValue, dir) : step;
    const candidate = Math.min(max, Math.max(min, nextValue + dir * stepSize));
    if (candidate === nextValue) {
      totalPx = 0;
      break;
    }
    nextValue = candidate;
    stepsChanged += 1;
    totalPx -= dir * safePxPerStep;
  }

  return {
    nextValue,
    nextResidualPx: totalPx,
    stepsChanged,
  };
}

export type TouchGestureAxis = 'pending' | 'horizontal' | 'vertical';

export function classifyTouchGesture(
  deltaX: number,
  deltaY: number,
  thresholdPx = 8,
): TouchGestureAxis {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  if (absX < thresholdPx && absY < thresholdPx) {
    return 'pending';
  }
  return absY > absX ? 'vertical' : 'horizontal';
}
