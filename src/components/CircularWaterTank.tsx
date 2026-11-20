import { useCallback, useLayoutEffect, useRef } from 'react';
import type { FillProgressSubscriber } from '../hooks/useTimerEngine';
import {
  buildPeriodicCrestPath,
  buildPeriodicWavePath,
  computeWaterFillMetrics,
  WAVE_BASE_AMP,
  WAVE_CREST_STROKE,
} from '../utils/waterFill';

interface CircularWaterTankProps {
  rgb: string;
  fillProgress: number;
  isPaused?: boolean;
  subscribeFillProgress?: FillProgressSubscriber;
}

const CIRCLE_WAVE_PATH = buildPeriodicWavePath(20, WAVE_BASE_AMP, 0, 360, 2);
const CIRCLE_CREST_PATH = buildPeriodicCrestPath(20, WAVE_BASE_AMP, 0, 2);

/**
 * Liquido interno al cerchio a onda singola:
 * - Zero SVG `<clipPath>`, zero `<linearGradient>` mutato a 60fps e zero parallasse multi-onda.
 * - Maschera circolare hardware (`rounded-full overflow-hidden`) e scorrimento HTML `translate3d` puro.
 */
export function CircularWaterTank({
  rgb,
  fillProgress,
  isPaused = false,
  subscribeFillProgress,
}: CircularWaterTankProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const waterRiseRef = useRef<HTMLDivElement | null>(null);
  const bodyOpacityRef = useRef<HTMLDivElement | null>(null);

  const lastVisRef = useRef<string>('');
  const lastTransformRef = useRef<string>('');
  const lastOpacityRef = useRef<string>('');

  const applyWaterProgress = useCallback((p: number) => {
    const metrics = computeWaterFillMetrics(p);
    const vis = metrics.isVisible ? 'visible' : 'hidden';
    if (vis !== lastVisRef.current) {
      lastVisRef.current = vis;
      if (rootRef.current) {
        rootRef.current.style.visibility = vis;
      }
    }

    const yPct = (50 + (0.5 - metrics.clampedFill) * 106).toFixed(2);
    const nextTransform = `translate3d(0, ${yPct}%, 0)`;
    if (nextTransform !== lastTransformRef.current) {
      lastTransformRef.current = nextTransform;
      if (waterRiseRef.current) {
        waterRiseRef.current.style.transform = nextTransform;
      }
    }

    const opacityStr = metrics.baseOpacity.toFixed(2);
    if (opacityStr !== lastOpacityRef.current) {
      lastOpacityRef.current = opacityStr;
      if (bodyOpacityRef.current) {
        bodyOpacityRef.current.style.opacity = opacityStr;
      }
    }
  }, []);

  useLayoutEffect(() => {
    if (!subscribeFillProgress) {
      return;
    }
    lastVisRef.current = '';
    lastTransformRef.current = '';
    lastOpacityRef.current = '';
    return subscribeFillProgress(applyWaterProgress);
  }, [applyWaterProgress, subscribeFillProgress]);

  useLayoutEffect(() => {
    if (subscribeFillProgress) {
      return;
    }
    lastVisRef.current = '';
    lastTransformRef.current = '';
    lastOpacityRef.current = '';
    applyWaterProgress(fillProgress);
  }, [applyWaterProgress, fillProgress, subscribeFillProgress]);

  const playState = isPaused ? 'paused' : 'running';

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-[3.125%] z-[2] overflow-hidden rounded-full"
      style={{ contain: 'layout style paint', transform: 'translateZ(0)' }}
      aria-hidden="true"
    >
      <div
        ref={waterRiseRef}
        className="absolute inset-0 will-change-transform"
        style={{ backfaceVisibility: 'hidden' }}
      >
        {/* Single saturating water body (opacity composited directly on 1 GPU quad) */}
        <div ref={bodyOpacityRef} className="absolute inset-0 will-change-[opacity]">
          <div
            className="water-wave-front-layer absolute left-0 top-[-6.6667%] h-[120%] w-[213.3333%]"
            style={{ animationPlayState: playState }}
          >
            <svg
              viewBox="0 0 640 360"
              className="block h-full w-full"
              preserveAspectRatio="none"
            >
              <path d={CIRCLE_WAVE_PATH} fill={`rgb(${rgb})`} />
            </svg>
          </div>
        </div>

        {/* Single crisp phase-colored crest line (phase-locked 3.4s linear scroll) */}
        <div
          className="water-wave-front-layer pointer-events-none absolute left-0 top-[-6.6667%] z-[2] h-[14.6667%] w-[213.3333%]"
          style={{ animationPlayState: playState }}
        >
          <svg
            viewBox="0 0 640 44"
            className="block h-full w-full overflow-visible"
            preserveAspectRatio="none"
          >
            <path
              d={CIRCLE_CREST_PATH}
              fill="none"
              stroke={`rgb(${rgb})`}
              strokeWidth={WAVE_CREST_STROKE}
              strokeOpacity={0.95}
            />
          </svg>
        </div>
      </div>

      {/* Static subtle center depth shading for digit legibility */}
      <div
        className="pointer-events-none absolute inset-0 z-[1] rounded-full"
        style={{
          background:
            'radial-gradient(circle at 50% 48%, rgba(0, 0, 0, 0.22) 0%, rgba(0, 0, 0, 0) 72%)',
        }}
      />
    </div>
  );
}
