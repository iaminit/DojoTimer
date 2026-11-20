import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleDot, Minus, Plus } from 'lucide-react';
import { triggerButtonFeedback, triggerWheelHaptic } from '../../services/haptics';
import { soundEngine } from '../../services/soundEngine';
import { advanceHorizontalScrub, classifyTouchGesture } from '../../utils/wheelMath';

export function RoundStepperButton({
  kind,
  label,
  disabled,
  accentBorderColor,
  onStep,
}: {
  kind: 'minus' | 'plus';
  label: string;
  disabled: boolean;
  accentBorderColor?: string;
  onStep: () => void;
}) {
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  const holdTimeoutRef = useRef<number | null>(null);
  const repeatIntervalRef = useRef<number | null>(null);
  const didRepeatRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (holdTimeoutRef.current !== null) {
      window.clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    if (repeatIntervalRef.current !== null) {
      window.clearInterval(repeatIntervalRef.current);
      repeatIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (disabled) {
      clearTimers();
    }
  }, [disabled, clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0) return;
    soundEngine.unlock();
    triggerButtonFeedback('firm');
    clearTimers();
    didRepeatRef.current = false;
    holdTimeoutRef.current = window.setTimeout(() => {
      didRepeatRef.current = true;
      onStepRef.current();
      triggerWheelHaptic(false);
      repeatIntervalRef.current = window.setInterval(() => {
        onStepRef.current();
        triggerWheelHaptic(false);
      }, 85);
    }, 400);
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (didRepeatRef.current) {
      didRepeatRef.current = false;
      return;
    }
    if (e.detail === 0) {
      soundEngine.unlock();
      triggerButtonFeedback('firm');
    }
    onStepRef.current();
  };

  return (
    <button
      type="button"
      data-custom-haptic="true"
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerUp={clearTimers}
      onPointerCancel={clearTimers}
      onPointerLeave={clearTimers}
      onClick={handleClick}
      aria-label={label}
      style={accentBorderColor ? { borderColor: accentBorderColor } : undefined}
      className="flex h-[52px] w-[52px] shrink-0 select-none items-center justify-center rounded-full border border-white/15 bg-neutral-900 text-white transition-all hover:border-white/35 hover:bg-neutral-800 active:scale-95 disabled:opacity-30 sm:h-[60px] sm:w-[60px] [@media(orientation:landscape)_and_(max-height:520px)]:h-11 [@media(orientation:landscape)_and_(max-height:520px)]:w-11 cursor-pointer"
    >
      {kind === 'minus' ? (
        <Minus className="h-6 w-6 [@media(orientation:landscape)_and_(max-height:520px)]:h-5 [@media(orientation:landscape)_and_(max-height:520px)]:w-5" />
      ) : (
        <Plus className="h-6 w-6 [@media(orientation:landscape)_and_(max-height:520px)]:h-5 [@media(orientation:landscape)_and_(max-height:520px)]:w-5" />
      )}
    </button>
  );
}

export function ScrubbableValueControl({
  value,
  displayValue,
  label,
  min,
  max,
  step,
  pxPerStep = 14,
  textColor = '#FFFFFF',
  labelColor,
  accentHex,
  accentRgb,
  wheelIconAccentHex,
  wheelIconAccentRgb,
  onOpenWheel,
  isHotspotValue,
  onChange,
}: {
  value: number;
  displayValue: string;
  label: string;
  min: number;
  max: number;
  step: number | ((currentValue: number, direction: 1 | -1) => number);
  pxPerStep?: number;
  textColor?: string;
  labelColor?: string;
  accentHex: string;
  accentRgb: string;
  wheelIconAccentHex?: string;
  wheelIconAccentRgb?: string;
  onOpenWheel?: () => void;
  isHotspotValue?: (val: number) => boolean;
  onChange: (nextValue: number) => void;
}) {
  const [isScrubbing, setIsScrubbing] = useState(false);

  const pointerIdRef = useRef<number | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const lastXRef = useRef(0);
  const liveValueRef = useRef(value);
  const residualPxRef = useRef(0);
  const didScrubRef = useRef(false);

  useEffect(() => {
    if (pointerIdRef.current === null) {
      liveValueRef.current = value;
    }
  }, [value]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    soundEngine.unlock();
    pointerIdRef.current = e.pointerId;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    lastXRef.current = e.clientX;
    liveValueRef.current = value;
    residualPxRef.current = 0;
    didScrubRef.current = false;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    if (!didScrubRef.current) {
      const axis = classifyTouchGesture(
        e.clientX - startXRef.current,
        e.clientY - startYRef.current,
        8,
      );
      if (axis === 'pending') {
        return;
      }
      if (axis === 'vertical') {
        pointerIdRef.current = null;
        return;
      }
      didScrubRef.current = true;
      setIsScrubbing(true);
      lastXRef.current = e.clientX;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture is unsupported or already released
      }
      return;
    }

    const deltaX = e.clientX - lastXRef.current;
    lastXRef.current = e.clientX;

    const result = advanceHorizontalScrub({
      value: liveValueRef.current,
      residualPx: residualPxRef.current,
      deltaX,
      min,
      max,
      step,
      pxPerStep,
    });
    residualPxRef.current = result.nextResidualPx;

    if (result.stepsChanged > 0 && result.nextValue !== liveValueRef.current) {
      liveValueRef.current = result.nextValue;
      onChange(result.nextValue);
      triggerWheelHaptic(isHotspotValue ? isHotspotValue(result.nextValue) : false);
    }
  };

  const endGesture = (e: React.PointerEvent<HTMLDivElement>, allowTap: boolean) => {
    if (pointerIdRef.current !== e.pointerId) return;
    const wasScrub = didScrubRef.current;
    pointerIdRef.current = null;
    didScrubRef.current = false;
    residualPxRef.current = 0;
    setIsScrubbing(false);

    if (allowTap && !wasScrub && onOpenWheel) {
      triggerButtonFeedback('firm');
      onOpenWheel();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (onOpenWheel && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      soundEngine.unlock();
      triggerButtonFeedback('firm');
      onOpenWheel();
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      soundEngine.unlock();
      const dir: 1 | -1 = e.key === 'ArrowRight' ? 1 : -1;
      const stepSize = typeof step === 'function' ? step(value, dir) : step;
      const next = Math.min(max, Math.max(min, value + dir * stepSize));
      if (next !== value) {
        liveValueRef.current = next;
        onChange(next);
        triggerWheelHaptic(isHotspotValue ? isHotspotValue(next) : false);
      }
    }
  };

  const effectiveColor = isScrubbing ? accentHex : textColor;

  return (
    <div
      data-custom-haptic="true"
      role={onOpenWheel ? 'button' : 'slider'}
      tabIndex={0}
      aria-label={label}
      aria-valuemin={onOpenWheel ? undefined : min}
      aria-valuemax={onOpenWheel ? undefined : max}
      aria-valuenow={onOpenWheel ? undefined : value}
      title={
        onOpenWheel
          ? 'Tocca per la ghiera o scorri a destra/sinistra per regolare'
          : 'Scorri a destra/sinistra per regolare con feedback aptico'
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => endGesture(e, true)}
      onPointerCancel={(e) => endGesture(e, false)}
      onKeyDown={handleKeyDown}
      className="group flex min-w-0 flex-1 touch-pan-y select-none flex-col items-start text-left outline-none cursor-ew-resize"
    >
      <div className="flex items-center gap-2">
        <span
          className="font-timer tabular-digits text-4xl font-bold leading-none tracking-tight transition-colors sm:text-5xl [@media(orientation:landscape)_and_(max-height:520px)]:text-3xl"
          style={{
            color: effectiveColor,
            textShadow: isScrubbing ? `0 0 18px rgba(${accentRgb}, 0.45)` : undefined,
          }}
        >
          {displayValue}
        </span>
        {isScrubbing && (
          <span
            className="text-xs font-extrabold tracking-widest"
            style={{ color: accentHex }}
            aria-hidden="true"
          >
            ◀▶
          </span>
        )}
      </div>

      <span className="mt-1.5 inline-flex items-center gap-2 whitespace-nowrap text-[13px] font-semibold tracking-[0.02em] text-slate-300 group-hover:text-white sm:text-base [@media(orientation:landscape)_and_(max-height:520px)]:mt-1 [@media(orientation:landscape)_and_(max-height:520px)]:text-xs">
        <span style={labelColor ? { color: labelColor } : undefined}>{label}</span>
        {onOpenWheel && wheelIconAccentHex && wheelIconAccentRgb && (
          <span className="relative inline-flex h-7 w-7 items-center justify-center sm:h-8 sm:w-8">
            <span
              className="animate-dial-halo pointer-events-none absolute inset-0.5 rounded-full border-2"
              style={{ borderColor: wheelIconAccentHex }}
              aria-hidden="true"
            />
            <CircleDot
              className="animate-dial-pulse relative z-10 h-6 w-6 sm:h-7 sm:w-7"
              strokeWidth={2.3}
              style={{
                color: wheelIconAccentHex,
                filter: `drop-shadow(0 0 8px rgba(${wheelIconAccentRgb}, 0.7))`,
              }}
            />
          </span>
        )}
      </span>
    </div>
  );
}

export function EditorStepper({
  label,
  value,
  displayValue,
  min,
  max,
  step = 1,
  accentHex,
  onChange,
}: {
  label: string;
  value: number;
  displayValue?: string;
  min: number;
  max: number;
  step?: number;
  accentHex: string;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-neutral-900/90 p-2.5">
      <span className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
        {label}
      </span>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - step))}
          disabled={value <= min}
          className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/20 bg-black text-xl font-bold text-white transition-colors hover:border-white/50 disabled:opacity-30 cursor-pointer"
          aria-label={`Diminuisci ${label}`}
        >
          −
        </button>
        <span
          className="tabular-digits text-xl font-bold sm:text-2xl"
          style={{ color: accentHex }}
        >
          {displayValue ?? value}
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + step))}
          disabled={value >= max}
          className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/20 bg-black text-xl font-bold text-white transition-colors hover:border-white/50 disabled:opacity-30 cursor-pointer"
          aria-label={`Aumenta ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}
