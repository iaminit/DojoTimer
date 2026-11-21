import { useCallback, useLayoutEffect, useRef } from 'react';
import type { TimerEngineState } from '../engine/timerMachine';
import type { FillProgressSubscriber } from '../hooks/useTimerEngine';
import { resolveDigitScaleFactors } from '../services/storage';
import { getClockDisplay } from '../utils/formatTime';
import {
  resolveTimerPhaseBannerLabel,
  type VisualThemeTokens,
} from '../utils/themePalette';
import { CircularWaterTank } from './CircularWaterTank';

interface CircularTimerDisplayProps {
  state: TimerEngineState;
  theme: VisualThemeTokens;
  digitScale?: number;
  fillProgress: number;
  subscribeFillProgress?: FillProgressSubscriber;
}

const SVG_SIZE = 320;
const RING_PAD = 12;
const STROKE_WIDTH = 6;
const RADIUS = (SVG_SIZE - STROKE_WIDTH * 2) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function CircularTimerDisplay({
  state,
  theme,
  digitScale = 100,
  fillProgress,
  subscribeFillProgress,
}: CircularTimerDisplayProps) {
  const clock = getClockDisplay(state.remainingMs);
  const { portraitFactor, landscapeFactor } = resolveDigitScaleFactors(digitScale);
  const phaseBannerLabel = resolveTimerPhaseBannerLabel(state.phase, state.program.discipline);
  const progressCircleRef = useRef<SVGCircleElement | null>(null);
  const progressHaloCircleRef = useRef<SVGCircleElement | null>(null);
  const lastDashOffsetRef = useRef<string>('');
  const lastOpacityRef = useRef<string>('');

  const applyRingProgress = useCallback((p: number) => {
    const clamped = Math.min(1, Math.max(0, p));
    const dashOffset = (Math.round(CIRCUMFERENCE * (1 - clamped) * 2) / 2).toFixed(1);
    const opacity = clamped <= 0.001 ? '0' : '1';

    if (dashOffset !== lastDashOffsetRef.current) {
      lastDashOffsetRef.current = dashOffset;
      progressCircleRef.current?.setAttribute('stroke-dashoffset', dashOffset);
      progressHaloCircleRef.current?.setAttribute('stroke-dashoffset', dashOffset);
    }
    if (opacity !== lastOpacityRef.current) {
      lastOpacityRef.current = opacity;
      progressCircleRef.current?.setAttribute('opacity', opacity);
      progressHaloCircleRef.current?.setAttribute('opacity', opacity);
    }
  }, []);

  useLayoutEffect(() => {
    if (!subscribeFillProgress) {
      return;
    }
    lastDashOffsetRef.current = '';
    lastOpacityRef.current = '';
    return subscribeFillProgress(applyRingProgress);
  }, [applyRingProgress, subscribeFillProgress]);

  useLayoutEffect(() => {
    if (subscribeFillProgress) {
      return;
    }
    lastDashOffsetRef.current = '';
    lastOpacityRef.current = '';
    applyRingProgress(fillProgress);
  }, [applyRingProgress, fillProgress, subscribeFillProgress]);

  return (
    <>
      <div className="relative z-10 flex min-h-0 w-full flex-1 flex-col items-center landscape:hidden">
        {/* Phase Banner symmetrically centered between ROUND pill and main circle */}
        <div className="flex min-h-0 w-full flex-1 items-center justify-center py-2">
          <div
            className="inline-flex shrink-0 items-center justify-center rounded-full border-2 bg-black/92 px-6 py-1.5 sm:px-8 sm:py-2"
            style={{
              borderColor: `rgba(${theme.rgb}, 0.65)`,
              boxShadow: `0 0 22px rgba(${theme.rgb}, 0.24), 0 6px 24px rgba(0, 0, 0, 0.85)`,
            }}
            aria-live="polite"
          >
            <span
              className="whitespace-nowrap text-lg font-extrabold tracking-[0.2em] text-white uppercase sm:text-2xl md:text-3xl"
              style={{
                textShadow: `0 0 14px rgba(${theme.rgb}, 0.45)`,
              }}
            >
              {phaseBannerLabel}
            </span>
          </div>
        </div>

        {/* Main Minimal Black Circle Gauge */}
        <div
          className="relative flex aspect-square shrink-0 w-[min(93vw,62dvh)] max-w-[660px] [container-type:inline-size] items-center justify-center rounded-full bg-black ring-4 ring-black"
          style={{
            boxShadow: `0 0 36px rgba(${theme.rgb}, 0.22), 0 0 64px rgba(0, 0, 0, 0.95)`,
          }}
        >
          {/* Internal Rising Water Saturation Layer (15% -> opaque) */}
          <CircularWaterTank
            rgb={theme.rgb}
            fillProgress={fillProgress}
            isPaused={state.isPaused}
            subscribeFillProgress={subscribeFillProgress}
          />

          {/* Circular SVG Ring (tight padding around halo stroke, isolated repaint layer) */}
          <svg
            viewBox={`${-RING_PAD} ${-RING_PAD} ${SVG_SIZE + RING_PAD * 2} ${SVG_SIZE + RING_PAD * 2}`}
            className="pointer-events-none absolute -inset-[3.75%] z-[5] h-[107.5%] w-[107.5%] -rotate-90 overflow-visible"
            style={{ contain: 'layout style paint' }}
            aria-hidden="true"
          >
            <circle
              cx={SVG_SIZE / 2}
              cy={SVG_SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={`rgba(${theme.rgb}, 0.25)`}
              strokeWidth={STROKE_WIDTH}
            />
            <circle
              ref={progressHaloCircleRef}
              cx={SVG_SIZE / 2}
              cy={SVG_SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={`rgba(${theme.rgb}, 0.28)`}
              strokeWidth={STROKE_WIDTH + 8}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
            />
            <circle
              ref={progressCircleRef}
              cx={SVG_SIZE / 2}
              cy={SVG_SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={theme.hex}
              strokeWidth={STROKE_WIDTH + 1}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
            />
          </svg>

          {/* Center Typography enlarged to maximum safe diameter inside the ring */}
          <div className="relative z-10 flex w-full flex-col items-center justify-center px-[3%] text-center">
            <div
              className="font-timer tabular-digits timer-digits-luminescent flex items-center justify-center font-extrabold leading-[0.95] tracking-[-0.02em] text-white"
              style={{
                fontSize:
                  clock.minutes.length >= 3
                    ? `calc(clamp(2rem, 23.6cqi, 11rem) * ${portraitFactor.toFixed(2)})`
                    : `calc(clamp(2.3rem, 29.2cqi, 13.8rem) * ${portraitFactor.toFixed(2)})`,
              }}
              role="timer"
              aria-label={`Tempo rimanente ${clock.minutes} minuti e ${clock.seconds} secondi`}
            >
              <span>{clock.minutes}</span>
              <span className="mx-0.5 -translate-y-[0.05em] opacity-95">:</span>
              <span>{clock.seconds}</span>
            </div>
          </div>
        </div>

        {/* Bottom flex counterweight so top banner sits centered between header pill and circle */}
        <div className="min-h-0 w-full flex-1" aria-hidden="true" />
      </div>

      {/* Landscape-Only Giant Scoreboard Digits (~2/3 horizontal width, no circle) */}
      <div
        className="relative z-10 hidden min-h-0 w-full flex-1 items-center justify-center landscape:flex"
        data-testid="landscape-timer-display"
      >
        <div
          className="font-timer tabular-digits timer-digits-landscape flex items-center justify-center font-extrabold leading-[0.88] tracking-[-0.02em] text-white select-none"
          style={{
            fontSize:
              clock.minutes.length >= 3
                ? `calc(clamp(3rem, min(18.5vw, 50dvh), 26rem) * ${landscapeFactor.toFixed(2)})`
                : `calc(clamp(3.5rem, min(22.5vw, 56dvh), 32rem) * ${landscapeFactor.toFixed(2)})`,
          }}
          role="timer"
          aria-label={`Tempo rimanente ${clock.minutes} minuti e ${clock.seconds} secondi`}
        >
          <span>{clock.minutes}</span>
          <span className="mx-[0.02em] -translate-y-[0.06em] opacity-95">:</span>
          <span>{clock.seconds}</span>
        </div>
      </div>
    </>
  );
}
