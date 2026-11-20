import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DisciplineLandingScreen } from './components/DisciplineLandingScreen';
import { DisplaySettingsModal } from './components/DisplaySettingsModal';
import { MinimalTimerScreen } from './components/MinimalTimerScreen';
import { SetupScreen } from './components/SetupScreen';
import { DISCIPLINES } from './config/disciplines';
import { deriveVisualState, type TimerEngineState } from './engine/timerMachine';
import { useNativeBackHandler } from './hooks/useNativeBackHandler';
import { useTimerEngine } from './hooks/useTimerEngine';
import {
  cancelSoundEventHaptics,
  setSoundEventHapticsEnabled,
  triggerButtonFeedback,
  triggerSoundEventHaptic,
} from './services/haptics';
import {
  clearPersistedSession,
  loadPersistedSession,
  savePersistedSession,
  type RestoredTimerSession,
} from './services/sessionPersistence';
import { soundEngine } from './services/soundEngine';
import { setTimerSessionActive } from './services/swUpdateGuard';
import {
  createDefaultPrograms,
  loadActiveProgramId,
  loadActiveProgramIdForDiscipline,
  loadAudioModeForDiscipline,
  loadDisplaySettingsForDiscipline,
  loadEventHapticsEnabled,
  loadPrograms,
  loadSetupConfig,
  loadVoiceProfile,
  programToSetupConfig,
  resolveEffectiveAudioMode,
  resolveLandingProgramForDiscipline,
  saveActiveProgramId,
  saveActiveProgramIdForDiscipline,
  saveAudioModeForDiscipline,
  saveDisplaySettingsForDiscipline,
  saveEventHapticsEnabled,
  savePrograms,
  saveSetupConfig,
  saveVoiceProfile,
} from './services/storage';
import type {
  AudioMode,
  DisciplineMode,
  DisplaySettings,
  QuickSetupConfig,
  TimerLayoutMode,
  VoiceProfile,
  WorkoutProgram,
} from './types/timer';
import { shouldTriggerTimerSpaceShortcut } from './utils/keyboardShortcuts';
import { resolveVisualTheme } from './utils/themePalette';

type AppScreen = 'LANDING' | 'SETUP' | 'TIMER';

function resolveDisplaySettingsForSelection(
  discipline: DisciplineMode,
  forceBjjScoreboard: boolean,
): DisplaySettings {
  const loaded = loadDisplaySettingsForDiscipline(discipline);
  if (forceBjjScoreboard && discipline === 'BJJ' && loaded.timerLayout !== 'PRO') {
    const forced: DisplaySettings = { ...loaded, timerLayout: 'PRO' };
    saveDisplaySettingsForDiscipline('BJJ', forced);
    return forced;
  }
  return loaded;
}

export function App() {
  const initialRestoredRef = useRef<RestoredTimerSession | null | undefined>(undefined);
  if (initialRestoredRef.current === undefined) {
    initialRestoredRef.current = loadPersistedSession();
  }
  const restoredSession = initialRestoredRef.current;

  const [screen, setScreen] = useState<AppScreen>(() => (restoredSession ? 'TIMER' : 'LANDING'));
  const [selectedDiscipline, setSelectedDiscipline] = useState<DisciplineMode>(() =>
    restoredSession ? restoredSession.discipline : 'JUDO',
  );
  const [programs, setPrograms] = useState<WorkoutProgram[]>(() => loadPrograms());
  const programsRef = useRef<WorkoutProgram[]>(programs);
  programsRef.current = programs;
  const [activeProgramId, setActiveProgramId] = useState<string>(() => {
    const loadedPrograms = loadPrograms();
    if (
      restoredSession &&
      loadedPrograms.some((p) => p.id === restoredSession.engineState.program.id)
    ) {
      return restoredSession.engineState.program.id;
    }
    const savedId = loadActiveProgramId();
    if (savedId && loadedPrograms.some((p) => p.id === savedId)) {
      return savedId;
    }
    return loadedPrograms[0]?.id ?? createDefaultPrograms()[0].id;
  });

  const [judoAudioMode, setJudoAudioMode] = useState<AudioMode>(() =>
    loadAudioModeForDiscipline('JUDO'),
  );
  const effectiveAudioMode = resolveEffectiveAudioMode(selectedDiscipline, judoAudioMode);
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile>(() => loadVoiceProfile());
  const [setupConfig, setSetupConfig] = useState<QuickSetupConfig>(() =>
    loadSetupConfig(restoredSession ? restoredSession.discipline : 'JUDO'),
  );
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>(() =>
    loadDisplaySettingsForDiscipline(restoredSession ? restoredSession.discipline : 'JUDO'),
  );
  const [eventHapticsEnabled, setEventHapticsEnabled] = useState<boolean>(() =>
    loadEventHapticsEnabled(),
  );
  const [isColorSettingsOpen, setIsColorSettingsOpen] = useState(false);
  const [initialEditProgram, setInitialEditProgram] = useState<WorkoutProgram | null>(null);

  const landingJudoProgram = useMemo(
    () =>
      resolveLandingProgramForDiscipline(
        programs,
        'JUDO',
        loadActiveProgramIdForDiscipline('JUDO'),
      ),
    [activeProgramId, programs],
  );
  const landingBjjProgram = useMemo(
    () =>
      resolveLandingProgramForDiscipline(
        programs,
        'BJJ',
        loadActiveProgramIdForDiscipline('BJJ'),
      ),
    [activeProgramId, programs],
  );

  const initialProgram = useMemo(() => {
    return (
      programs.find((p) => p.id === activeProgramId) ??
      programs[0] ??
      createDefaultPrograms()[0]
    );
  }, [activeProgramId, programs]);

  const handlePersistTimerState = useCallback((snapshot: TimerEngineState) => {
    savePersistedSession(snapshot.program.discipline, snapshot);
  }, []);

  const {
    state,
    visualState,
    fillProgress,
    subscribeFillProgress,
    start,
    pause,
    resume,
    toggleStartPause,
    reset,
    restartSession,
    beginRestScrub,
    scrubRestProgress,
    endRestScrub,
    selectProgram,
    triggerQuickPreset,
  } = useTimerEngine(initialProgram, {
    initialState: restoredSession?.engineState ?? null,
    onPersistState: handlePersistTimerState,
  });

  useNativeBackHandler(
    screen === 'SETUP',
    () => {
      setInitialEditProgram(null);
      setScreen('LANDING');
      return true;
    },
    20,
  );

  const theme = useMemo(
    () => resolveVisualTheme(visualState, displaySettings, selectedDiscipline),
    [displaySettings, selectedDiscipline, visualState],
  );

  // Preserve the active phase color underneath the 50% pause dimming overlay
  const activePhaseVisualState = useMemo(
    () => (state.isPaused ? deriveVisualState({ ...state, isPaused: false }) : visualState),
    [state, visualState],
  );
  const timerTheme = useMemo(
    () =>
      resolveVisualTheme(
        activePhaseVisualState,
        displaySettings,
        selectedDiscipline,
        fillProgress,
      ),
    [activePhaseVisualState, displaySettings, fillProgress, selectedDiscipline],
  );

  // Protect active timer rounds from PWA Service Worker auto-reloads
  useEffect(() => {
    setTimerSessionActive(screen === 'TIMER');
    return () => setTimerSessionActive(false);
  }, [screen]);

  // Sync effective audio mode & voice profile with soundEngine & localStorage
  useEffect(() => {
    soundEngine.setMode(effectiveAudioMode);
  }, [effectiveAudioMode]);

  useEffect(() => {
    soundEngine.setVoiceProfile(voiceProfile);
    saveVoiceProfile(voiceProfile);
  }, [voiceProfile]);

  useEffect(() => {
    setSoundEventHapticsEnabled(eventHapticsEnabled);
  }, [eventHapticsEnabled]);

  useEffect(() => {
    const unsubImpact = soundEngine.subscribeSoundImpact((event) => {
      triggerSoundEventHaptic(event);
    });
    const unsubCancel = soundEngine.subscribeSoundCancel(() => {
      cancelSoundEventHaptics();
    });
    return () => {
      unsubImpact();
      unsubCancel();
      cancelSoundEventHaptics();
    };
  }, []);

  const handleChangeAudioMode = useCallback(
    (mode: AudioMode) => {
      if (selectedDiscipline === 'BJJ') {
        soundEngine.setMode('GONG_ONLY');
        saveAudioModeForDiscipline('BJJ', 'GONG_ONLY');
        return;
      }
      setJudoAudioMode(mode);
      soundEngine.setMode(mode);
      saveAudioModeForDiscipline('JUDO', mode);
    },
    [selectedDiscipline],
  );

  const handleChangeVoiceProfile = useCallback(
    (profile: VoiceProfile) => {
      setVoiceProfile(profile);
      saveVoiceProfile(profile);
      if (selectedDiscipline === 'JUDO' && judoAudioMode === 'GONG_ONLY') {
        setJudoAudioMode('VOICE_GONG');
        soundEngine.setMode('VOICE_GONG');
        saveAudioModeForDiscipline('JUDO', 'VOICE_GONG');
      }
    },
    [judoAudioMode, selectedDiscipline],
  );

  // Unlock Web Audio API on first user gesture anywhere in the viewport
  useEffect(() => {
    const unlockOnce = () => {
      soundEngine.unlock();
    };
    window.addEventListener('pointerdown', unlockOnce, { once: true, passive: true });
    window.addEventListener('touchstart', unlockOnce, { once: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlockOnce);
      window.removeEventListener('touchstart', unlockOnce);
    };
  }, []);

  // Global tactile haptic & crisp sound feedback on all enabled <button> controls
  useEffect(() => {
    const resolveEnabledButton = (target: EventTarget | null): HTMLButtonElement | null => {
      const el =
        target instanceof Element
          ? target
          : target instanceof Node
            ? target.parentElement
            : null;
      const btn = el?.closest('button') ?? null;
      if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
        return null;
      }
      if (btn.closest('[data-custom-haptic="true"]')) {
        return null;
      }
      return btn;
    };

    const onGlobalPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!resolveEnabledButton(e.target)) return;
      soundEngine.unlock();
      triggerButtonFeedback('firm');
    };

    const onGlobalClick = (e: MouseEvent) => {
      if (e.detail !== 0) return;
      if (!resolveEnabledButton(e.target)) return;
      soundEngine.unlock();
      triggerButtonFeedback('firm');
    };

    window.addEventListener('pointerdown', onGlobalPointerDown, {
      capture: true,
      passive: true,
    });
    window.addEventListener('click', onGlobalClick, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', onGlobalPointerDown, { capture: true });
      window.removeEventListener('click', onGlobalClick, { capture: true });
    };
  }, []);

  const handleChangeSetupConfig = useCallback(
    (next: QuickSetupConfig) => {
      setSetupConfig(next);
      saveSetupConfig(selectedDiscipline, next);
    },
    [selectedDiscipline],
  );

  // Page 1 -> Page 2: Choose Discipline via Logo (choosing BJJ forces Scoreboard Pro)
  const handleSelectDiscipline = useCallback(
    (mode: DisciplineMode) => {
      soundEngine.unlock();
      const cfg = DISCIPLINES[mode];
      const nextEffectiveAudio = mode === 'BJJ' ? 'GONG_ONLY' : loadAudioModeForDiscipline('JUDO');
      setSelectedDiscipline(mode);
      if (mode === 'JUDO') {
        setJudoAudioMode(nextEffectiveAudio);
      }
      soundEngine.setMode(nextEffectiveAudio);
      setSetupConfig(loadSetupConfig(mode));
      setDisplaySettings(resolveDisplaySettingsForSelection(mode, true));

      const modePrograms = programs.filter((p) => p.discipline === mode);
      const savedForModeId = loadActiveProgramIdForDiscipline(mode);
      const matchingProgram =
        modePrograms.find((p) => p.id === savedForModeId) ??
        modePrograms.find((p) =>
          p.name.toLowerCase().includes(cfg.preferredProgramKeyword.toLowerCase()),
        ) ??
        modePrograms[0] ??
        programs[0];

      if (matchingProgram) {
        setActiveProgramId(matchingProgram.id);
        saveActiveProgramId(matchingProgram.id);
        saveActiveProgramIdForDiscipline(mode, matchingProgram.id);
        selectProgram(matchingProgram, false);
      }

      setIsColorSettingsOpen(false);
      setInitialEditProgram(null);
      setScreen('SETUP');
    },
    [programs, selectProgram],
  );

  // Page 2 -> Page 2: Load Saved Program into matching discipline setup atomically
  const handleLoadProgram = useCallback(
    (program: WorkoutProgram) => {
      const targetAudioMode = resolveEffectiveAudioMode(program.discipline, judoAudioMode);
      soundEngine.setMode(targetAudioMode);
      setSelectedDiscipline(program.discipline);
      setDisplaySettings(loadDisplaySettingsForDiscipline(program.discipline));
      const synced = programToSetupConfig(program);
      setSetupConfig(synced);
      saveSetupConfig(program.discipline, synced);
      setActiveProgramId(program.id);
      saveActiveProgramId(program.id);
      saveActiveProgramIdForDiscipline(program.discipline, program.id);
      selectProgram(program, false);
    },
    [judoAudioMode, selectProgram],
  );

  // Page 2 -> Page 3: Quick Preset Minutes (inherits current prepSeconds & warningSeconds)
  const handleStartQuickPreset = useCallback(
    (minutes: number) => {
      soundEngine.setMode(effectiveAudioMode);
      setIsColorSettingsOpen(false);
      triggerQuickPreset(minutes, selectedDiscipline, {
        prepSeconds: setupConfig.prepSeconds,
        warningSeconds: setupConfig.warningSeconds,
      });
      setScreen('TIMER');
    },
    [
      effectiveAudioMode,
      selectedDiscipline,
      setupConfig.prepSeconds,
      setupConfig.warningSeconds,
      triggerQuickPreset,
    ],
  );

  // Page 2 -> Page 3: Start Saved or Configured Program
  const handleStartProgram = useCallback(
    (program: WorkoutProgram) => {
      soundEngine.unlock();
      const targetAudioMode = resolveEffectiveAudioMode(program.discipline, judoAudioMode);
      soundEngine.setMode(targetAudioMode);
      if (
        program.discipline !== selectedDiscipline ||
        (screen === 'LANDING' && program.discipline === 'BJJ')
      ) {
        setSelectedDiscipline(program.discipline);
        setDisplaySettings(resolveDisplaySettingsForSelection(program.discipline, true));
      }
      if (programsRef.current.some((p) => p.id === program.id)) {
        setActiveProgramId(program.id);
        saveActiveProgramId(program.id);
        saveActiveProgramIdForDiscipline(program.discipline, program.id);
        const syncedConfig = programToSetupConfig(program);
        setSetupConfig(syncedConfig);
        saveSetupConfig(program.discipline, syncedConfig);
      }
      setIsColorSettingsOpen(false);
      setInitialEditProgram(null);
      selectProgram(program, true);
      setScreen('TIMER');
    },
    [judoAudioMode, screen, selectProgram, selectedDiscipline],
  );

  // Page 1 -> Page 2 (Program Editor): Open base/selected program directly for editing
  const handleEditLandingProgram = useCallback(
    (program: WorkoutProgram) => {
      soundEngine.unlock();
      handleLoadProgram(program);
      setIsColorSettingsOpen(false);
      setInitialEditProgram(program);
      setScreen('SETUP');
    },
    [handleLoadProgram],
  );

  // Page 3 -> Page 2: STOP
  const handleStopTimer = useCallback(() => {
    clearPersistedSession();
    reset();
    setScreen('SETUP');
  }, [reset]);

  const handleUpdateDisplaySettings = useCallback(
    (next: DisplaySettings) => {
      setDisplaySettings(next);
      saveDisplaySettingsForDiscipline(selectedDiscipline, next);
    },
    [selectedDiscipline],
  );

  const handleChangeTimerLayout = useCallback(
    (timerLayout: TimerLayoutMode) => {
      setDisplaySettings((prev) => {
        const next = { ...prev, timerLayout };
        saveDisplaySettingsForDiscipline(selectedDiscipline, next);
        return next;
      });
    },
    [selectedDiscipline],
  );

  const handleChangeEventHapticsEnabled = useCallback((enabled: boolean) => {
    setEventHapticsEnabled(enabled);
    saveEventHapticsEnabled(enabled);
    setSoundEventHapticsEnabled(enabled);
    if (enabled) {
      triggerSoundEventHaptic('WARNING_BELL');
    }
  }, []);

  const handleSavePrograms = useCallback(
    (nextPrograms: WorkoutProgram[]) => {
      programsRef.current = nextPrograms;
      setPrograms(nextPrograms);
      savePrograms(nextPrograms);
      if (nextPrograms.length > 0 && !nextPrograms.some((p) => p.id === activeProgramId)) {
        const fallback =
          nextPrograms.find((p) => p.discipline === selectedDiscipline) ?? nextPrograms[0];
        setActiveProgramId(fallback.id);
        saveActiveProgramId(fallback.id);
        saveActiveProgramIdForDiscipline(fallback.discipline, fallback.id);
        selectProgram(fallback, false);
      } else {
        const updatedActive = nextPrograms.find((p) => p.id === activeProgramId);
        if (updatedActive && updatedActive.discipline === selectedDiscipline) {
          const synced = programToSetupConfig(updatedActive);
          setSetupConfig(synced);
          saveSetupConfig(updatedActive.discipline, synced);
        }
      }
    },
    [activeProgramId, selectProgram, selectedDiscipline],
  );

  const handleRestoreDefaults = useCallback(() => {
    const defaults = createDefaultPrograms();
    setPrograms((prev) => {
      const existingIds = new Set(prev.map((p) => p.id));
      const existingNames = new Set(prev.map((p) => p.name.toLowerCase()));
      const missingDefaults = defaults.filter(
        (d) => !existingIds.has(d.id) && !existingNames.has(d.name.toLowerCase()),
      );
      const merged = missingDefaults.length > 0 ? [...prev, ...missingDefaults] : prev;
      savePrograms(merged);
      if (!merged.some((p) => p.id === activeProgramId)) {
        const first = merged.find((p) => p.discipline === selectedDiscipline) ?? merged[0];
        if (first) {
          setActiveProgramId(first.id);
          saveActiveProgramId(first.id);
          saveActiveProgramIdForDiscipline(first.discipline, first.id);
          selectProgram(first, false);
        }
      }
      return merged;
    });
  }, [activeProgramId, selectProgram, selectedDiscipline]);

  // Keyboard shortcuts scoped to active page
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isFormField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if (screen !== 'TIMER' || isFormField) {
        return;
      }

      if (e.code === 'Space') {
        const hasOpenDialog = Boolean(document.querySelector('[role="dialog"]'));
        const isInteractiveControl = Boolean(
          target?.closest('button, [role="button"], [role="slider"], a[href]'),
        );
        if (isInteractiveControl) {
          return;
        }
        if (e.repeat) {
          if (!hasOpenDialog) {
            e.preventDefault();
          }
          return;
        }
        if (
          shouldTriggerTimerSpaceShortcut({
            screen,
            code: e.code,
            repeat: e.repeat,
            isFormField: Boolean(isFormField),
            hasOpenDialog,
            isInteractiveControl,
          })
        ) {
          e.preventDefault();
          if (state.phase === 'FINISHED') {
            start();
          } else {
            toggleStartPause();
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [screen, start, state.phase, toggleStartPause]);

  if (screen === 'LANDING') {
    return (
      <DisciplineLandingScreen
        judoProgram={landingJudoProgram}
        bjjProgram={landingBjjProgram}
        onSelectDiscipline={handleSelectDiscipline}
        onStartProgram={handleStartProgram}
        onEditProgram={handleEditLandingProgram}
      />
    );
  }

  if (screen === 'TIMER') {
    return (
      <MinimalTimerScreen
        state={state}
        theme={timerTheme}
        timerLayout={displaySettings.timerLayout}
        backgroundOpacity={displaySettings.backgroundOpacity}
        colorMode={displaySettings.colorMode}
        solidColor={displaySettings.solidColor}
        fillProgress={fillProgress}
        subscribeFillProgress={subscribeFillProgress}
        onPause={pause}
        onResume={resume}
        onTogglePause={toggleStartPause}
        onRestartSession={restartSession}
        onBeginRestScrub={beginRestScrub}
        onScrubRestProgress={scrubRestProgress}
        onEndRestScrub={endRestScrub}
        onConfirmExit={handleStopTimer}
      />
    );
  }

  return (
    <>
      <SetupScreen
        discipline={selectedDiscipline}
        setupConfig={setupConfig}
        onChangeSetupConfig={handleChangeSetupConfig}
        audioMode={effectiveAudioMode}
        onChangeAudioMode={handleChangeAudioMode}
        voiceProfile={voiceProfile}
        onChangeVoiceProfile={handleChangeVoiceProfile}
        timerLayout={displaySettings.timerLayout}
        onChangeTimerLayout={handleChangeTimerLayout}
        eventHapticsEnabled={eventHapticsEnabled}
        onChangeEventHapticsEnabled={handleChangeEventHapticsEnabled}
        programs={programs}
        activeProgramId={activeProgramId}
        initialEditProgram={initialEditProgram}
        onClearInitialEditProgram={() => setInitialEditProgram(null)}
        theme={theme}
        onBackToLanding={() => {
          setInitialEditProgram(null);
          setScreen('LANDING');
        }}
        onOpenColorSettings={() => setIsColorSettingsOpen(true)}
        onStartQuickPreset={handleStartQuickPreset}
        onStartProgram={handleStartProgram}
        onLoadProgram={handleLoadProgram}
        onSavePrograms={handleSavePrograms}
        onRestoreDefaults={handleRestoreDefaults}
      />
      <DisplaySettingsModal
        isOpen={isColorSettingsOpen}
        onClose={() => setIsColorSettingsOpen(false)}
        discipline={selectedDiscipline}
        settings={displaySettings}
        onUpdateSettings={handleUpdateDisplaySettings}
      />
    </>
  );
}

export default App;
