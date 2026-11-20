import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import type { FillProgressSubscriber } from '../hooks/useTimerEngine';
import {
  buildPeriodicCrestPath,
  buildPeriodicWavePath,
  buildVerticalPeriodicCrestPath,
  buildVerticalPeriodicWavePath,
  CLASSIC_CIRCLE_DIAMETER_CSS,
  computeWaterFillMetrics,
  WAVE_BASE_AMP,
  WAVE_CREST_STROKE,
  WAVE_PERIOD_UNITS,
} from '../utils/waterFill';

interface ClassicWaveBackgroundProps {
  rgb: string;
  hex?: string;
  opacity: number;
  fillProgress: number;
  isPaused?: boolean;
  subscribeFillProgress?: FillProgressSubscriber;
  referenceCircleSizeCss?: string;
  supportLandscapeHorizontal?: boolean;
}

// 5 visible periods (1600 units) over a 6-period path (1920 units) with a single clean wave
// (no parallax back wave, no offscreen opacity FBO, HTML GPU transform instead of SVG path transform).
const VISIBLE_PERIODS = 5;
const PATH_PERIODS = 6;
const VIEWBOX_LEN = VISIBLE_PERIODS * WAVE_PERIOD_UNITS; // 1600
const PATH_LEN = PATH_PERIODS * WAVE_PERIOD_UNITS; // 1920
const WAVE_BAND_SPAN = 44;
const WAVE_CENTER = 20;
const LANDSCAPE_WAVE_CENTER = 24;

const H_FRONT_PATH = buildPeriodicWavePath(
  WAVE_CENTER,
  WAVE_BASE_AMP,
  0,
  WAVE_BAND_SPAN,
  PATH_PERIODS,
);
const H_CREST_PATH = buildPeriodicCrestPath(WAVE_CENTER, WAVE_BASE_AMP, 0, PATH_PERIODS);

const V_FRONT_PATH = buildVerticalPeriodicWavePath(
  LANDSCAPE_WAVE_CENTER,
  WAVE_BASE_AMP,
  0,
  0,
  PATH_PERIODS,
);
const V_CREST_PATH = buildVerticalPeriodicCrestPath(
  LANDSCAPE_WAVE_CENTER,
  WAVE_BASE_AMP,
  0,
  PATH_PERIODS,
);

/**
 * Premoltiplica un colore RGB sullo sfondo nero puro (#000000):
 * visivamente identico a `rgba(rgb, opacity)` sopra nero, ma 100% opaco
 * così il compositore GPU evita il render-pass FBO offscreen full-screen.
 */
function premultiplyRgbOnBlack(rgb: string, opacity: number): string {
  const parts = rgb.split(',').map((part) => Number.parseFloat(part.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return `rgba(${rgb}, ${opacity.toFixed(3)})`;
  }
  const r = Math.round(Math.min(255, Math.max(0, parts[0] * opacity)));
  const g = Math.round(Math.min(255, Math.max(0, parts[1] * opacity)));
  const b = Math.round(Math.min(255, Math.max(0, parts[2] * opacity)));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Sfondo fluido a onda singola sincronizzato con CircularWaterTank:
 * - Nessun parallasse multi-onda e nessun gruppo opacity offscreen.
 * - Traslazione verticale e scorrimento orizzontale su layer HTML `translate3d` puri (zero flicker WebView).
 */
export function ClassicWaveBackground({
  rgb,
  opacity,
  fillProgress,
  isPaused = false,
  subscribeFillProgress,
  referenceCircleSizeCss = CLASSIC_CIRCLE_DIAMETER_CSS,
  supportLandscapeHorizontal = true,
}: ClassicWaveBackgroundProps) {
  const clampedOpacity = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0.5;
  const playState = isPaused ? 'paused' : 'running';
  const showCrest = clampedOpacity > 0.001;
  const bodyColor = useMemo(
    () => premultiplyRgbOnBlack(rgb, clampedOpacity),
    [rgb, clampedOpacity],
  );

  const portraitCurtainRef = useRef<HTMLDivElement | null>(null);
  const landscapeCurtainRef = useRef<HTMLDivElement | null>(null);

  const lastVisRef = useRef<string>('');
  const lastPortraitTransformRef = useRef<string>('');
  const lastLandscapeTransformRef = useRef<string>('');

  const applyProgress = useCallback((p: number) => {
    const metrics = computeWaterFillMetrics(p);
    const visibility = metrics.isVisible ? 'visible' : 'hidden';

    const pCurtain = portraitCurtainRef.current;
    const lCurtain = landscapeCurtainRef.current;

    if (visibility !== lastVisRef.current) {
      lastVisRef.current = visibility;
      if (pCurtain) pCurtain.style.visibility = visibility;
      if (lCurtain) lCurtain.style.visibility = visibility;
    }

    if (pCurtain) {
      const yPct = (50 + (0.5 - metrics.clampedFill) * 103).toFixed(2);
      const nextTransform = `translate3d(0, ${yPct}%, 0)`;
      if (nextTransform !== lastPortraitTransformRef.current) {
        lastPortraitTransformRef.current = nextTransform;
        pCurtain.style.transform = nextTransform;
      }
    }

    if (lCurtain) {
      const xPct = ((metrics.clampedFill - 0.5) * 103 - 50).toFixed(2);
      const nextTransform = `translate3d(${xPct}%, 0, 0)`;
      if (nextTransform !== lastLandscapeTransformRef.current) {
        lastLandscapeTransformRef.current = nextTransform;
        lCurtain.style.transform = nextTransform;
      }
    }
  }, []);

  useLayoutEffect(() => {
    if (!subscribeFillProgress) {
      return;
    }
    lastVisRef.current = '';
    lastPortraitTransformRef.current = '';
    lastLandscapeTransformRef.current = '';
    return subscribeFillProgress(applyProgress);
  }, [applyProgress, subscribeFillProgress]);

  useLayoutEffect(() => {
    if (subscribeFillProgress) {
      return;
    }
    lastVisRef.current = '';
    lastPortraitTransformRef.current = '';
    lastLandscapeTransformRef.current = '';
    applyProgress(fillProgress);
  }, [applyProgress, fillProgress, subscribeFillProgress]);

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden bg-black"
      style={{
        ['--wave-unit' as string]: `calc(${referenceCircleSizeCss} / 480)`,
        contain: 'strict',
      }}
      aria-hidden="true"
    >
      {/* Portrait (or compact preview): bottom -> top single rising wave mirrored horizontally */}
      <div className={supportLandscapeHorizontal ? 'absolute inset-0 landscape:hidden' : 'absolute inset-0'}>
        <div
          ref={portraitCurtainRef}
          className="absolute inset-0 will-change-transform"
          style={{ backfaceVisibility: 'hidden' }}
        >
          <div
            className="absolute right-0 left-0"
            style={{
              top: 'calc(18 * var(--wave-unit))',
              bottom: '-12%',
              backgroundColor: bodyColor,
            }}
          />
          <div
            className="pointer-events-none absolute overflow-hidden"
            style={{
              left: '50%',
              top: `calc(-${WAVE_CENTER} * var(--wave-unit))`,
              width: `calc(${VIEWBOX_LEN} * var(--wave-unit))`,
              height: `calc(${WAVE_BAND_SPAN} * var(--wave-unit))`,
              transform: 'translateX(-50%) scaleX(-1)',
            }}
          >
            <div
              className="water-wave-bg-single-h h-full"
              style={{ width: '120%', animationPlayState: playState }}
            >
              <svg
                viewBox={`0 0 ${PATH_LEN} ${WAVE_BAND_SPAN}`}
                className="block h-full w-full"
                preserveAspectRatio="none"
              >
                <path d={H_FRONT_PATH} fill={bodyColor} />
                {showCrest && (
                  <path
                    d={H_CREST_PATH}
                    fill="none"
                    stroke={`rgb(${rgb})`}
                    strokeWidth={WAVE_CREST_STROKE}
                    strokeOpacity={0.95}
                  />
                )}
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Landscape (full screen only): left -> right single advancing wave */}
      {supportLandscapeHorizontal && (
        <div className="hidden absolute inset-0 landscape:block">
          <div
            ref={landscapeCurtainRef}
            className="absolute inset-0 will-change-transform"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <div
              className="absolute top-0 bottom-0"
              style={{
                left: '-12%',
                right: 'calc(18 * var(--wave-unit))',
                backgroundColor: bodyColor,
              }}
            />
            <div
              className="pointer-events-none absolute overflow-hidden"
              style={{
                top: '50%',
                right: `calc(-${WAVE_BAND_SPAN - LANDSCAPE_WAVE_CENTER} * var(--wave-unit))`,
                width: `calc(${WAVE_BAND_SPAN} * var(--wave-unit))`,
                height: `calc(${VIEWBOX_LEN} * var(--wave-unit))`,
                transform: 'translateY(-50%) scaleY(-1)',
              }}
            >
              <div
                className="water-wave-bg-single-v w-full"
                style={{ height: '120%', animationPlayState: playState }}
              >
                <svg
                  viewBox={`0 0 ${WAVE_BAND_SPAN} ${PATH_LEN}`}
                  className="block h-full w-full"
                  preserveAspectRatio="none"
                >
                  <path d={V_FRONT_PATH} fill={bodyColor} />
                  {showCrest && (
                    <path
                      d={V_CREST_PATH}
                      fill="none"
                      stroke={`rgb(${rgb})`}
                      strokeWidth={WAVE_CREST_STROKE}
                      strokeOpacity={0.95}
                    />
                  )}
                </svg>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
