import { useEffect, useState } from 'react';
import { ArrowLeft, Menu } from 'lucide-react';
import { DISCIPLINES } from '../config/disciplines';
import { useCurrentClock } from '../hooks/useCurrentClock';
import { generateUuid, PROGRAM_LIMITS } from '../services/storage';
import { RoundDurationWheelModal } from './RoundDurationWheelModal';
import { SavedProgramsView } from './setup/SavedProgramsView';
import { SetupOptionsModal } from './setup/SetupOptionsModal';
import { RoundStepperButton, ScrubbableValueControl } from './setup/SetupValueControls';
import type {
  AudioMode,
  DisciplineMode,
  QuickSetupConfig,
  TimerLayoutMode,
  VoiceProfile,
  WorkoutProgram,
} from '../types/timer';
import { formatMMSS } from '../utils/formatTime';
import type { VisualThemeTokens } from '../utils/themePalette';
import { isHotspotDuration, type WheelKind } from '../utils/wheelMath';

const REST_ACCENT_HEX = '#00E5FF';
const REST_ACCENT_RGB = '0, 229, 255';

interface SetupScreenProps {
  discipline: DisciplineMode;
  setupConfig: QuickSetupConfig;
  onChangeSetupConfig: (next: QuickSetupConfig) => void;
  audioMode: AudioMode;
  onChangeAudioMode: (mode: AudioMode) => void;
  voiceProfile: VoiceProfile;
  onChangeVoiceProfile: (profile: VoiceProfile) => void;
  timerLayout: TimerLayoutMode;
  onChangeTimerLayout: (layout: TimerLayoutMode) => void;
  eventHapticsEnabled: boolean;
  onChangeEventHapticsEnabled: (enabled: boolean) => void;
  programs: WorkoutProgram[];
  activeProgramId: string;
  initialEditProgram?: WorkoutProgram | null;
  onClearInitialEditProgram?: () => void;
  theme: VisualThemeTokens;
  onBackToLanding: () => void;
  onOpenColorSettings: () => void;
  onStartQuickPreset: (minutes: number) => void;
  onStartProgram: (program: WorkoutProgram) => void;
  onLoadProgram: (program: WorkoutProgram) => void;
  onSavePrograms: (next: WorkoutProgram[]) => void;
  onRestoreDefaults: () => void;
}

type SetupView = 'SETTINGS' | 'PROGRAMS';

export function SetupScreen({
  discipline,
  setupConfig,
  onChangeSetupConfig,
  audioMode,
  onChangeAudioMode,
  voiceProfile,
  onChangeVoiceProfile,
  timerLayout,
  onChangeTimerLayout,
  eventHapticsEnabled,
  onChangeEventHapticsEnabled,
  programs,
  activeProgramId,
  initialEditProgram = null,
  onClearInitialEditProgram,
  theme,
  onBackToLanding,
  onOpenColorSettings,
  onStartQuickPreset,
  onStartProgram,
  onLoadProgram,
  onSavePrograms,
  onRestoreDefaults,
}: SetupScreenProps) {
  const currentTime = useCurrentClock();
  const [view, setView] = useState<SetupView>(() => (initialEditProgram ? 'PROGRAMS' : 'SETTINGS'));
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [wheelMode, setWheelMode] = useState<WheelKind | null>(null);

  useEffect(() => {
    if (initialEditProgram) {
      setView('PROGRAMS');
    }
  }, [initialEditProgram]);

  const activeCfg = DISCIPLINES[discipline];
  const judoCount = programs.filter((p) => p.discipline === 'JUDO').length;
  const bjjCount = programs.filter((p) => p.discipline === 'BJJ').length;

  const defaultProgramName = `${discipline} ${setupConfig.rounds}×${formatMMSS(setupConfig.workSeconds)}`;

  const handleStartConfiguredTimer = () => {
    const now = Date.now();
    const adhocProgram: WorkoutProgram = {
      id: `custom-${now}`,
      name: defaultProgramName,
      discipline,
      rounds: setupConfig.rounds,
      workSeconds: setupConfig.workSeconds,
      restSeconds: setupConfig.restSeconds,
      prepSeconds: setupConfig.prepSeconds,
      warningSeconds: setupConfig.warningSeconds,
      createdAt: now,
      updatedAt: now,
    };
    onStartProgram(adhocProgram);
  };

  const handleSaveCurrentAsProgram = (customName: string): string => {
    const now = Date.now();
    const name = (customName.trim() || defaultProgramName).slice(0, 80);
    const created: WorkoutProgram = {
      id: generateUuid(),
      name,
      discipline,
      rounds: setupConfig.rounds,
      workSeconds: setupConfig.workSeconds,
      restSeconds: setupConfig.restSeconds,
      prepSeconds: setupConfig.prepSeconds,
      warningSeconds: setupConfig.warningSeconds,
      createdAt: now,
      updatedAt: now,
    };
    onSavePrograms([created, ...programs]);
    return name;
  };

  const handleLoadProgramIntoSetup = (prog: WorkoutProgram) => {
    onLoadProgram(prog);
    setView('SETTINGS');
  };

  const warningSubtitle =
    setupConfig.warningSeconds === 0
      ? 'Preavviso fine (OFF)'
      : setupConfig.warningSeconds >= setupConfig.workSeconds
        ? 'Preavviso fine (> round)'
        : 'Preavviso al termine';

  const workStepDown = setupConfig.workSeconds <= 15 ? 5 : 15;
  const workStepUp = setupConfig.workSeconds < 15 ? 5 : 15;
  const restStepDown = setupConfig.restSeconds <= 60 ? 5 : 15;
  const restStepUp = setupConfig.restSeconds < 60 ? 5 : 15;

  return (
    <main className="relative flex h-[100dvh] w-screen flex-col overflow-hidden bg-black text-white">
      {/* Slim Top Header Bar */}
      <header className="relative z-20 shrink-0 border-b border-white/12 bg-black pt-[calc(env(safe-area-inset-top,0px)+0.5rem)] pb-2.5 pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] sm:px-6 [@media(orientation:landscape)_and_(max-height:520px)]:pt-[calc(env(safe-area-inset-top,0px)+0.35rem)] [@media(orientation:landscape)_and_(max-height:520px)]:pb-1.5">
        <div className="mx-auto grid max-w-2xl grid-cols-[1fr_auto_1fr] items-center gap-2">
          {/* Left: Live Clock + Discipline Pill */}
          <div className="flex items-center gap-2 justify-self-start">
            <span
              className="font-timer tabular-digits hidden whitespace-nowrap text-sm font-bold tracking-wider text-white/90 xs:inline sm:inline"
              aria-label={`Ora attuale ${currentTime}`}
            >
              {currentTime}
            </span>
            <button
              type="button"
              onClick={
                view === 'PROGRAMS'
                  ? () => {
                      onClearInitialEditProgram?.();
                      setView('SETTINGS');
                    }
                  : onBackToLanding
              }
              className="flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-full border border-white/25 bg-neutral-950 px-2.5 py-1 text-xs font-extrabold tracking-wider text-white uppercase transition-colors hover:border-white/50 hover:bg-neutral-900 cursor-pointer"
              title={
                view === 'PROGRAMS'
                  ? 'Torna ai Settaggi'
                  : 'Torna alla scelta logo Judo / BJJ'
              }
            >
              <ArrowLeft className="h-3.5 w-3.5 text-slate-300" />
              {activeCfg.logoShape === 'rounded-card' ? (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded bg-white p-0.5">
                  <img
                    src={activeCfg.logoSrc}
                    alt={activeCfg.title}
                    className="h-full w-full object-contain"
                  />
                </span>
              ) : (
                <span className="h-5 w-5 shrink-0 overflow-hidden rounded-full">
                  <img
                    src={activeCfg.logoSrc}
                    alt={activeCfg.title}
                    className="h-full w-full object-cover"
                  />
                </span>
              )}
              <span>{discipline}</span>
            </button>
          </div>

          {/* Center: Condensed Bold Italic Brand Title */}
          <div className="justify-self-center whitespace-nowrap text-center leading-none">
            <span className="whitespace-nowrap text-lg font-extrabold italic tracking-tight uppercase sm:text-2xl">
              <span className="text-white">DOJO</span>
              <span style={{ color: theme.hex }}>TIMER</span>
            </span>
          </div>

          {/* Right: Live Clock (mobile-only fallback) + Hamburger Menu Button */}
          <div className="flex items-center gap-2 justify-self-end">
            <span className="font-timer tabular-digits whitespace-nowrap text-xs font-bold tracking-wider text-white/85 sm:hidden">
              {currentTime}
            </span>
            <button
              type="button"
              onClick={() => setIsMenuOpen(true)}
              aria-label="Apri menu opzioni"
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 bg-neutral-950 text-white transition-colors hover:border-white/50 hover:bg-neutral-900 cursor-pointer"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* VIEW 1: SINGLE-PAGE 5-ROW SETTINGS SCREEN (scrollable in compact landscape) */}
      {view === 'SETTINGS' ? (
        <section className="flex min-h-0 flex-1 flex-col" aria-label="Settaggi Timer">
          <div className="dojo-scroll min-h-0 flex-1 overflow-y-auto pt-1 pb-2 pl-[max(1.25rem,env(safe-area-inset-left,0px))] pr-[max(1.25rem,env(safe-area-inset-right,0px))] sm:px-6">
            <div className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-evenly divide-y divide-white/12 [@media(orientation:landscape)_and_(max-height:520px)]:grid [@media(orientation:landscape)_and_(max-height:520px)]:min-h-0 [@media(orientation:landscape)_and_(max-height:520px)]:max-w-4xl [@media(orientation:landscape)_and_(max-height:520px)]:grid-cols-2 [@media(orientation:landscape)_and_(max-height:520px)]:gap-x-6 [@media(orientation:landscape)_and_(max-height:520px)]:divide-y-0">
              {/* Row 1: Durata del Round */}
              <div className="flex items-center justify-between gap-4 py-2 sm:py-3 [@media(orientation:landscape)_and_(max-height:520px)]:border-b [@media(orientation:landscape)_and_(max-height:520px)]:border-white/12 [@media(orientation:landscape)_and_(max-height:520px)]:py-2">
              <ScrubbableValueControl
                value={setupConfig.workSeconds}
                displayValue={formatMMSS(setupConfig.workSeconds)}
                label="Durata del Round"
                min={PROGRAM_LIMITS.workSeconds.min}
                max={PROGRAM_LIMITS.workSeconds.max}
                step={(v, dir) => (dir > 0 ? (v < 15 ? 5 : 15) : v <= 15 ? 5 : 15)}
                pxPerStep={12}
                accentHex={theme.hex}
                accentRgb={theme.rgb}
                wheelIconAccentHex={theme.hex}
                wheelIconAccentRgb={theme.rgb}
                onOpenWheel={() => setWheelMode('WORK')}
                isHotspotValue={(v) => isHotspotDuration(v, 'WORK')}
                onChange={(workSeconds) => onChangeSetupConfig({ ...setupConfig, workSeconds })}
              />
              <div className="flex items-center gap-3 sm:gap-4">
                <RoundStepperButton
                  kind="minus"
                  label="Diminuisci Durata del Round"
                  disabled={setupConfig.workSeconds <= PROGRAM_LIMITS.workSeconds.min}
                  onStep={() =>
                    onChangeSetupConfig({
                      ...setupConfig,
                      workSeconds: Math.max(
                        PROGRAM_LIMITS.workSeconds.min,
                        setupConfig.workSeconds - workStepDown,
                      ),
                    })
                  }
                />
                <RoundStepperButton
                  kind="plus"
                  label="Aumenta Durata del Round"
                  disabled={setupConfig.workSeconds >= PROGRAM_LIMITS.workSeconds.max}
                  onStep={() =>
                    onChangeSetupConfig({
                      ...setupConfig,
                      workSeconds: Math.min(
                        PROGRAM_LIMITS.workSeconds.max,
                        setupConfig.workSeconds + workStepUp,
                      ),
                    })
                  }
                />
              </div>
            </div>

              {/* Row 2: Tempo di Riposo */}
              <div className="flex items-center justify-between gap-4 py-2 sm:py-3 [@media(orientation:landscape)_and_(max-height:520px)]:border-b [@media(orientation:landscape)_and_(max-height:520px)]:border-white/12 [@media(orientation:landscape)_and_(max-height:520px)]:py-2">
              <ScrubbableValueControl
                value={setupConfig.restSeconds}
                displayValue={formatMMSS(setupConfig.restSeconds)}
                label="Tempo di Riposo"
                min={PROGRAM_LIMITS.restSeconds.min}
                max={PROGRAM_LIMITS.restSeconds.max}
                step={(v, dir) => (dir > 0 ? (v < 60 ? 5 : 15) : v <= 60 ? 5 : 15)}
                pxPerStep={12}
                labelColor="#7DEEFF"
                accentHex={REST_ACCENT_HEX}
                accentRgb={REST_ACCENT_RGB}
                wheelIconAccentHex={REST_ACCENT_HEX}
                wheelIconAccentRgb={REST_ACCENT_RGB}
                onOpenWheel={() => setWheelMode('REST')}
                isHotspotValue={(v) => isHotspotDuration(v, 'REST')}
                onChange={(restSeconds) => onChangeSetupConfig({ ...setupConfig, restSeconds })}
              />
              <div className="flex items-center gap-3 sm:gap-4">
                <RoundStepperButton
                  kind="minus"
                  label="Diminuisci Tempo di Riposo"
                  disabled={setupConfig.restSeconds <= PROGRAM_LIMITS.restSeconds.min}
                  accentBorderColor="rgba(0, 229, 255, 0.34)"
                  onStep={() =>
                    onChangeSetupConfig({
                      ...setupConfig,
                      restSeconds: Math.max(
                        PROGRAM_LIMITS.restSeconds.min,
                        setupConfig.restSeconds - restStepDown,
                      ),
                    })
                  }
                />
                <RoundStepperButton
                  kind="plus"
                  label="Aumenta Tempo di Riposo"
                  disabled={setupConfig.restSeconds >= PROGRAM_LIMITS.restSeconds.max}
                  accentBorderColor="rgba(0, 229, 255, 0.34)"
                  onStep={() =>
                    onChangeSetupConfig({
                      ...setupConfig,
                      restSeconds: Math.min(
                        PROGRAM_LIMITS.restSeconds.max,
                        setupConfig.restSeconds + restStepUp,
                      ),
                    })
                  }
                />
              </div>
            </div>

              {/* Row 3: Round */}
              <div className="flex items-center justify-between gap-4 py-2 sm:py-3 [@media(orientation:landscape)_and_(max-height:520px)]:border-b [@media(orientation:landscape)_and_(max-height:520px)]:border-white/12 [@media(orientation:landscape)_and_(max-height:520px)]:py-2">
              <ScrubbableValueControl
                value={setupConfig.rounds}
                displayValue={String(setupConfig.rounds)}
                label="Round"
                min={1}
                max={99}
                step={1}
                pxPerStep={16}
                accentHex={theme.hex}
                accentRgb={theme.rgb}
                isHotspotValue={(v) => v % 5 === 0}
                onChange={(rounds) => onChangeSetupConfig({ ...setupConfig, rounds })}
              />
              <div className="flex items-center gap-3 sm:gap-4">
                <RoundStepperButton
                  kind="minus"
                  label="Diminuisci Round"
                  disabled={setupConfig.rounds <= 1}
                  onStep={() =>
                    onChangeSetupConfig({
                      ...setupConfig,
                      rounds: Math.max(1, setupConfig.rounds - 1),
                    })
                  }
                />
                <RoundStepperButton
                  kind="plus"
                  label="Aumenta Round"
                  disabled={setupConfig.rounds >= 99}
                  onStep={() =>
                    onChangeSetupConfig({
                      ...setupConfig,
                      rounds: Math.min(99, setupConfig.rounds + 1),
                    })
                  }
                />
              </div>
            </div>

              {/* Row 4: Tempo di preparazione */}
              <div className="flex items-center justify-between gap-4 py-2 sm:py-3 [@media(orientation:landscape)_and_(max-height:520px)]:border-b [@media(orientation:landscape)_and_(max-height:520px)]:border-white/12 [@media(orientation:landscape)_and_(max-height:520px)]:py-2">
              <ScrubbableValueControl
                value={setupConfig.prepSeconds}
                displayValue={formatMMSS(setupConfig.prepSeconds)}
                label="Tempo di preparazione"
                min={PROGRAM_LIMITS.prepSeconds.min}
                max={PROGRAM_LIMITS.prepSeconds.max}
                step={5}
                pxPerStep={14}
                accentHex={theme.hex}
                accentRgb={theme.rgb}
                isHotspotValue={(v) => v > 0 && v % 15 === 0}
                onChange={(prepSeconds) => onChangeSetupConfig({ ...setupConfig, prepSeconds })}
              />
              <div className="flex items-center gap-3 sm:gap-4">
                <RoundStepperButton
                  kind="minus"
                  label="Diminuisci Tempo di preparazione"
                  disabled={setupConfig.prepSeconds <= PROGRAM_LIMITS.prepSeconds.min}
                  onStep={() =>
                    onChangeSetupConfig({
                      ...setupConfig,
                      prepSeconds: Math.max(
                        PROGRAM_LIMITS.prepSeconds.min,
                        setupConfig.prepSeconds - 5,
                      ),
                    })
                  }
                />
                <RoundStepperButton
                  kind="plus"
                  label="Aumenta Tempo di preparazione"
                  disabled={setupConfig.prepSeconds >= PROGRAM_LIMITS.prepSeconds.max}
                  onStep={() =>
                    onChangeSetupConfig({
                      ...setupConfig,
                      prepSeconds: Math.min(
                        PROGRAM_LIMITS.prepSeconds.max,
                        setupConfig.prepSeconds + 5,
                      ),
                    })
                  }
                />
              </div>
            </div>

              {/* Row 5: Preavviso al termine (default 00:30, modificabile) */}
              <div className="flex items-center justify-between gap-4 py-2 sm:py-3 [@media(orientation:landscape)_and_(max-height:520px)]:col-span-2 [@media(orientation:landscape)_and_(max-height:520px)]:py-2">
              <ScrubbableValueControl
                value={setupConfig.warningSeconds}
                displayValue={formatMMSS(setupConfig.warningSeconds)}
                label={warningSubtitle}
                min={PROGRAM_LIMITS.warningSeconds.min}
                max={PROGRAM_LIMITS.warningSeconds.max}
                step={5}
                pxPerStep={14}
                textColor={setupConfig.warningSeconds === 0 ? '#94A3B8' : '#FFFFFF'}
                accentHex={theme.hex}
                accentRgb={theme.rgb}
                isHotspotValue={(v) => v > 0 && v % 15 === 0}
                onChange={(warningSeconds) =>
                  onChangeSetupConfig({ ...setupConfig, warningSeconds })
                }
              />
              <div className="flex items-center gap-3 sm:gap-4">
                <RoundStepperButton
                  kind="minus"
                  label="Diminuisci Preavviso al termine"
                  disabled={setupConfig.warningSeconds <= PROGRAM_LIMITS.warningSeconds.min}
                  onStep={() =>
                    onChangeSetupConfig({
                      ...setupConfig,
                      warningSeconds: Math.max(
                        PROGRAM_LIMITS.warningSeconds.min,
                        setupConfig.warningSeconds - 5,
                      ),
                    })
                  }
                />
                <RoundStepperButton
                  kind="plus"
                  label="Aumenta Preavviso al termine"
                  disabled={setupConfig.warningSeconds >= PROGRAM_LIMITS.warningSeconds.max}
                  onStep={() =>
                    onChangeSetupConfig({
                      ...setupConfig,
                      warningSeconds: Math.min(
                        PROGRAM_LIMITS.warningSeconds.max,
                        setupConfig.warningSeconds + 5,
                      ),
                    })
                  }
                />
              </div>
            </div>
          </div>
          </div>

          {/* Bottom Full-Width Pill Start Button (pinned cleanly in all orientations) */}
          <div className="shrink-0 border-t border-white/10 bg-black/95 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pl-[max(1.25rem,env(safe-area-inset-left,0px))] pr-[max(1.25rem,env(safe-area-inset-right,0px))] sm:px-6 [@media(orientation:landscape)_and_(max-height:520px)]:pt-1.5 [@media(orientation:landscape)_and_(max-height:520px)]:pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)]">
            <button
              type="button"
              onClick={handleStartConfiguredTimer}
              className="mx-auto flex min-h-[58px] w-full max-w-xl items-center justify-center rounded-full border-2 bg-black text-lg font-extrabold tracking-[0.18em] text-white uppercase transition-all hover:bg-white/5 active:scale-[0.98] sm:min-h-[64px] [@media(orientation:landscape)_and_(max-height:520px)]:min-h-[46px] [@media(orientation:landscape)_and_(max-height:520px)]:max-w-4xl [@media(orientation:landscape)_and_(max-height:520px)]:text-base cursor-pointer"
              style={{
                borderColor: theme.hex,
                boxShadow: `0 0 22px rgba(${theme.rgb}, 0.25)`,
              }}
            >
              INIZIA
            </button>
          </div>
        </section>
      ) : (
        /* VIEW 2: SAVED PROGRAMS MANAGER (JUDO | BJJ) */
        <SavedProgramsView
          discipline={discipline}
          programs={programs}
          activeProgramId={activeProgramId}
          initialEditingProgram={initialEditProgram}
          onClearInitialEditingProgram={onClearInitialEditProgram}
          theme={theme}
          onBackToSettings={() => {
            onClearInitialEditProgram?.();
            setView('SETTINGS');
          }}
          onStartProgram={onStartProgram}
          onLoadProgram={handleLoadProgramIntoSetup}
          onSavePrograms={onSavePrograms}
          onRestoreDefaults={onRestoreDefaults}
        />
      )}

      {/* FULL-SCREEN OPTIONS & PRESETS VIEW (≡ button) */}
      <SetupOptionsModal
        isOpen={isMenuOpen}
        discipline={discipline}
        audioMode={audioMode}
        voiceProfile={voiceProfile}
        timerLayout={timerLayout}
        theme={theme}
        eventHapticsEnabled={eventHapticsEnabled}
        defaultProgramName={defaultProgramName}
        judoCount={judoCount}
        bjjCount={bjjCount}
        onClose={() => setIsMenuOpen(false)}
        onChangeAudioMode={onChangeAudioMode}
        onChangeVoiceProfile={onChangeVoiceProfile}
        onChangeTimerLayout={onChangeTimerLayout}
        onChangeEventHapticsEnabled={onChangeEventHapticsEnabled}
        onOpenColorSettings={() => {
          setIsMenuOpen(false);
          onOpenColorSettings();
        }}
        onSaveCurrentAsProgram={handleSaveCurrentAsProgram}
        onOpenSavedPrograms={() => {
          setIsMenuOpen(false);
          setView('PROGRAMS');
        }}
        onStartQuickPreset={(mins) => {
          setIsMenuOpen(false);
          onStartQuickPreset(mins);
        }}
      />

      {/* INTERACTIVE ROTARY WHEEL SLIDER FOR WORK / REST */}
      <RoundDurationWheelModal
        isOpen={wheelMode !== null}
        mode={wheelMode ?? 'WORK'}
        title={wheelMode === 'REST' ? 'Tempo di Riposo' : 'Durata del Round'}
        initialSeconds={
          wheelMode === 'REST' ? setupConfig.restSeconds : setupConfig.workSeconds
        }
        accentHex={wheelMode === 'REST' ? REST_ACCENT_HEX : theme.hex}
        accentRgb={wheelMode === 'REST' ? REST_ACCENT_RGB : theme.rgb}
        onClose={() => setWheelMode(null)}
        onConfirm={(nextSeconds) =>
          onChangeSetupConfig(
            wheelMode === 'REST'
              ? { ...setupConfig, restSeconds: nextSeconds }
              : { ...setupConfig, workSeconds: nextSeconds },
          )
        }
      />
    </main>
  );
}
