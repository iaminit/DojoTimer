import type { TimerPhase } from '../types/timer';
import { resolveRoundSegments } from '../utils/roundSegments';

interface RoundSegmentsBarProps {
  currentRound: number;
  totalRounds: number;
  phase: TimerPhase;
  controlBg?: string;
}

export function RoundSegmentsBar({
  currentRound,
  totalRounds,
  phase,
  controlBg = '#052e1b',
}: RoundSegmentsBarProps) {
  const model = resolveRoundSegments(currentRound, totalRounds, phase);

  return (
    <div
      className="flex h-[40px] landscape:h-[34px] shrink-0 items-center justify-center gap-[6px] rounded-full px-[10px] transition-colors duration-200"
      style={{
        backgroundColor: controlBg,
        boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.08)',
      }}
      role="progressbar"
      aria-label={`Round ${currentRound} di ${totalRounds}`}
      aria-valuemin={0}
      aria-valuemax={model.totalRounds}
      aria-valuenow={model.completedCount}
    >
      {model.mode === 'discrete' ? (
        model.totalRounds <= 8 ? (
          model.segments.map((status, index) => {
            const widthClass = status === 'active' ? 'w-[24px]' : 'w-[14px]';
            const toneClass =
              status === 'active'
                ? 'bg-white'
                : status === 'completed'
                  ? 'bg-white/75'
                  : 'bg-white/22';

            return (
              <span
                key={index}
                className={`h-[10px] rounded-full transition-all duration-300 ${widthClass} ${toneClass}`}
                style={
                  status === 'active'
                    ? { boxShadow: '0 0 10px rgba(255, 255, 255, 0.7)' }
                    : undefined
                }
              />
            );
          })
        ) : (
          <div className="flex w-[min(48vw,200px)] landscape:w-[240px] items-center gap-[5px]">
            {model.segments.map((status, index) => {
              const flexClass = status === 'active' ? 'flex-[1.7] bg-white' : status === 'completed' ? 'flex-1 bg-white/75' : 'flex-1 bg-white/22';

              return (
                <span
                  key={index}
                  className={`h-[10px] rounded-full transition-all duration-300 ${flexClass}`}
                  style={
                    status === 'active'
                      ? { boxShadow: '0 0 10px rgba(255, 255, 255, 0.7)' }
                      : undefined
                  }
                />
              );
            })}
          </div>
        )
      ) : (
        <div className="h-[10px] w-[136px] landscape:w-[200px] overflow-hidden rounded-full bg-white/22">
          <div
            className="h-full rounded-full bg-white transition-all duration-300"
            style={{
              width: `${(model.progressRatio * 100).toFixed(1)}%`,
              boxShadow: '0 0 10px rgba(255, 255, 255, 0.7)',
            }}
          />
        </div>
      )}
    </div>
  );
}
