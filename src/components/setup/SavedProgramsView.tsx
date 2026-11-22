import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { DISCIPLINES } from '../../config/disciplines';
import { useNativeBackHandler } from '../../hooks/useNativeBackHandler';
import {
  exportProgramsJson,
  generateUuid,
  MAX_IMPORT_JSON_BYTES,
  MAX_STORED_PROGRAMS,
  parseImportProgramsJson,
  sanitizeTextInput,
} from '../../services/storage';
import type { DisciplineMode, WorkoutProgram } from '../../types/timer';
import { calculateTotalDurationSeconds, formatMMSS } from '../../utils/formatTime';
import type { VisualThemeTokens } from '../../utils/themePalette';
import {
  buildProgramFromDraft,
  createEmptyDraft,
  ProgramEditorForm,
  programToDraft,
  type ProgramDraft,
} from './ProgramEditorForm';

interface SavedProgramsViewProps {
  discipline: DisciplineMode;
  programs: WorkoutProgram[];
  activeProgramId: string;
  initialEditingProgram?: WorkoutProgram | null;
  theme: VisualThemeTokens;
  onClearInitialEditingProgram?: () => void;
  onBackToSettings: () => void;
  onStartProgram: (program: WorkoutProgram) => void;
  onLoadProgram: (program: WorkoutProgram) => void;
  onSavePrograms: (next: WorkoutProgram[]) => void;
  onRestoreDefaults: () => void;
}

const TAB_ORDER: readonly DisciplineMode[] = ['JUDO', 'BJJ'];

export function SavedProgramsView({
  discipline,
  programs,
  activeProgramId,
  initialEditingProgram = null,
  theme,
  onClearInitialEditingProgram,
  onBackToSettings,
  onStartProgram,
  onLoadProgram,
  onSavePrograms,
  onRestoreDefaults,
}: SavedProgramsViewProps) {
  const [selectedTab, setSelectedTab] = useState<DisciplineMode>(
    () => initialEditingProgram?.discipline ?? discipline,
  );
  const [editingDraft, setEditingDraft] = useState<ProgramDraft | null>(() =>
    initialEditingProgram ? programToDraft(initialEditingProgram) : null,
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'ok' | 'error';
    text: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSelectedTab(discipline);
  }, [discipline]);

  useEffect(() => {
    if (!initialEditingProgram) return;
    setSelectedTab(initialEditingProgram.discipline);
    setEditingDraft(programToDraft(initialEditingProgram));
    setStatusMessage(null);
  }, [initialEditingProgram]);

  useNativeBackHandler(
    true,
    () => {
      if (editingDraft !== null) {
        setEditingDraft(null);
        onClearInitialEditingProgram?.();
        return true;
      }
      if (confirmDeleteId !== null) {
        setConfirmDeleteId(null);
        return true;
      }
      if (renamingId !== null) {
        setRenamingId(null);
        return true;
      }
      onClearInitialEditingProgram?.();
      onBackToSettings();
      return true;
    },
    50,
  );

  const judoCount = programs.filter((p) => p.discipline === 'JUDO').length;
  const bjjCount = programs.filter((p) => p.discipline === 'BJJ').length;
  const visiblePrograms = programs.filter((p) => p.discipline === selectedTab);

  const handleSaveDraft = () => {
    if (!editingDraft) return;
    const now = Date.now();
    const existing = editingDraft.id
      ? programs.find((p) => p.id === editingDraft.id) ?? null
      : null;
    const built = buildProgramFromDraft(editingDraft, existing, now, generateUuid);

    if (editingDraft.id && existing) {
      const updated = programs.map((p) => (p.id === editingDraft.id ? built : p));
      onSavePrograms(updated);
      setSelectedTab(built.discipline);
      setStatusMessage({ type: 'ok', text: `Programma "${built.name}" aggiornato.` });
    } else {
      if (programs.length >= MAX_STORED_PROGRAMS) {
        setStatusMessage({
          type: 'error',
          text: `Limite massimo raggiunto (${MAX_STORED_PROGRAMS} programmi). Elimina un programma prima di crearne uno nuovo.`,
        });
        return;
      }
      onSavePrograms([built, ...programs]);
      setSelectedTab(built.discipline);
      setStatusMessage({ type: 'ok', text: `Programma "${built.name}" creato.` });
    }

    setEditingDraft(null);
    onClearInitialEditingProgram?.();
  };

  const handleCommitRename = (program: WorkoutProgram) => {
    const clean = sanitizeTextInput(renameValue, 80);
    if (!clean) {
      setRenamingId(null);
      return;
    }
    const updated = programs.map((p) =>
      p.id === program.id ? { ...p, name: clean, updatedAt: Date.now() } : p,
    );
    onSavePrograms(updated);
    setRenamingId(null);
    setStatusMessage({ type: 'ok', text: `Rinominato in "${clean}".` });
  };

  const handleDuplicate = (program: WorkoutProgram) => {
    if (programs.length >= MAX_STORED_PROGRAMS) {
      setStatusMessage({
        type: 'error',
        text: `Limite massimo raggiunto (${MAX_STORED_PROGRAMS} programmi). Elimina un programma prima di duplicarne uno.`,
      });
      return;
    }
    const now = Date.now();
    const copy: WorkoutProgram = {
      ...program,
      id: generateUuid(),
      name: `${program.name} (Copia)`.slice(0, 80),
      createdAt: now,
      updatedAt: now,
    };
    const idx = programs.findIndex((p) => p.id === program.id);
    const next = [...programs];
    next.splice(idx + 1, 0, copy);
    onSavePrograms(next);
    setStatusMessage({ type: 'ok', text: `Creata copia "${copy.name}".` });
  };

  const handleDelete = (id: string) => {
    const remaining = programs.filter((p) => p.id !== id);
    onSavePrograms(remaining);
    setConfirmDeleteId(null);
    setStatusMessage({ type: 'ok', text: 'Programma eliminato.' });
  };

  const handleExportJson = () => {
    const json = exportProgramsJson(programs);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dojo-timer-programs-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Defer revokeObjectURL so Safari / mobile WebView finish starting the async download
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatusMessage({ type: 'ok', text: `Esportati ${programs.length} programmi in JSON.` });
  };

  const handleImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > MAX_IMPORT_JSON_BYTES) {
      setStatusMessage({
        type: 'error',
        text: 'File troppo grande: dimensione massima consentita 512 KB.',
      });
      return;
    }

    try {
      const text = await file.text();
      const result = parseImportProgramsJson(text, programs);
      if (!result.ok) {
        setStatusMessage({ type: 'error', text: result.error });
        return;
      }
      onSavePrograms(result.programs);
      setStatusMessage({
        type: 'ok',
        text: `Importati ${result.importedCount} programmi${
          result.skippedCount > 0 ? ` (${result.skippedCount} scartati)` : ''
        }.`,
      });
    } catch {
      setStatusMessage({ type: 'error', text: 'Impossibile leggere il file selezionato.' });
    }
  };

  return (
    <div className="dojo-scroll relative z-10 min-h-0 flex-1 overflow-y-auto pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))] sm:px-6 sm:py-6">
      <section
        className="mx-auto flex w-full max-w-4xl flex-col gap-4 pb-6"
        aria-label="Programmi Salvati"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              setEditingDraft(null);
              onBackToSettings();
            }}
            className="flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-xl border border-white/20 bg-neutral-950 px-3.5 text-xs font-extrabold tracking-wider text-white uppercase hover:border-white/50 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span>
              Torna<span className="hidden sm:inline"> ai Settaggi</span>
            </span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setEditingDraft(createEmptyDraft(selectedTab));
                setStatusMessage(null);
              }}
              className="flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 text-xs font-extrabold tracking-wider text-black uppercase active:scale-95 cursor-pointer"
              style={{ backgroundColor: theme.hex }}
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span>Nuovo {selectedTab}</span>
            </button>

            <button
              type="button"
              onClick={handleExportJson}
              className="flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-xl border border-white/20 bg-neutral-900 px-3 text-xs font-bold tracking-wider text-white uppercase hover:border-white/45 cursor-pointer"
            >
              <Download className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">Esporta</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-xl border border-white/20 bg-neutral-900 px-3 text-xs font-bold tracking-wider text-white uppercase hover:border-white/45 cursor-pointer"
            >
              <Upload className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">Importa</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImportFile}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => {
                onRestoreDefaults();
                setStatusMessage({
                  type: 'ok',
                  text: 'Preset Judo e BJJ predefiniti ripristinati.',
                });
              }}
              className="flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-xl border border-white/15 bg-neutral-950 px-3 text-xs font-semibold tracking-wider text-slate-300 uppercase hover:text-white cursor-pointer"
              title="Ripristina i preset predefiniti Judo e BJJ"
            >
              <RotateCcw className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Default</span>
            </button>
          </div>
        </div>

        {/* Discipline Category Tabs: JUDO (N) | BJJ (M) */}
        <div
          className="grid grid-cols-2 gap-2"
          role="tablist"
          aria-label="Filtra programmi per disciplina"
        >
          {TAB_ORDER.map((tabKey) => {
            const cfg = DISCIPLINES[tabKey];
            const active = selectedTab === tabKey;
            const count = tabKey === 'JUDO' ? judoCount : bjjCount;
            const accent = tabKey === 'JUDO' ? '#FFD600' : '#FF9100';

            return (
              <button
                key={tabKey}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setSelectedTab(tabKey);
                  setEditingDraft(null);
                  setRenamingId(null);
                  setConfirmDeleteId(null);
                }}
                className={`flex min-h-[48px] items-center justify-center gap-2 whitespace-nowrap rounded-xl border-2 px-3 text-xs font-extrabold tracking-[0.1em] uppercase transition-all cursor-pointer sm:text-sm ${
                  active
                    ? 'text-black shadow-md'
                    : 'border-white/15 bg-neutral-950 text-slate-300 hover:border-white/40 hover:text-white'
                }`}
                style={
                  active
                    ? {
                        backgroundColor: accent,
                        borderColor: accent,
                      }
                    : undefined
                }
              >
                {cfg.logoShape === 'rounded-card' ? (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white p-0.5">
                    <img src={cfg.logoSrc} alt="" className="h-full w-full object-contain" />
                  </span>
                ) : (
                  <span className="h-6 w-6 shrink-0 overflow-hidden rounded-full">
                    <img src={cfg.logoSrc} alt="" className="h-full w-full object-cover" />
                  </span>
                )}
                <span className="whitespace-nowrap">
                  {cfg.title} ({count})
                </span>
              </button>
            );
          })}
        </div>

        {/* Feedback Message */}
        {statusMessage && (
          <div
            className={`flex items-center justify-between rounded-xl border px-3.5 py-2 text-xs font-semibold ${
              statusMessage.type === 'ok'
                ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                : 'border-red-400/50 bg-red-500/15 text-red-200'
            }`}
          >
            <span>{statusMessage.text}</span>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="ml-2 p-1 hover:opacity-75 cursor-pointer"
              aria-label="Chiudi messaggio"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Program Editor Form OR Filtered Cards */}
        {editingDraft ? (
          <ProgramEditorForm
            draft={editingDraft}
            theme={theme}
            onChangeDraft={(updater) =>
              setEditingDraft((prev) => (prev ? updater(prev) : null))
            }
            onCancel={() => {
              setEditingDraft(null);
              onClearInitialEditingProgram?.();
            }}
            onSave={handleSaveDraft}
          />
        ) : visiblePrograms.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/20 bg-neutral-950/70 p-8 text-center">
            <p className="text-sm text-slate-300">
              Nessun programma salvato nella sezione {selectedTab}.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => setEditingDraft(createEmptyDraft(selectedTab))}
                className="min-h-[48px] rounded-xl px-5 text-xs font-bold tracking-wider text-black uppercase cursor-pointer"
                style={{ backgroundColor: theme.hex }}
              >
                Crea Programma {selectedTab}
              </button>
              <button
                type="button"
                onClick={onRestoreDefaults}
                className="min-h-[48px] rounded-xl border border-white/25 bg-neutral-900 px-5 text-xs font-bold tracking-wider text-white uppercase cursor-pointer"
              >
                Ripristina Default
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {visiblePrograms.map((prog) => {
              const isActive = prog.id === activeProgramId;
              const totalSec = calculateTotalDurationSeconds(prog);
              const isRenaming = renamingId === prog.id;

              return (
                <div
                  key={prog.id}
                  className="flex flex-col justify-between gap-3 rounded-2xl border-2 bg-neutral-950/95 p-4 transition-colors"
                  style={{
                    borderColor: isActive ? theme.hex : 'rgba(255,255,255,0.14)',
                    boxShadow: isActive ? `0 0 18px rgba(${theme.rgb}, 0.16)` : undefined,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    {isRenaming ? (
                      <div className="flex flex-1 items-center gap-2">
                        <input
                          type="text"
                          value={renameValue}
                          maxLength={80}
                          autoFocus
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCommitRename(prog);
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                          className="min-h-[44px] flex-1 rounded-lg border border-yellow-400 bg-neutral-900 px-3 text-sm font-bold text-white outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleCommitRename(prog)}
                          className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-500 text-black cursor-pointer"
                          aria-label="Conferma rinomina"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingId(null)}
                          className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/20 text-slate-300 cursor-pointer"
                          aria-label="Annulla rinomina"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-1 flex-col items-start text-left">
                          <span className="text-base font-bold text-white sm:text-lg">
                            {prog.name}
                          </span>
                          <div className="tabular-digits mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-300">
                            <span>
                              <strong style={{ color: theme.hex }}>{prog.rounds}</strong> Round
                            </span>
                            <span>
                              Lavoro <strong>{formatMMSS(prog.workSeconds)}</strong>
                            </span>
                            <span>
                              Riposo{' '}
                              <strong style={{ color: '#00E5FF' }}>
                                {formatMMSS(prog.restSeconds)}
                              </strong>
                            </span>
                            <span>
                              Prep <strong>{prog.prepSeconds}s</strong>
                            </span>
                            <span>
                              Preavv{' '}
                              <strong>
                                {prog.warningSeconds === 0 ? 'OFF' : `${prog.warningSeconds}s`}
                              </strong>
                            </span>
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-col items-end">
                          <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                            Totale
                          </span>
                          <span
                            className="tabular-digits text-sm font-bold"
                            style={{ color: theme.hex }}
                          >
                            {formatMMSS(totalSec)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {!isRenaming && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onStartProgram(prog)}
                          className="flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-xl px-4 text-xs font-extrabold tracking-wider text-black uppercase transition-transform active:scale-95 cursor-pointer"
                          style={{ backgroundColor: theme.hex }}
                        >
                          <Play className="h-4 w-4 shrink-0 fill-current" />
                          <span>AVVIA</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onLoadProgram(prog)}
                          className="flex min-h-[44px] items-center whitespace-nowrap rounded-xl border border-white/20 bg-black px-3 text-xs font-bold tracking-wider text-white uppercase hover:border-white/45 cursor-pointer"
                          title="Carica i parametri nei 5 settaggi principali"
                        >
                          Carica
                        </button>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(prog.id);
                            setRenameValue(prog.name);
                          }}
                          className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 bg-black text-slate-200 hover:border-white/40 cursor-pointer"
                          aria-label={`Rinomina ${prog.name}`}
                          title="Rinomina rapida"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingDraft(programToDraft(prog))}
                          className="flex h-10 items-center whitespace-nowrap rounded-lg border border-white/15 bg-black px-2.5 text-xs font-semibold text-slate-200 hover:border-white/40 cursor-pointer"
                          title="Modifica parametri"
                        >
                          Modifica
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDuplicate(prog)}
                          className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 bg-black text-slate-200 hover:border-white/40 cursor-pointer"
                          aria-label={`Duplica ${prog.name}`}
                          title="Duplica programma"
                        >
                          <Copy className="h-4 w-4" />
                        </button>

                        {confirmDeleteId === prog.id ? (
                          <button
                            type="button"
                            onClick={() => handleDelete(prog.id)}
                            className="flex h-10 items-center whitespace-nowrap rounded-lg bg-red-600 px-2.5 text-xs font-bold text-white cursor-pointer"
                          >
                            Conferma
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(prog.id)}
                            className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/25 cursor-pointer"
                            aria-label={`Elimina ${prog.name}`}
                            title="Elimina programma"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
