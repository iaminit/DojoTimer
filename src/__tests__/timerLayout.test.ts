import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelSoundEventHaptics,
  isSoundEventHapticsEnabled,
  setSoundEventHapticsEnabled,
  triggerSoundEventHaptic,
} from '../services/haptics';
import { soundEngine } from '../services/soundEngine';
import {
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_EVENT_HAPTICS_ENABLED,
  DEFAULT_VU_METER_MODE,
  getDefaultDisplaySettings,
  loadDisplaySettings,
  loadDisplaySettingsForDiscipline,
  loadEventHapticsEnabled,
  loadVuMeterMode,
  resolveDigitScaleFactors,
  saveDisplaySettings,
  saveDisplaySettingsForDiscipline,
  saveEventHapticsEnabled,
  saveVuMeterMode,
  STORAGE_KEYS,
} from '../services/storage';
import {
  computeSecondsNegativeBarPct,
  resolveProTimerPalette,
} from '../utils/proTimerTheme';
import {
  MAX_DISCRETE_ROUND_SEGMENTS,
  resolveRoundSegments,
} from '../utils/roundSegments';
import { resolveVisualTheme, SOLID_COLOR_OPTIONS } from '../utils/themePalette';

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
  return mockLocalStorage;
}

describe('DisplaySettings persistence (per-discipline defaults, 50% opacity, solid/auto colors)', () => {
  beforeEach(() => {
    installMemoryWindowStorage();
  });

  it('defaults Judo to CLASSIC @ 50% opacity and BJJ to PRO @ 50% opacity', () => {
    expect(DEFAULT_DISPLAY_SETTINGS.timerLayout).toBe('CLASSIC');
    expect(DEFAULT_DISPLAY_SETTINGS.backgroundOpacity).toBe(50);
    expect(DEFAULT_DISPLAY_SETTINGS.digitScale).toBe(100);
    expect(DEFAULT_DISPLAY_SETTINGS.colorMode).toBe('AUTO');
    expect(DEFAULT_DISPLAY_SETTINGS.solidColor).toBe('GREEN');

    expect(loadDisplaySettings()).toEqual(DEFAULT_DISPLAY_SETTINGS);

    const judoDefaults = loadDisplaySettingsForDiscipline('JUDO');
    expect(judoDefaults.timerLayout).toBe('CLASSIC');
    expect(judoDefaults.backgroundOpacity).toBe(50);
    expect(judoDefaults).toEqual(getDefaultDisplaySettings('JUDO'));

    const bjjDefaults = loadDisplaySettingsForDiscipline('BJJ');
    expect(bjjDefaults.timerLayout).toBe('PRO');
    expect(bjjDefaults.backgroundOpacity).toBe(50);
    expect(bjjDefaults).toEqual(getDefaultDisplaySettings('BJJ'));
  });

  it('persists Judo and BJJ display settings independently without cross-overwriting', () => {
    saveDisplaySettingsForDiscipline('JUDO', {
      ...getDefaultDisplaySettings('JUDO'),
      backgroundOpacity: 30,
      colorMode: 'SOLID',
      solidColor: 'RED',
    });
    saveDisplaySettingsForDiscipline('BJJ', {
      ...getDefaultDisplaySettings('BJJ'),
      backgroundOpacity: 75,
      colorMode: 'SOLID',
      solidColor: 'AZURE',
    });

    const judo = loadDisplaySettingsForDiscipline('JUDO');
    const bjj = loadDisplaySettingsForDiscipline('BJJ');

    expect(judo.timerLayout).toBe('CLASSIC');
    expect(judo.backgroundOpacity).toBe(30);
    expect(judo.solidColor).toBe('RED');

    expect(bjj.timerLayout).toBe('PRO');
    expect(bjj.backgroundOpacity).toBe(75);
    expect(bjj.solidColor).toBe('AZURE');
  });

  it('falls back safely for legacy JSON, invalid enums, and clamps out-of-range backgroundOpacity', () => {
    window.localStorage.setItem(
      STORAGE_KEYS.DISPLAY_SETTINGS,
      JSON.stringify({
        activeColor: 'YELLOW',
        useSelectedForWork: true,
        useComplementaryForRest: false,
        contrastLevel: 75,
      }),
    );
    const legacy = loadDisplaySettings();
    expect(legacy.timerLayout).toBe('CLASSIC');
    expect(legacy.backgroundOpacity).toBe(50);
    expect(legacy.colorMode).toBe('AUTO');
    expect(legacy.solidColor).toBe('GREEN');

    window.localStorage.setItem(
      STORAGE_KEYS.DISPLAY_SETTINGS,
      JSON.stringify({
        ...DEFAULT_DISPLAY_SETTINGS,
        timerLayout: 'UNKNOWN_MODE',
        colorMode: 'RAINBOW',
        solidColor: 'PURPLE',
        backgroundOpacity: 150,
        digitScale: 240,
      }),
    );
    const sanitizedHigh = loadDisplaySettings();
    expect(sanitizedHigh.timerLayout).toBe('CLASSIC');
    expect(sanitizedHigh.colorMode).toBe('AUTO');
    expect(sanitizedHigh.solidColor).toBe('GREEN');
    expect(sanitizedHigh.backgroundOpacity).toBe(100);
    expect(sanitizedHigh.digitScale).toBe(135);

    window.localStorage.setItem(
      STORAGE_KEYS.DISPLAY_SETTINGS,
      JSON.stringify({
        ...DEFAULT_DISPLAY_SETTINGS,
        backgroundOpacity: -10,
        digitScale: 20,
      }),
    );
    expect(loadDisplaySettings().backgroundOpacity).toBe(0);
    expect(loadDisplaySettings().digitScale).toBe(70);

    expect(resolveDigitScaleFactors(135)).toEqual({
      clampedPct: 135,
      landscapePct: 135,
      portraitPct: 130,
      landscapeFactor: 1.35,
      portraitFactor: 1.3,
    });
    expect(resolveDigitScaleFactors(100)).toEqual({
      clampedPct: 100,
      landscapePct: 100,
      portraitPct: 95,
      landscapeFactor: 1,
      portraitFactor: 0.95,
    });
    expect(resolveDigitScaleFactors(70)).toEqual({
      clampedPct: 70,
      landscapePct: 70,
      portraitPct: 65,
      landscapeFactor: 0.7,
      portraitFactor: 0.65,
    });
  });

  it('persists PRO layout, custom opacity, and AZURE solid color round-trip', () => {
    saveDisplaySettings({
      ...DEFAULT_DISPLAY_SETTINGS,
      timerLayout: 'PRO',
      backgroundOpacity: 50,
      colorMode: 'SOLID',
      solidColor: 'AZURE',
    });
    expect(loadDisplaySettings()).toEqual({
      ...DEFAULT_DISPLAY_SETTINGS,
      timerLayout: 'PRO',
      backgroundOpacity: 50,
      colorMode: 'SOLID',
      solidColor: 'AZURE',
    });
  });
});

describe('Solid color overrides in both Modalità 1 and Modalità 2', () => {
  it('applies each solid color (RED, GREEN, ORANGE, AZURE) across phases in Modalità 1 (CLASSIC)', () => {
    for (const key of ['RED', 'GREEN', 'ORANGE', 'AZURE'] as const) {
      const solid = SOLID_COLOR_OPTIONS[key];
      const settings = {
        ...DEFAULT_DISPLAY_SETTINGS,
        colorMode: 'SOLID' as const,
        solidColor: key,
      };

      expect(resolveVisualTheme('WORK', settings, 'JUDO', 0.1).hex).toBe(solid.hex);
      expect(resolveVisualTheme('WARNING', settings, 'JUDO', 0.9).hex).toBe(solid.hex);
      expect(resolveVisualTheme('REST', settings, 'BJJ', 0.5).hex).toBe(solid.hex);
      expect(resolveVisualTheme('PREP', settings, 'JUDO', 0.3).hex).toBe(solid.hex);
      expect(resolveVisualTheme('FINISHED', settings, 'BJJ', 1).hex).toBe(solid.hex);
      expect(resolveVisualTheme('PAUSED', settings, 'JUDO', 0.5).hex).toBe('#94A3B8');
    }
  });

  it('applies each solid color (RED, GREEN, ORANGE, AZURE) in Modalità 2 (PRO) while keeping <=9s urgent digits', () => {
    for (const key of ['RED', 'GREEN', 'ORANGE', 'AZURE'] as const) {
      const solid = SOLID_COLOR_OPTIONS[key];
      const override = { colorMode: 'SOLID' as const, solidColor: key };

      const workNormal = resolveProTimerPalette('WORK', 150, 0.2, override);
      expect(workNormal.hex).toBe(solid.hex);
      expect(workNormal.rgb).toBe(solid.rgb);
      expect(workNormal.isUrgent).toBe(false);
      expect(workNormal.secondsColor).toBe('#ffffff');

      const workUrgent = resolveProTimerPalette('WORK', 5, 0.95, override);
      expect(workUrgent.hex).toBe(solid.hex);
      expect(workUrgent.isUrgent).toBe(true);
      expect(workUrgent.secondsColor).toBe('#ff4d4d');

      expect(resolveProTimerPalette('REST', 20, 0.6, override).hex).toBe(solid.hex);
      expect(resolveProTimerPalette('PREP', 3, 0.7, override).hex).toBe(solid.hex);
      expect(resolveProTimerPalette('FINISHED', 0, 1, override).hex).toBe(solid.hex);
    }
  });
});

describe('resolveRoundSegments for Scoreboard Pro dock', () => {
  it('marks all discrete segments as upcoming in IDLE phase', () => {
    const res = resolveRoundSegments(1, 6, 'IDLE');
    expect(res).toEqual({
      mode: 'discrete',
      segments: ['upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming'],
      progressRatio: 0,
      completedCount: 0,
      totalRounds: 6,
    });
  });

  it('marks completed, active, and upcoming segments during WORK and REST', () => {
    const work = resolveRoundSegments(2, 6, 'WORK');
    expect(work).toEqual({
      mode: 'discrete',
      segments: ['completed', 'active', 'upcoming', 'upcoming', 'upcoming', 'upcoming'],
      progressRatio: 2 / 6,
      completedCount: 2,
      totalRounds: 6,
    });

    const rest = resolveRoundSegments(3, 6, 'REST');
    expect(rest.mode).toBe('discrete');
    expect(rest.segments).toEqual([
      'completed',
      'completed',
      'active',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
    expect(rest.progressRatio).toBeCloseTo(0.5);
  });

  it('marks all segments completed when FINISHED', () => {
    const done = resolveRoundSegments(6, 6, 'FINISHED');
    expect(done).toEqual({
      mode: 'discrete',
      segments: ['completed', 'completed', 'completed', 'completed', 'completed', 'completed'],
      progressRatio: 1,
      completedCount: 6,
      totalRounds: 6,
    });
  });

  it('switches to continuous mode when rounds exceed MAX_DISCRETE_ROUND_SEGMENTS', () => {
    expect(MAX_DISCRETE_ROUND_SEGMENTS).toBe(12);
    const large = resolveRoundSegments(5, 20, 'WORK');
    expect(large).toEqual({
      mode: 'continuous',
      segments: [],
      progressRatio: 0.25,
      completedCount: 5,
      totalRounds: 20,
    });
  });
});

describe('resolveProTimerPalette (AUTO mode) & computeSecondsNegativeBarPct', () => {
  it('transitions WORK proportionally from green to orange to red and highlights urgent <= 9s', () => {
    const firstThird = resolveProTimerPalette('WORK', 161, 0.1);
    expect(firstThird.isUrgent).toBe(false);
    expect(firstThird.hex).toBe('#00E676');
    expect(firstThird.rgb).toBe('0, 230, 118');
    expect(firstThird.secondsColor).toBe('#ffffff');

    const middleThird = resolveProTimerPalette('WORK', 90, 0.5);
    expect(middleThird.isUrgent).toBe(false);
    expect(middleThird.hex).toBe('#FF9100');
    expect(middleThird.rgb).toBe('255, 145, 0');
    expect(middleThird.secondsColor).toBe('#ffffff');

    const finalThird = resolveProTimerPalette('WORK', 20, 0.9);
    expect(finalThird.isUrgent).toBe(false);
    expect(finalThird.hex).toBe('#FF3B30');
    expect(finalThird.rgb).toBe('255, 59, 48');
    expect(finalThird.secondsColor).toBe('#ffffff');

    expect(resolveProTimerPalette('WORK', 10, 0.94).isUrgent).toBe(false);

    expect(resolveProTimerPalette('WORK', 9, 0.95)).toEqual({
      isUrgent: true,
      hex: '#ff4d4d',
      rgb: '255, 77, 77',
      footerTopHex: '#ff6e6e',
      footerControlBg: '#380a0a',
      secondsColor: '#ff4d4d',
    });

    expect(resolveProTimerPalette('WORK', 1, 0.99).isUrgent).toBe(true);
    expect(resolveProTimerPalette('WORK', 0, 1).isUrgent).toBe(false);
  });

  it('transitions REST from blue to cyan, keeps PREP amber (never urgent), and IDLE/FINISHED green', () => {
    const restStart = resolveProTimerPalette('REST', 50, 0.2);
    expect(restStart.isUrgent).toBe(false);
    expect(restStart.hex).toBe('#2979FF');
    expect(restStart.rgb).toBe('41, 121, 255');
    expect(restStart.secondsColor).toBe('#ffffff');

    const restEnd = resolveProTimerPalette('REST', 5, 0.8);
    expect(restEnd.isUrgent).toBe(false);
    expect(restEnd.hex).toBe('#00E5FF');
    expect(restEnd.rgb).toBe('0, 229, 255');
    expect(restEnd.secondsColor).toBe('#ffffff');

    const prep = resolveProTimerPalette('PREP', 3, 0.7);
    expect(prep.isUrgent).toBe(false);
    expect(prep.hex).toBe('#FFAB00');
    expect(prep.rgb).toBe('255, 171, 0');
    expect(prep.secondsColor).toBe('#ffffff');

    expect(resolveProTimerPalette('IDLE', 180, 0).hex).toBe('#00E676');
    expect(resolveProTimerPalette('FINISHED', 0, 1).hex).toBe('#00E676');
  });

  it('computes the negative black seconds cutout matching timer.md formulas', () => {
    expect(computeSecondsNegativeBarPct(161, 'WORK')).toBeCloseTo(31.6667, 2);
    expect(computeSecondsNegativeBarPct(127, 'WORK')).toBeCloseTo(88.3333, 2);
    expect(computeSecondsNegativeBarPct(180, 'WORK')).toBe(0);
    expect(computeSecondsNegativeBarPct(1, 'WORK')).toBeCloseTo(98.3333, 2);
    expect(computeSecondsNegativeBarPct(180, 'IDLE')).toBe(0);
    expect(computeSecondsNegativeBarPct(0, 'FINISHED')).toBe(100);
  });
});

describe('soundEngine.subscribeStartGong synchronization', () => {
  afterEach(() => {
    soundEngine.stopAllVoice();
    soundEngine.setMode('VOICE_GONG');
  });

  it('notifies subscribers immediately on GONG_ONLY playHajime and stops notifying after unsubscribe', () => {
    let calls = 0;
    const unsubscribe = soundEngine.subscribeStartGong(() => {
      calls += 1;
    });

    soundEngine.setMode('GONG_ONLY');
    soundEngine.playHajime();
    expect(calls).toBe(1);

    unsubscribe();
    soundEngine.playHajime();
    expect(calls).toBe(1);
  });
});

describe('Event haptics preference and synchronized vibration patterns', () => {
  const originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  beforeEach(() => {
    installMemoryWindowStorage();
    setSoundEventHapticsEnabled(true);
  });

  afterEach(() => {
    cancelSoundEventHaptics();
    setSoundEventHapticsEnabled(true);
    if (originalNavigatorDesc) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDesc);
    }
  });

  it('defaults event haptics to true and persists toggle false/true round-trip', () => {
    expect(DEFAULT_EVENT_HAPTICS_ENABLED).toBe(true);
    expect(loadEventHapticsEnabled()).toBe(true);

    saveEventHapticsEnabled(false);
    expect(loadEventHapticsEnabled()).toBe(false);

    saveEventHapticsEnabled(true);
    expect(loadEventHapticsEnabled()).toBe(true);

    expect(DEFAULT_VU_METER_MODE).toBe('LOCAL_PLAYER');
    expect(loadVuMeterMode()).toBe('LOCAL_PLAYER');
    saveVuMeterMode('PLAYBACK_CAPTURE');
    expect(loadVuMeterMode()).toBe('PLAYBACK_CAPTURE');
    saveVuMeterMode('SESSION_VISUALIZER');
    expect(loadVuMeterMode()).toBe('SESSION_VISUALIZER');
    saveVuMeterMode('OFF');
    expect(loadVuMeterMode()).toBe('OFF');
  });

  it('triggers synchronized vibration patterns when enabled and stays silent when disabled', () => {
    const vibrateMock = vi.fn(() => true);
    Object.defineProperty(globalThis, 'navigator', {
      value: { vibrate: vibrateMock },
      writable: true,
      configurable: true,
    });

    expect(isSoundEventHapticsEnabled()).toBe(true);

    triggerSoundEventHaptic('START_GONG');
    expect(vibrateMock).toHaveBeenLastCalledWith([240, 60, 110]);

    triggerSoundEventHaptic('WARNING_BELL');
    expect(vibrateMock).toHaveBeenLastCalledWith([150]);

    triggerSoundEventHaptic('END_BELL');
    expect(vibrateMock).toHaveBeenLastCalledWith([115, 125, 115, 125, 185]);

    setSoundEventHapticsEnabled(false);
    expect(isSoundEventHapticsEnabled()).toBe(false);
    expect(vibrateMock).toHaveBeenLastCalledWith(0);

    vibrateMock.mockClear();
    triggerSoundEventHaptic('START_GONG');
    triggerSoundEventHaptic('WARNING_BELL');
    triggerSoundEventHaptic('END_BELL');
    expect(vibrateMock).not.toHaveBeenCalled();
  });
});
