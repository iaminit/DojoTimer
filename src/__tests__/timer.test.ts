import { beforeEach, describe, expect, it } from 'vitest';
import { DISCIPLINES } from '../config/disciplines';
import {
  advanceWithOvershoot,
  computeFillProgress,
  createIdleState,
  createQuickPresetProgram,
  deriveVisualState,
  getNextPhaseState,
  getPrevPhaseState,
  resolveEdgeCountdownCue,
} from '../engine/timerMachine';
import {
  computeAudibleDurationSec,
  FINAL_FIVE_SCALE_HZ,
  getFinalFiveScaleFreqHz,
  HAJIME_GONG_DELAY_SEC,
} from '../services/soundEngine';
import {
  createDefaultPrograms,
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_VOICE_PROFILE,
  exportProgramsJson,
  loadAudioMode,
  loadAudioModeForDiscipline,
  loadPrograms,
  loadSetupConfig,
  loadVoiceProfile,
  parseImportProgramsJson,
  PROGRAM_LIMITS,
  programToSetupConfig,
  resolveEffectiveAudioMode,
  sanitizeWorkoutProgram,
  saveAudioModeForDiscipline,
  savePrograms,
  saveSetupConfig,
  saveVoiceProfile,
  STORAGE_KEYS,
} from '../services/storage';
import {
  cycleDialogFocusIndex,
  shouldTriggerTimerSpaceShortcut,
} from '../utils/keyboardShortcuts';
import type { WorkoutProgram } from '../types/timer';
import {
  calculateTotalDurationSeconds,
  formatMMSS,
  getClockDisplay,
} from '../utils/formatTime';
import { resolveVisualTheme } from '../utils/themePalette';
import {
  advanceHorizontalScrub,
  advanceUnwrappedAngleDeg,
  angleDegToWheelSeconds,
  getWheelConfig,
  HOTSPOT_MINUTES,
  isHotspotDuration,
  normalizeWheelInitialSeconds,
  REST_HOTSPOT_SECONDS,
  tapAngleDegToWheelSeconds,
  wheelSecondsToAngleDeg,
} from '../utils/wheelMath';

function installMemoryWindowStorage() {
  const store = new Map<string, string>();
  const mockLocalStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: mockLocalStorage },
    writable: true,
    configurable: true,
  });
  return store;
}

describe('formatTime & Total Duration Calculation', () => {
  it('computes exact total durations and discipline split for seeded default programs', () => {
    const defaults = createDefaultPrograms(1000);
    expect(defaults).toHaveLength(2);
    expect(defaults.every((p) => p.warningSeconds === 30)).toBe(true);

    const judoPrograms = defaults.filter((p) => p.discipline === 'JUDO');
    const bjjPrograms = defaults.filter((p) => p.discipline === 'BJJ');
    expect(judoPrograms).toHaveLength(1);
    expect(bjjPrograms).toHaveLength(1);

    const randoriJudo = defaults.find((p) => p.name === 'Randori Judo')!;
    expect(randoriJudo.discipline).toBe('JUDO');
    expect(randoriJudo.rounds).toBe(6);
    expect(randoriJudo.workSeconds).toBe(180);
    expect(calculateTotalDurationSeconds(randoriJudo)).toBe(1390);
    expect(formatMMSS(1390)).toBe('23:10');

    const bjjSparring = defaults.find((p) => p.name === 'Sparring BJJ')!;
    expect(bjjSparring.discipline).toBe('BJJ');
    expect(bjjSparring.rounds).toBe(6);
    expect(bjjSparring.workSeconds).toBe(240);
    expect(calculateTotalDurationSeconds(bjjSparring)).toBe(1750);
    expect(formatMMSS(1750)).toBe('29:10');
  });

  it('formats remaining milliseconds to MM:SS using ceil semantics without 00:00 lag', () => {
    expect(getClockDisplay(300_000)).toMatchObject({ minutes: '05', seconds: '00' });
    expect(getClockDisplay(299_001)).toMatchObject({ minutes: '05', seconds: '00' });
    expect(getClockDisplay(299_000)).toMatchObject({ minutes: '04', seconds: '59' });
    expect(getClockDisplay(520)).toMatchObject({
      minutes: '00',
      seconds: '01',
      centiseconds: '52',
    });
    expect(getClockDisplay(0)).toMatchObject({ minutes: '00', seconds: '00', centiseconds: '00' });
  });
});

describe('storage & JSON Import/Export', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installMemoryWindowStorage();
  });

  it('seeds default programs on first boot and persists updates', () => {
    expect(store.has(STORAGE_KEYS.PROGRAMS)).toBe(false);
    const programs = loadPrograms();
    expect(programs).toHaveLength(2);
    expect(store.has(STORAGE_KEYS.PROGRAMS)).toBe(true);

    const renamed = programs.map((p, idx) =>
      idx === 0 ? { ...p, name: 'Sparring Serale' } : p,
    );
    savePrograms(renamed);

    const reloaded = loadPrograms();
    expect(reloaded[0].name).toBe('Sparring Serale');
  });

  it('migrates legacy 6 default programs to the 2 base programs once while keeping custom ones', () => {
    const legacyWithCustom = [
      {
        id: 'd0j00001-0001-4000-8000-000000000001',
        name: 'Sparring 1 Ora',
        discipline: 'JUDO',
        rounds: 10,
        workSeconds: 240,
        restSeconds: 60,
        prepSeconds: 10,
        warningSeconds: 30,
      },
      {
        id: 'd0j00006-0006-4000-8000-000000000006',
        name: 'BJJ Open Mat No-Gi',
        discipline: 'BJJ',
        rounds: 6,
        workSeconds: 420,
        restSeconds: 90,
        prepSeconds: 10,
        warningSeconds: 30,
      },
      {
        id: 'custom-user-prog',
        name: 'Gara Domenica',
        discipline: 'JUDO',
        rounds: 3,
        workSeconds: 240,
        restSeconds: 60,
        prepSeconds: 10,
        warningSeconds: 30,
      },
    ];
    store.set(STORAGE_KEYS.PROGRAMS, JSON.stringify(legacyWithCustom));

    const migrated = loadPrograms();
    expect(migrated).toHaveLength(3);
    expect(migrated.map((p) => p.name)).toEqual([
      'Randori Judo',
      'Sparring BJJ',
      'Gara Domenica',
    ]);
    expect(store.get(STORAGE_KEYS.BASE_PROGRAMS_V2_MIGRATED)).toBe('1');

    // Subsequent edits remain preserved after v2 migration
    savePrograms(migrated.filter((p) => p.id === 'custom-user-prog'));
    expect(loadPrograms()).toHaveLength(1);
  });

  it('migrates legacy programs without discipline field and infers JUDO vs BJJ', () => {
    const legacy = [
      { id: 'legacy-1', name: 'Randori Serale', rounds: 4, workSeconds: 240, restSeconds: 60 },
      { id: 'legacy-2', name: 'BJJ No-Gi Session', rounds: 5, workSeconds: 300, restSeconds: 60 },
    ];
    store.set(STORAGE_KEYS.PROGRAMS, JSON.stringify(legacy));

    const migrated = loadPrograms();
    expect(migrated.find((p) => p.id === 'legacy-1')?.discipline).toBe('JUDO');
    expect(migrated.find((p) => p.id === 'legacy-2')?.discipline).toBe('BJJ');
    expect(migrated.length).toBeGreaterThanOrEqual(4);

    expect(
      sanitizeWorkoutProgram({ name: 'BJJ Guard Passing', rounds: 5, workSeconds: 300 })?.discipline,
    ).toBe('BJJ');
    expect(
      sanitizeWorkoutProgram({ name: 'Uchi-Komi Rapid', rounds: 8, workSeconds: 60 })?.discipline,
    ).toBe('JUDO');
  });

  it('validates and exports/imports JSON backups with ID collision protection', () => {
    const existing = createDefaultPrograms(1000);
    const exportedJson = exportProgramsJson(existing);
    const result = parseImportProgramsJson(exportedJson, existing);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.importedCount).toBe(2);
      expect(result.programs).toHaveLength(4);
      const uniqueIds = new Set(result.programs.map((p) => p.id));
      expect(uniqueIds.size).toBe(4);
    }
  });

  it('rejects malformed JSON and invalid program records', () => {
    const existing = createDefaultPrograms(1000);
    expect(parseImportProgramsJson('{not valid json', existing).ok).toBe(false);
    expect(parseImportProgramsJson('{"programs": [{"name": ""}]}', existing).ok).toBe(false);
    expect(sanitizeWorkoutProgram({ name: 'Test', rounds: 0, workSeconds: 10 })?.rounds).toBe(1);
    expect(sanitizeWorkoutProgram({ name: '   ', rounds: 3, workSeconds: 60 })).toBeNull();
  });

  it('migrates legacy warningSeconds 10 to 30 once and preserves subsequent edits', () => {
    const legacy = [
      {
        id: 'legacy-w10',
        name: 'Randori Vecchia',
        discipline: 'JUDO',
        rounds: 6,
        workSeconds: 300,
        restSeconds: 60,
        prepSeconds: 10,
        warningSeconds: 10,
      },
    ];
    store.set(STORAGE_KEYS.PROGRAMS, JSON.stringify(legacy));

    const firstLoad = loadPrograms();
    expect(firstLoad[0].warningSeconds).toBe(30);

    // User subsequently customizes warningSeconds back to 10 or 0 -> preserved after migration flag
    savePrograms([{ ...firstLoad[0], warningSeconds: 10 }]);
    const secondLoad = loadPrograms();
    expect(secondLoad[0].warningSeconds).toBe(10);
  });

  it('defaults QuickSetupConfig warningSeconds to 30 and persists per-discipline updates', () => {
    const judoDefaults = loadSetupConfig('JUDO');
    expect(judoDefaults.warningSeconds).toBe(30);
    expect(judoDefaults.prepSeconds).toBe(10);
    expect(judoDefaults.workSeconds).toBe(180);
    expect(judoDefaults.rounds).toBe(6);

    const bjjDefaults = loadSetupConfig('BJJ');
    expect(bjjDefaults.warningSeconds).toBe(30);
    expect(bjjDefaults.workSeconds).toBe(240);
    expect(bjjDefaults.rounds).toBe(6);

    saveSetupConfig('JUDO', { ...judoDefaults, warningSeconds: 45, rounds: 8 });
    expect(loadSetupConfig('JUDO').warningSeconds).toBe(45);
    expect(loadSetupConfig('JUDO').rounds).toBe(8);
    expect(loadSetupConfig('BJJ').warningSeconds).toBe(30);
  });

  it('defaults voice profile to KENGURO and persists ARALE selection', () => {
    expect(loadVoiceProfile()).toBe(DEFAULT_VOICE_PROFILE);
    saveVoiceProfile('ARALE');
    expect(loadVoiceProfile()).toBe('ARALE');
    store.set(STORAGE_KEYS.VOICE_PROFILE, 'INVALID_VOICE');
    expect(loadVoiceProfile()).toBe('KENGURO');
  });
});

describe('timerMachine FSM & overshoot compensation', () => {
  const sampleProgram: WorkoutProgram = {
    id: 'test-prog',
    name: 'Test Dojo',
    discipline: 'JUDO',
    rounds: 2,
    workSeconds: 10,
    restSeconds: 5,
    prepSeconds: 5,
    warningSeconds: 3,
    createdAt: 1,
    updatedAt: 1,
  };

  it('follows deterministic transitions IDLE -> PREP -> WORK -> REST -> WORK -> FINISHED', () => {
    const idle = createIdleState(sampleProgram);
    expect(deriveVisualState(idle)).toBe('IDLE');
    expect(idle.remainingMs).toBe(10_000);

    const t1 = getNextPhaseState(idle);
    expect(t1.nextState.phase).toBe('PREP');
    expect(t1.audioEvent).toBeNull();
    expect(deriveVisualState(t1.nextState)).toBe('PREP');

    const t2 = getNextPhaseState(t1.nextState);
    expect(t2.nextState.phase).toBe('WORK');
    expect(t2.nextState.currentRound).toBe(1);
    expect(t2.audioEvent).toBe('HAJIME');
    expect(deriveVisualState(t2.nextState)).toBe('WORK');

    const warningSnapshot = { ...t2.nextState, remainingMs: 2500 };
    expect(deriveVisualState(warningSnapshot)).toBe('WARNING');

    const equalDurationSnapshot = {
      ...t2.nextState,
      phaseDurationMs: 3000,
      remainingMs: 3000,
    };
    expect(deriveVisualState(equalDurationSnapshot)).toBe('WORK');

    const pausedSnapshot = { ...warningSnapshot, isPaused: true };
    expect(deriveVisualState(pausedSnapshot)).toBe('PAUSED');

    const t3 = getNextPhaseState(t2.nextState);
    expect(t3.nextState.phase).toBe('REST');
    expect(t3.nextState.currentRound).toBe(1);
    expect(t3.audioEvent).toBe('MATE');

    const t4 = getNextPhaseState(t3.nextState);
    expect(t4.nextState.phase).toBe('WORK');
    expect(t4.nextState.currentRound).toBe(2);
    expect(t4.audioEvent).toBe('HAJIME');

    const t5 = getNextPhaseState(t4.nextState);
    expect(t5.nextState.phase).toBe('FINISHED');
    expect(t5.nextState.remainingMs).toBe(0);
    expect(t5.audioEvent).toBe('SOREMADE');
    expect(deriveVisualState(t5.nextState)).toBe('FINISHED');
  });

  it('supports backward phase navigation and quick presets', () => {
    const idle = createIdleState(sampleProgram);
    const prep = getNextPhaseState(idle).nextState;
    const work1 = getNextPhaseState(prep).nextState;
    const rest1 = getNextPhaseState(work1).nextState;
    const work2 = getNextPhaseState(rest1).nextState;

    expect(getPrevPhaseState(work2).phase).toBe('REST');
    expect(getPrevPhaseState(rest1).phase).toBe('WORK');
    expect(getPrevPhaseState(work1).phase).toBe('PREP');
    expect(getPrevPhaseState(prep).phase).toBe('IDLE');

    const quick = createQuickPresetProgram(3, 'BJJ');
    expect(quick.discipline).toBe('BJJ');
    expect(quick.rounds).toBe(1);
    expect(quick.workSeconds).toBe(180);
    expect(quick.restSeconds).toBe(0);
    expect(quick.prepSeconds).toBe(10);
    expect(quick.warningSeconds).toBe(30);
  });

  it('compensates background tab overshoot without losing accuracy', () => {
    const idle = createIdleState(sampleProgram);
    const prep = getNextPhaseState(idle).nextState;

    // 12s overshoot after PREP: passes WORK R1 (10s) and lands at 3s left in REST R1
    const res = advanceWithOvershoot(prep, 12_000);
    expect(res.nextState.phase).toBe('REST');
    expect(res.nextState.currentRound).toBe(1);
    expect(res.nextState.remainingMs).toBe(3000);
    expect(res.audioEvents).toEqual(['HAJIME', 'MATE']);

    // Overshoot past total remaining duration lands on FINISHED
    const endRes = advanceWithOvershoot(prep, 40_000);
    expect(endRes.nextState.phase).toBe('FINISHED');
    expect(endRes.audioEvents).toEqual(['HAJIME', 'MATE', 'HAJIME', 'SOREMADE']);
  });

  it('computes 0 -> 1 fill progress across IDLE, active phases, PAUSED, and FINISHED', () => {
    const idle = createIdleState(sampleProgram);
    expect(computeFillProgress(idle)).toBe(0);

    const prep = getNextPhaseState(idle).nextState;
    const work = getNextPhaseState(prep).nextState; // 10_000ms total
    expect(computeFillProgress(work)).toBe(0);

    expect(computeFillProgress({ ...work, remainingMs: 7500 })).toBeCloseTo(0.25, 5);
    expect(computeFillProgress({ ...work, remainingMs: 2500 })).toBeCloseTo(0.75, 5);
    expect(computeFillProgress({ ...work, remainingMs: 2500, isPaused: true })).toBeCloseTo(
      0.75,
      5,
    );

    const finished = advanceWithOvershoot(prep, 40_000).nextState;
    expect(computeFillProgress(finished)).toBe(1);
  });

  it('migrates legacy MUTE audio mode in localStorage to VOICE_GONG', () => {
    const store = installMemoryWindowStorage();
    store.set(STORAGE_KEYS.AUDIO_MODE, 'MUTE');
    expect(loadAudioMode()).toBe('VOICE_GONG');

    store.set(STORAGE_KEYS.AUDIO_MODE, 'GONG_ONLY');
    expect(loadAudioMode()).toBe('GONG_ONLY');
  });

  it('resolves JUDO vs BJJ discipline configs and visual labels', () => {
    expect(DISCIPLINES.JUDO.defaultAudioMode).toBe('VOICE_GONG');
    expect(DISCIPLINES.BJJ.defaultAudioMode).toBe('GONG_ONLY');

    expect(resolveVisualTheme('WORK', DEFAULT_DISPLAY_SETTINGS, 'JUDO').label).toBe('HAJIME');
    expect(resolveVisualTheme('REST', DEFAULT_DISPLAY_SETTINGS, 'JUDO').label).toBe('MATTE');
    expect(resolveVisualTheme('FINISHED', DEFAULT_DISPLAY_SETTINGS, 'JUDO').label).toBe(
      'SOREMADE',
    );

    expect(resolveVisualTheme('WORK', DEFAULT_DISPLAY_SETTINGS, 'BJJ').label).toBe(
      'COMBATTIMENTO',
    );
    expect(resolveVisualTheme('REST', DEFAULT_DISPLAY_SETTINGS, 'BJJ').label).toBe('RECUPERO');
    expect(resolveVisualTheme('FINISHED', DEFAULT_DISPLAY_SETTINGS, 'BJJ').label).toBe(
      'FINE SESSIONE',
    );
  });

  it('transitions WORK proportionally Verde -> Arancione -> Rosso and REST strictly Blu -> Azzurro', () => {
    const workGreen = resolveVisualTheme('WORK', DEFAULT_DISPLAY_SETTINGS, 'JUDO', 0.1);
    expect(workGreen.hex).toBe('#00E676');

    const workOrange = resolveVisualTheme('WORK', DEFAULT_DISPLAY_SETTINGS, 'JUDO', 0.5);
    expect(workOrange.hex).toBe('#FF9100');

    const workRed = resolveVisualTheme('WORK', DEFAULT_DISPLAY_SETTINGS, 'JUDO', 0.9);
    expect(workRed.hex).toBe('#FF3B30');

    const warnRed = resolveVisualTheme('WARNING', DEFAULT_DISPLAY_SETTINGS, 'JUDO', 0.9);
    expect(warnRed.hex).toBe('#FF3B30');
    expect(warnRed.isWarning).toBe(true);

    const restSettings = { ...DEFAULT_DISPLAY_SETTINGS, useComplementaryForRest: true };
    const restBlue = resolveVisualTheme('REST', restSettings, 'BJJ', 0.2);
    expect(restBlue.hex).toBe('#2979FF');

    const restAzure = resolveVisualTheme('REST', restSettings, 'BJJ', 0.8);
    expect(restAzure.hex).toBe('#00E5FF');
  });

  it('plays spoken countdown 10..1 only during PREP and emits no countdown tones in WORK or REST', () => {
    const base = createIdleState(sampleProgram);

    // PREP plays PREP_VOICE_COUNT across 10..1
    expect(
      resolveEdgeCountdownCue({ ...base, phase: 'PREP', remainingMs: 9500 }),
    ).toEqual({ key: 'PREP-1-10', kind: 'PREP_VOICE_COUNT', sec: 10 });
    expect(
      resolveEdgeCountdownCue({ ...base, phase: 'PREP', remainingMs: 1000 }),
    ).toEqual({ key: 'PREP-1-1', kind: 'PREP_VOICE_COUNT', sec: 1 });

    // WORK emits no countdown tones (even in final 5s)
    expect(
      resolveEdgeCountdownCue({ ...base, phase: 'WORK', remainingMs: 8000 }),
    ).toBeNull();
    expect(
      resolveEdgeCountdownCue({ ...base, phase: 'WORK', remainingMs: 4200 }),
    ).toBeNull();

    // REST emits no countdown tones (even in final 5s)
    expect(
      resolveEdgeCountdownCue({ ...base, phase: 'REST', remainingMs: 6000 }),
    ).toBeNull();
    expect(
      resolveEdgeCountdownCue({ ...base, phase: 'REST', remainingMs: 2500 }),
    ).toBeNull();

    // Paused emits nothing
    expect(
      resolveEdgeCountdownCue({ ...base, phase: 'PREP', isPaused: true, remainingMs: 5000 }),
    ).toBeNull();
  });
});

describe('wheelMath rotary dial & haptic hotspots', () => {
  it('defines all 12 clock hotspots (1..12 minutes) and identifies hotspot durations', () => {
    expect([...HOTSPOT_MINUTES]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const mins of HOTSPOT_MINUTES) {
      expect(isHotspotDuration(mins * 60)).toBe(true);
    }
    expect(isHotspotDuration(660)).toBe(true); // 11 min is now a hotspot
    expect(isHotspotDuration(75)).toBe(false); // 01:15 intermediate step
    expect(isHotspotDuration(675)).toBe(false); // 11:15 intermediate step
  });

  it('magnetically snaps near hotspots and quantizes intermediate angles to 15s steps', () => {
    expect(wheelSecondsToAngleDeg(180)).toBe(90);
    expect(angleDegToWheelSeconds(148)).toBe(300); // near 150deg (5 min)
    expect(angleDegToWheelSeconds(328)).toBe(660); // near 330deg (11 min)
    expect(angleDegToWheelSeconds(357)).toBe(720); // near 360deg (12 min)
    expect(angleDegToWheelSeconds(337.5)).toBe(675); // 11:15 fine 15s step
  });

  it('clamps continuous rotation at 00:15 and 12:00 without wrapping across 12 o clock', () => {
    expect(advanceUnwrappedAngleDeg(356, 356, 5)).toBe(360);
    expect(advanceUnwrappedAngleDeg(10, 10, 355)).toBe(7.5);
    expect(tapAngleDegToWheelSeconds(358)).toBe(720);
  });

  it('supports REST finescale (5s..180s, 1 min default, 15s hotspots, 5s ticks)', () => {
    const restCfg = getWheelConfig('REST');
    expect(restCfg.minSeconds).toBe(5);
    expect(restCfg.maxSeconds).toBe(180);
    expect(restCfg.stepSeconds).toBe(5);
    expect(restCfg.defaultSeconds).toBe(60);
    expect(restCfg.totalTicks).toBe(36);

    // Defaults to 60s (1 minute) when initial rest is 0 or invalid
    expect(normalizeWheelInitialSeconds(0, 'REST')).toBe(60);
    expect(normalizeWheelInitialSeconds(-10, 'REST')).toBe(60);
    expect(normalizeWheelInitialSeconds(45, 'REST')).toBe(45);
    expect(normalizeWheelInitialSeconds(240, 'REST')).toBe(180);

    for (const sec of REST_HOTSPOT_SECONDS) {
      expect(isHotspotDuration(sec, 'REST')).toBe(true);
    }
    expect(isHotspotDuration(10, 'REST')).toBe(false);
    expect(isHotspotDuration(65, 'REST')).toBe(false);

    // 5s fine steps reachable between 15s hotspots
    expect(wheelSecondsToAngleDeg(5, 'REST')).toBe(10);
    expect(wheelSecondsToAngleDeg(60, 'REST')).toBe(120);
    expect(angleDegToWheelSeconds(10, true, 'REST')).toBe(5);
    expect(angleDegToWheelSeconds(20, true, 'REST')).toBe(10);
    expect(angleDegToWheelSeconds(40, true, 'REST')).toBe(20);
    expect(angleDegToWheelSeconds(28, true, 'REST')).toBe(15); // magnetic snap near 30deg
    expect(tapAngleDegToWheelSeconds(358, 'REST')).toBe(180);
    expect(advanceUnwrappedAngleDeg(14, 14, 355, 'REST')).toBe(10);
    expect(advanceUnwrappedAngleDeg(355, 355, 6, 'REST')).toBe(360);
  });
});

describe('advanceHorizontalScrub dx/sx numeric scrubbing', () => {
  it('increases on rightward slide (dx) and decreases on leftward slide (sx) with residual accumulation', () => {
    // Accumulates small movements until pxPerStep threshold
    const step1 = advanceHorizontalScrub({
      value: 5,
      residualPx: 0,
      deltaX: 8,
      min: 1,
      max: 99,
      step: 1,
      pxPerStep: 14,
    });
    expect(step1).toEqual({ nextValue: 5, nextResidualPx: 8, stepsChanged: 0 });

    const step2 = advanceHorizontalScrub({
      value: step1.nextValue,
      residualPx: step1.nextResidualPx,
      deltaX: 9,
      min: 1,
      max: 99,
      step: 1,
      pxPerStep: 14,
    });
    expect(step2).toEqual({ nextValue: 6, nextResidualPx: 3, stepsChanged: 1 });

    // Multi-step downward swipe
    const down = advanceHorizontalScrub({
      value: 60,
      residualPx: 0,
      deltaX: -30,
      min: 0,
      max: 120,
      step: 5,
      pxPerStep: 14,
    });
    expect(down).toEqual({ nextValue: 50, nextResidualPx: -2, stepsChanged: 2 });
  });

  it('supports variable step callbacks and resets residual at min/max bounds without overshoot lag', () => {
    const adaptiveStep = (val: number, dir: 1 | -1) =>
      dir > 0 ? (val < 60 ? 5 : 15) : val <= 60 ? 5 : 15;

    const across60 = advanceHorizontalScrub({
      value: 55,
      residualPx: 0,
      deltaX: 28,
      min: 0,
      max: 1800,
      step: adaptiveStep,
      pxPerStep: 12,
    });
    // +12px -> 60 (+5), +12px -> 75 (+15), 4px remaining
    expect(across60).toEqual({ nextValue: 75, nextResidualPx: 4, stepsChanged: 2 });

    const capped = advanceHorizontalScrub({
      value: 98,
      residualPx: 0,
      deltaX: 100,
      min: 1,
      max: 99,
      step: 1,
      pxPerStep: 14,
    });
    expect(capped).toEqual({ nextValue: 99, nextResidualPx: 0, stepsChanged: 1 });
  });
});

describe('soundEngine Hajime audible trim & 500ms gong delay', () => {
  it('trims trailing MP3 silence below threshold and schedules opening gong at 0.5s from prep end', () => {
    expect(HAJIME_GONG_DELAY_SEC).toBe(0.5);

    // 1000 Hz fake clip: 1.60s total, active speech only during first 400 samples (0.40s)
    const sampleRate = 1000;
    const totalSamples = 1600;
    const channel = new Float32Array(totalSamples);
    for (let i = 0; i < 400; i += 1) {
      channel[i] = 0.25;
    }
    // Near-silent MP3 padding noise (< 0.01 threshold)
    for (let i = 400; i < totalSamples; i += 1) {
      channel[i] = 0.002;
    }

    const audibleEnd = computeAudibleDurationSec([channel], sampleRate, totalSamples / sampleRate);
    expect(audibleEnd).toBeCloseTo(0.4, 5);

    // Falls back cleanly when no sample exceeds threshold
    const silent = new Float32Array(500);
    expect(computeAudibleDurationSec([silent], sampleRate, 0.5)).toBe(0.5);
  });

  it('orders the final 5 seconds strictly from high (acute) to low (grave) pitch', () => {
    const f5 = getFinalFiveScaleFreqHz(5);
    const f4 = getFinalFiveScaleFreqHz(4);
    const f3 = getFinalFiveScaleFreqHz(3);
    const f2 = getFinalFiveScaleFreqHz(2);
    const f1 = getFinalFiveScaleFreqHz(1);

    expect(f5).toBe(FINAL_FIVE_SCALE_HZ[5]);
    expect(f1).toBe(FINAL_FIVE_SCALE_HZ[1]);
    expect(f5!).toBeGreaterThan(f4!);
    expect(f4!).toBeGreaterThan(f3!);
    expect(f3!).toBeGreaterThan(f2!);
    expect(f2!).toBeGreaterThan(f1!);

    expect(getFinalFiveScaleFreqHz(6)).toBeNull();
    expect(getFinalFiveScaleFreqHz(0)).toBeNull();
    expect(getFinalFiveScaleFreqHz(-1)).toBeNull();
  });
});

describe('bugfixes verification (2026-11-18 report)', () => {
  it('enforces BJJ effects-only audio and preserves Judo audio preference across reloads', () => {
    installMemoryWindowStorage();

    expect(resolveEffectiveAudioMode('BJJ', 'VOICE_GONG')).toBe('GONG_ONLY');
    expect(resolveEffectiveAudioMode('JUDO', 'GONG_ONLY')).toBe('GONG_ONLY');

    saveAudioModeForDiscipline('JUDO', 'GONG_ONLY');
    saveAudioModeForDiscipline('BJJ', 'VOICE_GONG');

    expect(loadAudioModeForDiscipline('JUDO')).toBe('GONG_ONLY');
    expect(loadAudioModeForDiscipline('BJJ')).toBe('GONG_ONLY');
  });

  it('aligns setup, program loading, and storage limits up to 7200s/3600s/300s without truncation', () => {
    const store = installMemoryWindowStorage();
    expect(PROGRAM_LIMITS.workSeconds).toEqual({ min: 5, max: 7200 });
    expect(PROGRAM_LIMITS.restSeconds).toEqual({ min: 0, max: 3600 });
    expect(PROGRAM_LIMITS.prepSeconds).toEqual({ min: 0, max: 300 });

    const longProgram: WorkoutProgram = {
      id: 'long-bjj',
      name: 'Endurance 90m',
      discipline: 'BJJ',
      rounds: 8,
      workSeconds: 5400,
      restSeconds: 2400,
      prepSeconds: 180,
      warningSeconds: 45,
      createdAt: 1,
      updatedAt: 1,
    };
    const synced = programToSetupConfig(longProgram);
    expect(synced).toEqual({
      workSeconds: 5400,
      restSeconds: 2400,
      rounds: 8,
      prepSeconds: 180,
      warningSeconds: 45,
    });

    saveSetupConfig('BJJ', { ...synced, workSeconds: 5 });
    expect(loadSetupConfig('BJJ').workSeconds).toBe(5);
    saveSetupConfig('BJJ', synced);
    expect(loadSetupConfig('BJJ')).toEqual(synced);
    expect(store.get(STORAGE_KEYS.SETUP_CONFIG_JUDO)).toBeUndefined();
    expect(loadSetupConfig('JUDO').workSeconds).toBe(180);
  });

  it('emits ROUND_TRANSITION (triple bell) at no-rest round boundaries without HAJIME', () => {
    const noRestProgram: WorkoutProgram = {
      id: 'no-rest',
      name: 'BJJ Continua',
      discipline: 'BJJ',
      rounds: 2,
      workSeconds: 15,
      restSeconds: 0,
      prepSeconds: 0,
      warningSeconds: 5,
      createdAt: 1,
      updatedAt: 1,
    };

    const idle = createIdleState(noRestProgram);
    const r1 = getNextPhaseState(idle);
    expect(r1.nextState.phase).toBe('WORK');
    expect(r1.nextState.currentRound).toBe(1);
    expect(r1.audioEvent).toBe('HAJIME');

    const r2 = getNextPhaseState(r1.nextState);
    expect(r2.nextState.phase).toBe('WORK');
    expect(r2.nextState.currentRound).toBe(2);
    expect(r2.audioEvent).toBe('ROUND_TRANSITION');

    const end = getNextPhaseState(r2.nextState);
    expect(end.nextState.phase).toBe('FINISHED');
    expect(end.audioEvent).toBe('SOREMADE');

    const jumped = advanceWithOvershoot(r1.nextState, 20_000);
    expect(jumped.nextState.phase).toBe('FINISHED');
    expect(jumped.audioEvents).toEqual(['ROUND_TRANSITION', 'SOREMADE']);
  });

  it('inherits custom prepSeconds and warningSeconds in createQuickPresetProgram when provided', () => {
    const quickInherited = createQuickPresetProgram(1, 'BJJ', {
      prepSeconds: 5,
      warningSeconds: 20,
    });
    expect(quickInherited.workSeconds).toBe(60);
    expect(quickInherited.prepSeconds).toBe(5);
    expect(quickInherited.warningSeconds).toBe(20);

    const quickDefault = createQuickPresetProgram(2, 'JUDO');
    expect(quickDefault.prepSeconds).toBe(10);
    expect(quickDefault.warningSeconds).toBe(30);
  });

  it('ignores repeated Space events, focused interactive controls, and traps dialog focus', () => {
    expect(
      shouldTriggerTimerSpaceShortcut({
        screen: 'TIMER',
        code: 'Space',
        repeat: false,
        isFormField: false,
        hasOpenDialog: false,
        isInteractiveControl: false,
      }),
    ).toBe(true);

    expect(
      shouldTriggerTimerSpaceShortcut({
        screen: 'TIMER',
        code: 'Space',
        repeat: true,
        isFormField: false,
        hasOpenDialog: false,
        isInteractiveControl: false,
      }),
    ).toBe(false);

    expect(
      shouldTriggerTimerSpaceShortcut({
        screen: 'TIMER',
        code: 'Space',
        repeat: false,
        isFormField: false,
        hasOpenDialog: false,
        isInteractiveControl: true,
      }),
    ).toBe(false);

    expect(
      shouldTriggerTimerSpaceShortcut({
        screen: 'TIMER',
        code: 'Space',
        repeat: false,
        isFormField: false,
        hasOpenDialog: true,
        isInteractiveControl: false,
      }),
    ).toBe(false);

    expect(cycleDialogFocusIndex(0, 2, false)).toBe(1);
    expect(cycleDialogFocusIndex(1, 2, false)).toBe(0);
    expect(cycleDialogFocusIndex(0, 2, true)).toBe(1);
    expect(cycleDialogFocusIndex(-1, 2, true)).toBe(1);
  });
});
