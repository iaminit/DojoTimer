import { Check } from 'lucide-react';
import { generateUuid, PROGRAM_LIMITS, sanitizeTextInput } from '../../services/storage';
import type { DisciplineMode, WorkoutProgram } from '../../types/timer';
import { calculateTotalDurationSeconds, formatMMSS } from '../../utils/formatTime';
import type { VisualThemeTokens } from '../../utils/themePalette';
import { EditorStepper } from './SetupValueControls';

export interface ProgramDraft {
  id: string | null;
  name: string;
  discipline: DisciplineMode;
  rounds: number;
  workMinutes: number;
  workSeconds: number;
  restMinutes: number;
  restSeconds: number;
  prepSeconds: number;
  warningSeconds: number;
}

const TAB_ORDER: readonly DisciplineMode[] = ['JUDO', 'BJJ'];

export function programToDraft(program: WorkoutProgram): ProgramDraft {
  return {
    id: program.id,
    name: program.name,
    discipline: program.discipline,
    rounds: program.rounds,
    workMinutes: Math.floor(program.workSeconds / 60),
    workSeconds: program.workSeconds % 60,
    restMinutes: Math.floor(program.restSeconds / 60),
    restSeconds: program.restSeconds % 60,
    prepSeconds: program.prepSeconds,
    warningSeconds: program.warningSeconds,
  };
}

export function createEmptyDraft(discipline: DisciplineMode): ProgramDraft {
  return {
    id: null,
    name: discipline === 'BJJ' ? 'Nuovo Allenamento BJJ' : 'Nuovo Allenamento Judo',
    discipline,
    rounds: 6,
    workMinutes: discipline === 'BJJ' ? 4 : 3,
    workSeconds: 0,
    restMinutes: 1,
    restSeconds: 0,
    prepSeconds: 10,
    warningSeconds: 30,
  };
}

function clampField(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function buildProgramFromDraft(
  draft: ProgramDraft,
  existing?: WorkoutProgram | null,
  now = Date.now(),
  idGenerator: () => string = generateUuid,
): WorkoutProgram {
  const name = sanitizeTextInput(draft.name, 80) || 'Programma Senza Nome';
  const rawWorkSeconds = Math.max(0, draft.workMinutes) * 60 + Math.max(0, draft.workSeconds);
  const rawRestSeconds = Math.max(0, draft.restMinutes) * 60 + Math.max(0, draft.restSeconds);

  const workSeconds = clampField(
    rawWorkSeconds,
    PROGRAM_LIMITS.workSeconds.min,
    PROGRAM_LIMITS.workSeconds.max,
  );
  const restSeconds = clampField(
    rawRestSeconds,
    PROGRAM_LIMITS.restSeconds.min,
    PROGRAM_LIMITS.restSeconds.max,
  );
  const rounds = clampField(
    draft.rounds,
    PROGRAM_LIMITS.rounds.min,
    PROGRAM_LIMITS.rounds.max,
  );
  const prepSeconds = clampField(
    draft.prepSeconds,
    PROGRAM_LIMITS.prepSeconds.min,
    PROGRAM_LIMITS.prepSeconds.max,
  );
  const warningSeconds = clampField(
    draft.warningSeconds,
    PROGRAM_LIMITS.warningSeconds.min,
    PROGRAM_LIMITS.warningSeconds.max,
  );

  return {
    id: existing?.id ?? draft.id ?? idGenerator(),
    name,
    discipline: draft.discipline,
    rounds,
    workSeconds,
    restSeconds,
    prepSeconds,
    warningSeconds,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

interface ProgramEditorFormProps {
  draft: ProgramDraft;
  theme: VisualThemeTokens;
  onChangeDraft: (updater: (prev: ProgramDraft) => ProgramDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}

export function ProgramEditorForm({
  draft,
  theme,
  onChangeDraft,
  onCancel,
  onSave,
}: ProgramEditorFormProps) {
  const draftTotalWorkSeconds = Math.max(5, draft.workMinutes * 60 + draft.workSeconds);
  const draftTotalRestSeconds = Math.max(0, draft.restMinutes * 60 + draft.restSeconds);
  const draftTotalSessionSeconds = calculateTotalDurationSeconds({
    rounds: draft.rounds,
    workSeconds: draftTotalWorkSeconds,
    restSeconds: draftTotalRestSeconds,
    prepSeconds: draft.prepSeconds,
  });

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/15 bg-neutral-950 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h3
          className="whitespace-nowrap text-base font-extrabold tracking-wider uppercase"
          style={{ color: theme.hex }}
        >
          {draft.id ? 'Modifica Programma' : 'Nuovo Programma'}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="whitespace-nowrap rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white cursor-pointer"
        >
          Annulla
        </button>
      </div>

      {/* Discipline Selector inside Editor */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-bold tracking-wider text-slate-400 uppercase">
          Disciplina
        </span>
        <div className="grid grid-cols-2 gap-2">
          {TAB_ORDER.map((dKey) => {
            const active = draft.discipline === dKey;
            const accent = dKey === 'JUDO' ? '#FFD600' : '#FF9100';
            return (
              <button
                key={dKey}
                type="button"
                onClick={() => onChangeDraft((prev) => ({ ...prev, discipline: dKey }))}
                aria-pressed={active}
                className={`min-h-[46px] rounded-xl border-2 text-xs font-extrabold tracking-[0.16em] uppercase transition-all cursor-pointer ${
                  active
                    ? 'text-black'
                    : 'border-white/20 bg-neutral-900 text-slate-300 hover:border-white/45'
                }`}
                style={active ? { backgroundColor: accent, borderColor: accent } : undefined}
              >
                {dKey}
              </button>
            );
          })}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold tracking-wider text-slate-400 uppercase">
          Nome Programma
        </span>
        <input
          type="text"
          value={draft.name}
          maxLength={80}
          onChange={(e) => onChangeDraft((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="Es. Randori Gara 5x4m"
          className="min-h-[48px] rounded-xl border border-white/25 bg-neutral-900 px-3.5 text-base font-bold text-white outline-none focus:border-yellow-400"
        />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <EditorStepper
          label="Numero Round (1-99)"
          value={draft.rounds}
          min={1}
          max={99}
          accentHex={theme.hex}
          onChange={(rounds) => onChangeDraft((prev) => ({ ...prev, rounds }))}
        />

        <EditorStepper
          label="Preparazione (sec)"
          value={draft.prepSeconds}
          displayValue={`${draft.prepSeconds}s`}
          min={0}
          max={300}
          step={5}
          accentHex="#FFAB00"
          onChange={(prepSeconds) => onChangeDraft((prev) => ({ ...prev, prepSeconds }))}
        />

        <EditorStepper
          label="Lavoro — Minuti"
          value={draft.workMinutes}
          displayValue={`${draft.workMinutes}m`}
          min={0}
          max={120}
          accentHex={theme.hex}
          onChange={(workMinutes) =>
            onChangeDraft((prev) => ({
              ...prev,
              workMinutes,
              workSeconds: workMinutes >= 120 ? 0 : prev.workSeconds,
            }))
          }
        />

        <EditorStepper
          label="Lavoro — Secondi"
          value={draft.workSeconds}
          displayValue={`${String(draft.workSeconds).padStart(2, '0')}s`}
          min={0}
          max={draft.workMinutes >= 120 ? 0 : 55}
          step={5}
          accentHex={theme.hex}
          onChange={(workSeconds) => onChangeDraft((prev) => ({ ...prev, workSeconds }))}
        />

        <EditorStepper
          label="Pausa — Minuti"
          value={draft.restMinutes}
          displayValue={`${draft.restMinutes}m`}
          min={0}
          max={60}
          accentHex="#00E5FF"
          onChange={(restMinutes) =>
            onChangeDraft((prev) => ({
              ...prev,
              restMinutes,
              restSeconds: restMinutes >= 60 ? 0 : prev.restSeconds,
            }))
          }
        />

        <EditorStepper
          label="Pausa — Secondi"
          value={draft.restSeconds}
          displayValue={`${String(draft.restSeconds).padStart(2, '0')}s`}
          min={0}
          max={draft.restMinutes >= 60 ? 0 : 55}
          step={5}
          accentHex="#00E5FF"
          onChange={(restSeconds) => onChangeDraft((prev) => ({ ...prev, restSeconds }))}
        />

        <div className="sm:col-span-2">
          <EditorStepper
            label="Preavviso al termine"
            value={draft.warningSeconds}
            displayValue={
              draft.warningSeconds === 0 ? 'Disattivato' : formatMMSS(draft.warningSeconds)
            }
            min={0}
            max={120}
            step={5}
            accentHex="#FF5252"
            onChange={(warningSeconds) => onChangeDraft((prev) => ({ ...prev, warningSeconds }))}
          />
        </div>
      </div>

      <div
        className="flex items-center justify-between rounded-xl border px-4 py-3"
        style={{
          borderColor: `rgba(${theme.rgb}, 0.5)`,
          backgroundColor: `rgba(${theme.rgb}, 0.08)`,
        }}
      >
        <div className="flex flex-col">
          <span className="text-[11px] font-bold tracking-wider text-slate-300 uppercase">
            Durata Totale Calcolata
          </span>
          <span className="text-xs text-slate-400">
            {draft.prepSeconds}s prep + {draft.rounds}×{formatMMSS(draftTotalWorkSeconds)}
            {draft.rounds > 1 ? ` + ${draft.rounds - 1}×${formatMMSS(draftTotalRestSeconds)} rec` : ''}
          </span>
        </div>
        <span className="tabular-digits text-2xl font-bold" style={{ color: theme.hex }}>
          {formatMMSS(draftTotalSessionSeconds)}
        </span>
      </div>

      <button
        type="button"
        onClick={onSave}
        className="flex min-h-[54px] w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-extrabold tracking-wider text-black uppercase transition-transform active:scale-98 cursor-pointer"
        style={{ backgroundColor: theme.hex }}
      >
        <Check className="h-5 w-5 shrink-0" />
        <span>Salva Programma</span>
      </button>
    </div>
  );
}
