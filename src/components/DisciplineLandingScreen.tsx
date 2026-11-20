import { ChevronRight, Pencil, Play } from 'lucide-react';
import { DISCIPLINES } from '../config/disciplines';
import type { DisciplineMode, WorkoutProgram } from '../types/timer';
import { calculateTotalDurationSeconds, formatMMSS } from '../utils/formatTime';

interface DisciplineLandingScreenProps {
  judoProgram: WorkoutProgram;
  bjjProgram: WorkoutProgram;
  onSelectDiscipline: (mode: DisciplineMode) => void;
  onStartProgram: (program: WorkoutProgram) => void;
  onEditProgram: (program: WorkoutProgram) => void;
}

const ORDERED_DISCIPLINES: readonly DisciplineMode[] = ['JUDO', 'BJJ'];

export function DisciplineLandingScreen({
  judoProgram,
  bjjProgram,
  onSelectDiscipline,
  onStartProgram,
  onEditProgram,
}: DisciplineLandingScreenProps) {
  const programByDiscipline: Record<DisciplineMode, WorkoutProgram> = {
    JUDO: judoProgram,
    BJJ: bjjProgram,
  };

  return (
    <main className="relative flex h-[100dvh] w-screen flex-col overflow-hidden bg-black pt-[calc(env(safe-area-inset-top,0px)+1rem)] pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] text-white sm:px-8 sm:py-8 [@media(orientation:landscape)_and_(max-height:520px)]:pt-[calc(env(safe-area-inset-top,0px)+0.5rem)] [@media(orientation:landscape)_and_(max-height:520px)]:pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)]">
      {/* Subtle tactical grid background */}
      <div
        className="tactical-grid pointer-events-none fixed inset-x-0 bottom-0 z-0 h-[48dvh]"
        aria-hidden="true"
      />

      {/* Top Title */}
      <header className="relative z-10 flex shrink-0 flex-col items-center pb-3 text-center sm:pb-6 [@media(orientation:landscape)_and_(max-height:520px)]:pb-1.5">
        <span className="whitespace-nowrap text-[11px] font-bold tracking-[0.22em] text-yellow-400 uppercase sm:text-xs [@media(orientation:landscape)_and_(max-height:520px)]:text-[10px]">
          TATAMI INTERVAL SYSTEM
        </span>
        <h1 className="whitespace-nowrap mt-1 text-3xl font-extrabold tracking-[0.12em] text-white uppercase sm:text-5xl [@media(orientation:landscape)_and_(max-height:520px)]:mt-0.5 [@media(orientation:landscape)_and_(max-height:520px)]:text-2xl">
          DOJO TIMER
        </h1>
      </header>

      {/* Center Discipline Cards with Logo -> Settings & Base Program -> Avvia / Modifica */}
      <div className="dojo-scroll relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
        <section
          className="my-auto mx-auto grid w-full max-w-4xl grid-cols-1 gap-4 landscape:grid-cols-2 sm:grid-cols-2 sm:gap-6 [@media(orientation:landscape)_and_(max-height:520px)]:gap-3"
          aria-label="Scelta Disciplina"
        >
          {ORDERED_DISCIPLINES.map((key) => {
            const item = DISCIPLINES[key];
            const baseProgram = programByDiscipline[key];
            const totalDurationSec = calculateTotalDurationSeconds(baseProgram);
            const isJudo = key === 'JUDO';
            const accentHex = isJudo ? '#FFD600' : '#FF9100';
            const accentRgb = isJudo ? '255, 214, 0' : '255, 145, 0';

            return (
              <article
                key={item.id}
                className="flex flex-col justify-between gap-3.5 rounded-3xl border-2 bg-neutral-950/92 p-4 sm:gap-4 sm:p-6 [@media(orientation:landscape)_and_(max-height:520px)]:gap-2.5 [@media(orientation:landscape)_and_(max-height:520px)]:rounded-2xl [@media(orientation:landscape)_and_(max-height:520px)]:p-3"
                style={{
                  borderColor: `rgba(${accentRgb}, 0.55)`,
                  boxShadow: `0 0 36px rgba(${accentRgb}, 0.14)`,
                }}
              >
                {/* Logo + Title Button -> Opens Settings */}
                <button
                  type="button"
                  onClick={() => onSelectDiscipline(item.id)}
                  aria-label={`Apri impostazioni ${item.title}`}
                  className="group flex w-full flex-row items-center gap-4 rounded-2xl text-left transition-transform active:scale-[0.985] sm:flex-col sm:justify-center sm:gap-4 sm:text-center [@media(orientation:landscape)_and_(max-height:520px)]:flex-row [@media(orientation:landscape)_and_(max-height:520px)]:justify-start [@media(orientation:landscape)_and_(max-height:520px)]:gap-3 [@media(orientation:landscape)_and_(max-height:520px)]:text-left cursor-pointer"
                >
                  {item.logoShape === 'rounded-card' ? (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white p-1.5 shadow-xl transition-transform group-hover:scale-105 sm:h-32 sm:w-32 sm:rounded-3xl sm:p-2.5 [@media(orientation:landscape)_and_(max-height:520px)]:h-14 [@media(orientation:landscape)_and_(max-height:520px)]:w-14 [@media(orientation:landscape)_and_(max-height:520px)]:rounded-xl [@media(orientation:landscape)_and_(max-height:520px)]:p-1">
                      <img
                        src={item.logoSrc}
                        alt={`Logo ${item.title} — ${item.clubSubtitle}`}
                        className="h-full w-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full shadow-xl transition-transform group-hover:scale-105 sm:h-32 sm:w-32 [@media(orientation:landscape)_and_(max-height:520px)]:h-14 [@media(orientation:landscape)_and_(max-height:520px)]:w-14">
                      <img
                        src={item.logoSrc}
                        alt={`Logo ${item.title} — ${item.clubSubtitle}`}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}

                  <div className="flex min-w-0 flex-1 flex-col sm:flex-none sm:items-center [@media(orientation:landscape)_and_(max-height:520px)]:flex-1 [@media(orientation:landscape)_and_(max-height:520px)]:items-start">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="whitespace-nowrap text-2xl font-extrabold tracking-[0.14em] uppercase sm:text-3xl"
                        style={{ color: accentHex }}
                      >
                        {item.title}
                      </span>
                      <ChevronRight
                        className="h-4 w-4 shrink-0 opacity-75 transition-transform group-hover:translate-x-0.5 sm:hidden"
                        style={{ color: accentHex }}
                      />
                    </div>
                    <span className="truncate mt-0.5 max-w-full text-xs font-semibold tracking-wider text-slate-300 sm:text-sm">
                      {item.clubSubtitle}
                    </span>
                    <span className="mt-1 hidden items-center gap-1 text-[11px] font-bold tracking-[0.1em] text-slate-400 uppercase group-hover:text-white sm:inline-flex">
                      <span>Tocca logo per settaggi</span>
                      <ChevronRight className="h-3.5 w-3.5" style={{ color: accentHex }} />
                    </span>
                  </div>
                </button>

                {/* Embedded Base Program Panel -> Quick AVVIA or MODIFICA */}
                <div className="flex flex-col gap-2.5 border-t border-white/12 pt-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-extrabold tracking-wide text-white sm:text-base">
                      {baseProgram.name}
                    </span>
                    <span
                      className="tabular-digits shrink-0 text-xs font-extrabold tracking-wider sm:text-sm"
                      style={{ color: accentHex }}
                    >
                      {formatMMSS(totalDurationSec)}
                    </span>
                  </div>

                  <p className="tabular-digits truncate text-xs font-semibold text-slate-300">
                    {baseProgram.rounds} Round • {formatMMSS(baseProgram.workSeconds)} • Rec{' '}
                    {formatMMSS(baseProgram.restSeconds)}
                    {baseProgram.prepSeconds > 0 ? ` • Prep ${baseProgram.prepSeconds}s` : ''}
                  </p>

                  <div className="grid grid-cols-2 gap-2.5 [@media(orientation:landscape)_and_(max-height:520px)]:gap-2">
                    <button
                      type="button"
                      onClick={() => onStartProgram(baseProgram)}
                      aria-label={`Avvia ${baseProgram.name}`}
                      className="flex min-h-[46px] items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-xs font-extrabold tracking-[0.12em] text-black uppercase transition-transform active:scale-95 [@media(orientation:landscape)_and_(max-height:520px)]:min-h-[42px] cursor-pointer"
                      style={{ backgroundColor: accentHex }}
                    >
                      <Play className="h-4 w-4 shrink-0 fill-current" />
                      <span>AVVIA</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onEditProgram(baseProgram)}
                      aria-label={`Modifica ${baseProgram.name}`}
                      className="flex min-h-[46px] items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-white/25 bg-black px-3 text-xs font-extrabold tracking-[0.12em] text-white uppercase transition-colors hover:border-white/55 active:scale-95 [@media(orientation:landscape)_and_(max-height:520px)]:min-h-[42px] cursor-pointer"
                    >
                      <Pencil className="h-3.5 w-3.5 shrink-0" />
                      <span>MODIFICA</span>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
