import type { TimerEngineState } from '../engine/timerMachine';
import { resolveDigitScaleFactors } from '../services/storage';
import { getClockDisplay } from '../utils/formatTime';
import {
  computeSecondsNegativeBarPct,
  type ProTimerPalette,
} from '../utils/proTimerTheme';

interface UltraModernTimerDisplayProps {
  state: TimerEngineState;
  palette: ProTimerPalette;
  digitScale?: number;
}

export function UltraModernTimerDisplay({
  state,
  palette,
  digitScale = 100,
}: UltraModernTimerDisplayProps) {
  const clock = getClockDisplay(state.remainingMs);
  const { portraitFactor, landscapeFactor } = resolveDigitScaleFactors(digitScale);
  const secElapsedPct = computeSecondsNegativeBarPct(clock.totalDisplaySeconds, state.phase);
  const ariaLabel = `Tempo del round: ${Number(clock.minutes)} minuti e ${Number(clock.seconds)} secondi`;
  const secondsGlow = palette.isUrgent
    ? 'rgba(255, 77, 77, 0.62)'
    : 'rgba(255, 255, 255, 0.44)';
  const unitGlow = `0 0 10px rgba(${palette.rgb}, 0.65)`;

  return (
    <>
      {/* Portrait: Container-Query Responsive Scoreboard Pro (never clips digits or M/S on any width/height) */}
      <div
        className="relative z-10 flex min-h-0 w-full flex-1 flex-col items-center justify-center pl-[max(20px,calc(env(safe-area-inset-left,0px)+16px))] pr-[max(20px,calc(env(safe-area-inset-right,0px)+16px))] pb-1 landscape:hidden"
        data-testid="pro-portrait-timer-display"
      >
        <div
          role="timer"
          aria-label={ariaLabel}
          className="flex w-full max-w-[min(100%,520px)] [container-type:inline-size] flex-col items-center gap-[clamp(12px,2.2dvh,24px)] select-none"
        >
          {/* Hollow / High-Contrast Outlined Minutes (dead center inside symmetric gutters) + M */}
          <div
            aria-hidden="true"
            className="grid w-full grid-cols-[clamp(18px,6cqi,28px)_minmax(0,1fr)_clamp(18px,6cqi,28px)] items-baseline"
          >
            <span aria-hidden="true" />
            <div
              className="font-timer-pro tabular-digits timer-pro-minutes-hollow mr-[-0.02em] justify-self-center whitespace-nowrap font-bold leading-[0.82] tracking-[0.02em]"
              style={{
                fontSize:
                  clock.minutes.length >= 3
                    ? `calc(clamp(2.4rem, min(32cqi, 19dvh), 11rem) * ${portraitFactor.toFixed(2)})`
                    : `calc(clamp(3.2rem, min(46cqi, 24dvh), 14rem) * ${portraitFactor.toFixed(2)})`,
              }}
            >
              {clock.minutes}
            </div>
            <span
              className="justify-self-end text-right text-[clamp(12px,4cqi,16px)] font-bold tracking-[0.12em] transition-colors duration-200"
              style={{ color: palette.hex, textShadow: unitGlow }}
            >
              M
            </span>
          </div>

          {/* Horizontal Seconds Negative-Black Bar */}
          <div
            aria-hidden="true"
            className="flex h-[3px] w-full justify-start overflow-hidden rounded-full transition-colors duration-200"
            style={{
              backgroundColor: palette.hex,
              boxShadow: `0 0 10px rgba(${palette.rgb}, 0.4)`,
            }}
          >
            <div className="h-full bg-black" style={{ width: `${secElapsedPct.toFixed(2)}%` }} />
          </div>

          {/* Bold Solid Seconds (dead center inside symmetric gutters) + High-Contrast Border & Glow + S */}
          <div
            aria-hidden="true"
            className="grid w-full grid-cols-[clamp(18px,6cqi,28px)_minmax(0,1fr)_clamp(18px,6cqi,28px)] items-baseline"
          >
            <span aria-hidden="true" />
            <div
              className="font-timer-pro tabular-digits timer-pro-seconds-contrast mr-[-0.015em] justify-self-center whitespace-nowrap font-bold leading-[0.82] tracking-[0.015em] transition-colors duration-200"
              style={{
                fontSize: `calc(clamp(3.6rem, min(54cqi, 28dvh), 16.5rem) * ${portraitFactor.toFixed(2)})`,
                color: palette.secondsColor,
                ['--pro-seconds-glow' as string]: secondsGlow,
              }}
            >
              {clock.seconds}
            </div>
            <span
              className="justify-self-end text-right text-[clamp(12px,4cqi,16px)] font-bold tracking-[0.12em] transition-colors duration-200"
              style={{ color: palette.hex, textShadow: unitGlow }}
            >
              S
            </span>
          </div>
        </div>
      </div>

      {/* Landscape: Side-by-Side Responsive Versione B */}
      <div
        className="relative z-10 hidden min-h-0 w-full flex-1 flex-col items-center justify-center pl-[max(20px,env(safe-area-inset-left,0px))] pr-[max(20px,env(safe-area-inset-right,0px))] landscape:flex"
        data-testid="pro-landscape-timer-display"
      >
        <div
          role="timer"
          aria-label={ariaLabel}
          className="flex w-full max-w-[min(92vw,960px)] [container-type:inline-size] flex-col items-center gap-[clamp(10px,2.4dvh,20px)] select-none"
        >
          <div
            aria-hidden="true"
            className="flex w-full items-baseline justify-center gap-[clamp(16px,4.5cqi,52px)]"
          >
            <div className="flex items-baseline gap-[clamp(4px,1cqi,10px)]">
              <div
                className="font-timer-pro tabular-digits timer-pro-minutes-hollow mr-[-0.02em] whitespace-nowrap font-bold leading-[0.82] tracking-[0.02em]"
                style={{
                  fontSize:
                    clock.minutes.length >= 3
                      ? `calc(clamp(2.6rem, min(17.5cqi, 40dvh), 15rem) * ${landscapeFactor.toFixed(2)})`
                      : `calc(clamp(3.2rem, min(22cqi, 46dvh), 18rem) * ${landscapeFactor.toFixed(2)})`,
                }}
              >
                {clock.minutes}
              </div>
              <span
                className="min-w-[14px] text-right text-[clamp(12px,2cqi,16px)] font-bold tracking-[0.12em] transition-colors duration-200"
                style={{ color: palette.hex, textShadow: unitGlow }}
              >
                M
              </span>
            </div>

            <div className="flex items-baseline gap-[clamp(4px,1cqi,10px)]">
              <div
                className="font-timer-pro tabular-digits timer-pro-seconds-contrast mr-[-0.015em] whitespace-nowrap font-bold leading-[0.82] tracking-[0.015em] transition-colors duration-200"
                style={{
                  fontSize: `calc(clamp(3.4rem, min(24cqi, 50dvh), 19rem) * ${landscapeFactor.toFixed(2)})`,
                  color: palette.secondsColor,
                  ['--pro-seconds-glow' as string]: secondsGlow,
                }}
              >
                {clock.seconds}
              </div>
              <span
                className="min-w-[14px] text-right text-[clamp(12px,2cqi,16px)] font-bold tracking-[0.12em] transition-colors duration-200"
                style={{ color: palette.hex, textShadow: unitGlow }}
              >
                S
              </span>
            </div>
          </div>

          <div
            aria-hidden="true"
            className="flex h-[3px] w-full max-w-[min(80cqi,680px)] justify-start overflow-hidden rounded-full transition-colors duration-200"
            style={{
              backgroundColor: palette.hex,
              boxShadow: `0 0 10px rgba(${palette.rgb}, 0.4)`,
            }}
          >
            <div className="h-full bg-black" style={{ width: `${secElapsedPct.toFixed(2)}%` }} />
          </div>
        </div>
      </div>
    </>
  );
}
