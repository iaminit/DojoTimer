import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useDialogFocusTrap } from '../hooks/useDialogFocusTrap';
import { useNativeBackHandler } from '../hooks/useNativeBackHandler';
import { triggerWheelHaptic } from '../services/haptics';
import { soundEngine } from '../services/soundEngine';
import { formatMMSS } from '../utils/formatTime';
import {
  advanceUnwrappedAngleDeg,
  angleDegToWheelSeconds,
  getWheelConfig,
  isHotspotDuration,
  normalizeWheelInitialSeconds,
  pointerToClockwiseAngleDeg,
  tapAngleDegToWheelSeconds,
  type WheelKind,
  wheelSecondsToAngleDeg,
} from '../utils/wheelMath';

interface RoundDurationWheelModalProps {
  isOpen: boolean;
  mode?: WheelKind;
  title?: string;
  initialSeconds: number;
  accentHex: string;
  accentRgb: string;
  onClose: () => void;
  onConfirm: (nextSeconds: number) => void;
}

const SVG_SIZE = 320;
const CX = SVG_SIZE / 2;
const CY = SVG_SIZE / 2;
const TRACK_R = 108;
const CIRCUMFERENCE = 2 * Math.PI * TRACK_R;
const TICK_INNER_R = 122;
const TICK_OUTER_MINOR_R = 126;
const TICK_OUTER_MAJOR_R = 130;
const HOTSPOT_LABEL_R = 144;

export function RoundDurationWheelModal({
  isOpen,
  mode = 'WORK',
  title,
  initialSeconds,
  accentHex,
  accentRgb,
  onClose,
  onConfirm,
}: RoundDurationWheelModalProps) {
  const cfg = getWheelConfig(mode);
  const [selectedSeconds, setSelectedSeconds] = useState<number>(() =>
    normalizeWheelInitialSeconds(initialSeconds, mode),
  );
  const [isDragging, setIsDragging] = useState(false);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const dialRef = useRef<HTMLDivElement | null>(null);
  const unwrappedAngleRef = useRef<number>(wheelSecondsToAngleDeg(selectedSeconds, mode));
  const prevPointerDegRef = useRef<number | null>(null);
  const lastEmittedSecRef = useRef<number>(selectedSeconds);

  useEffect(() => {
    if (!isOpen) return;
    const quantized = normalizeWheelInitialSeconds(initialSeconds, mode);
    setSelectedSeconds(quantized);
    unwrappedAngleRef.current = wheelSecondsToAngleDeg(quantized, mode);
    lastEmittedSecRef.current = quantized;
    prevPointerDegRef.current = null;
    setIsDragging(false);
  }, [initialSeconds, isOpen, mode]);

  useNativeBackHandler(
    isOpen,
    () => {
      onClose();
      return true;
    },
    60,
  );

  useDialogFocusTrap({
    isOpen,
    containerRef: dialogRef,
    initialFocusRef: closeBtnRef,
    onEscape: onClose,
  });

  if (!isOpen) {
    return null;
  }

  const commitSeconds = (nextSec: number, syncAngle = false) => {
    setSelectedSeconds(nextSec);
    if (syncAngle) {
      unwrappedAngleRef.current = wheelSecondsToAngleDeg(nextSec, mode);
    }
    if (nextSec !== lastEmittedSecRef.current) {
      lastEmittedSecRef.current = nextSec;
      triggerWheelHaptic(isHotspotDuration(nextSec, mode));
    }
  };

  const handleDialPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = dialRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dist = Math.hypot(e.clientX - centerX, e.clientY - centerY);
    const radius = rect.width / 2;
    if (dist < radius * 0.42) {
      return;
    }

    soundEngine.unlock();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);

    const rawDeg = pointerToClockwiseAngleDeg(e.clientX, e.clientY, centerX, centerY);
    prevPointerDegRef.current = rawDeg;
    const snappedSec = tapAngleDegToWheelSeconds(rawDeg, mode);
    unwrappedAngleRef.current = wheelSecondsToAngleDeg(snappedSec, mode);
    commitSeconds(snappedSec);
  };

  const handleDialPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (prevPointerDegRef.current === null) return;
    const el = dialRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const rawDeg = pointerToClockwiseAngleDeg(e.clientX, e.clientY, centerX, centerY);
    unwrappedAngleRef.current = advanceUnwrappedAngleDeg(
      unwrappedAngleRef.current,
      prevPointerDegRef.current,
      rawDeg,
      mode,
    );
    prevPointerDegRef.current = rawDeg;

    const nextSec = angleDegToWheelSeconds(unwrappedAngleRef.current, true, mode);
    commitSeconds(nextSec);
  };

  const handleDialPointerEnd = () => {
    if (prevPointerDegRef.current === null) return;
    prevPointerDegRef.current = null;
    setIsDragging(false);
    unwrappedAngleRef.current = wheelSecondsToAngleDeg(selectedSeconds, mode);
  };

  const displayAngleDeg = wheelSecondsToAngleDeg(selectedSeconds, mode);
  const rad = (displayAngleDeg * Math.PI) / 180;
  const knobX = CX + TRACK_R * Math.sin(rad);
  const knobY = CY - TRACK_R * Math.cos(rad);
  const strokeDashoffset = CIRCUMFERENCE * (1 - displayAngleDeg / 360);
  const modalTitle = title ?? (mode === 'REST' ? 'Tempo di Riposo' : 'Durata del Round');
  const stepDeg = 360 / cfg.totalTicks;

  return (
    <div
      ref={dialogRef}
      className="dojo-scroll fixed inset-0 z-50 flex overflow-y-auto bg-black/85 p-4 pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={`Selettore Circolare ${modalTitle}`}
    >
      <div
        className="my-auto mx-auto grid w-full max-w-md grid-cols-1 items-center gap-4 rounded-3xl border border-white/20 bg-neutral-950 p-5 text-white shadow-2xl sm:gap-5 sm:p-6 [@media(orientation:landscape)_and_(max-height:520px)]:max-w-2xl [@media(orientation:landscape)_and_(max-height:520px)]:grid-cols-[auto_1fr] [@media(orientation:landscape)_and_(max-height:520px)]:grid-rows-[auto_1fr] [@media(orientation:landscape)_and_(max-height:520px)]:gap-x-6 [@media(orientation:landscape)_and_(max-height:520px)]:gap-y-4 [@media(orientation:landscape)_and_(max-height:520px)]:p-4"
        style={
          mode === 'REST'
            ? {
                borderColor: `rgba(${accentRgb}, 0.42)`,
                boxShadow: `0 0 36px rgba(${accentRgb}, 0.16)`,
              }
            : undefined
        }
      >
        {/* Header */}
        <div className="flex w-full items-center justify-between gap-2 [@media(orientation:landscape)_and_(max-height:520px)]:col-start-2 [@media(orientation:landscape)_and_(max-height:520px)]:row-start-1 [@media(orientation:landscape)_and_(max-height:520px)]:self-start">
          <div className="flex min-w-0 flex-col">
            <span
              className="whitespace-nowrap text-xs font-extrabold tracking-[0.12em] uppercase"
              style={{ color: accentHex }}
            >
              {mode === 'REST' ? 'GHIERA FINESCALE • 5s – 180s' : 'GHIERA RAPIDA'}
            </span>
            <h2 className="whitespace-nowrap text-lg font-extrabold tracking-[0.04em] text-white sm:text-xl">
              {modalTitle}
            </h2>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Chiudi ghiera"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-black text-slate-300 hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Interactive 360° Rotary Dial */}
        <div
          ref={dialRef}
          onPointerDown={handleDialPointerDown}
          onPointerMove={handleDialPointerMove}
          onPointerUp={handleDialPointerEnd}
          onPointerCancel={handleDialPointerEnd}
          className="relative mx-auto aspect-square w-[min(78vw,48dvh,320px)] touch-none select-none cursor-grab active:cursor-grabbing [@media(orientation:landscape)_and_(max-height:520px)]:col-start-1 [@media(orientation:landscape)_and_(max-height:520px)]:row-span-2 [@media(orientation:landscape)_and_(max-height:520px)]:row-start-1 [@media(orientation:landscape)_and_(max-height:520px)]:w-[min(42vw,68dvh,230px)]"
        >
          <svg viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`} className="h-full w-full overflow-visible">
            {/* Background Track */}
            <circle
              cx={CX}
              cy={CY}
              r={TRACK_R}
              fill="rgba(0,0,0,0.9)"
              stroke="rgba(255,255,255,0.14)"
              strokeWidth={10}
            />

            {/* Radial Ticks */}
            {Array.from({ length: cfg.totalTicks }, (_, i) => {
              const deg = i * stepDeg;
              const angleRad = (deg * Math.PI) / 180;
              const isMajor = i % cfg.majorTickEvery === 0;
              const x1 = CX + TICK_INNER_R * Math.sin(angleRad);
              const y1 = CY - TICK_INNER_R * Math.cos(angleRad);
              const outerR = isMajor ? TICK_OUTER_MAJOR_R : TICK_OUTER_MINOR_R;
              const x2 = CX + outerR * Math.sin(angleRad);
              const y2 = CY - outerR * Math.cos(angleRad);
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={isMajor ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.18)'}
                  strokeWidth={isMajor ? 2 : 1}
                  strokeLinecap="round"
                />
              );
            })}

            {/* Active Arc starting from 12 o'clock clockwise */}
            <circle
              cx={CX}
              cy={CY}
              r={TRACK_R}
              fill="none"
              stroke={accentHex}
              strokeWidth={10}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={strokeDashoffset}
              transform={`rotate(-90 ${CX} ${CY})`}
              style={{ filter: `drop-shadow(0 0 10px rgba(${accentRgb}, 0.55))` }}
            />

            {/* Interactive Hotspot Markers */}
            {cfg.hotspots.map((hotspot) => {
              const deg = hotspot.angleDeg === 360 ? 0 : hotspot.angleDeg;
              const angleRad = (deg * Math.PI) / 180;
              const hx = CX + HOTSPOT_LABEL_R * Math.sin(angleRad);
              const hy = CY - HOTSPOT_LABEL_R * Math.cos(angleRad);
              const active = selectedSeconds === hotspot.value;

              return (
                <g
                  key={hotspot.value}
                  role="button"
                  tabIndex={0}
                  aria-label={
                    mode === 'REST'
                      ? `Imposta ${hotspot.label} secondi`
                      : `Imposta ${hotspot.label} minuti`
                  }
                  className="cursor-pointer focus:outline-none"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    soundEngine.unlock();
                    commitSeconds(hotspot.value, true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      soundEngine.unlock();
                      commitSeconds(hotspot.value, true);
                    }
                  }}
                >
                  <circle cx={hx} cy={hy} r={18} fill="transparent" />
                  <circle
                    cx={hx}
                    cy={hy}
                    r={14}
                    fill={active ? accentHex : 'rgba(20, 20, 24, 0.92)'}
                    stroke={active ? accentHex : 'rgba(255,255,255,0.2)'}
                    strokeWidth={1.5}
                  />
                  <text
                    x={hx}
                    y={hy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={hotspot.label.length >= 3 ? 10 : 12}
                    fontWeight={800}
                    fill={active ? '#000000' : '#E2E8F0'}
                    className="pointer-events-none tabular-digits"
                  >
                    {hotspot.label}
                  </text>
                </g>
              );
            })}

            {/* Draggable Handle Thumb */}
            <g className="pointer-events-none">
              <circle
                cx={knobX}
                cy={knobY}
                r={isDragging ? 15 : 13}
                fill={accentHex}
                stroke="#000000"
                strokeWidth={2.5}
                style={{ filter: `drop-shadow(0 0 12px rgba(${accentRgb}, 0.8))` }}
              />
              <circle cx={knobX} cy={knobY} r={5} fill="#FFFFFF" />
            </g>
          </svg>

          {/* Center Digital Readout */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span
              className="font-timer tabular-digits text-5xl font-bold leading-none tracking-tight [@media(orientation:landscape)_and_(max-height:520px)]:text-3xl"
              style={{ color: accentHex }}
            >
              {formatMMSS(selectedSeconds)}
            </span>
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="grid w-full grid-cols-2 gap-3 pt-1 [@media(orientation:landscape)_and_(max-height:520px)]:col-start-2 [@media(orientation:landscape)_and_(max-height:520px)]:row-start-2 [@media(orientation:landscape)_and_(max-height:520px)]:self-end">
          <button
            type="button"
            onClick={onClose}
            className="whitespace-nowrap min-h-[52px] rounded-full border border-white/25 bg-black text-sm font-extrabold tracking-[0.14em] text-white uppercase transition-colors hover:border-white/55 cursor-pointer"
          >
            ANNULLA
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm(selectedSeconds);
              onClose();
            }}
            className="whitespace-nowrap min-h-[52px] rounded-full text-sm font-extrabold tracking-[0.14em] text-black uppercase transition-transform active:scale-98 cursor-pointer"
            style={{
              backgroundColor: accentHex,
              boxShadow: `0 0 20px rgba(${accentRgb}, 0.4)`,
            }}
          >
            CONFERMA
          </button>
        </div>
      </div>
    </div>
  );
}
