import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exitNativeApp,
  getNativeMediaVolumePercent,
  isNativeMusicActive,
  isNativePlaybackCaptureActive,
  openNativeApkDownload,
  readNativeAudioSpectrum,
  registerNativeTogglePauseHandler,
  requestNativeAudioDucking,
  requestNativePlaybackCapture,
  resetNativeTimerSyncCache,
  setNativeVuMeterMode,
  stopNativePlaybackCapture,
  subscribeAndroidPipMode,
  syncNativeTimerState,
} from '../services/nativeAndroid';

describe('nativeAndroid PiP, tray notification, audio ducking & volume bridge', () => {
  const originalWindowDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let syncMock: ReturnType<typeof vi.fn>;
  let duckMock: ReturnType<typeof vi.fn>;
  let volumeMock: ReturnType<typeof vi.fn>;
  let openApkMock: ReturnType<typeof vi.fn>;
  let exitAppMock: ReturnType<typeof vi.fn>;
  let setVuModeMock: ReturnType<typeof vi.fn>;
  let reqCaptureMock: ReturnType<typeof vi.fn>;
  let stopCaptureMock: ReturnType<typeof vi.fn>;
  let isCaptureMock: ReturnType<typeof vi.fn>;
  let isMusicMock: ReturnType<typeof vi.fn>;
  let spectrumMock: ReturnType<typeof vi.fn>;
  let mockWin: Record<string, unknown>;

  beforeEach(() => {
    syncMock = vi.fn();
    duckMock = vi.fn();
    volumeMock = vi.fn(() => 65);
    openApkMock = vi.fn();
    exitAppMock = vi.fn();
    setVuModeMock = vi.fn();
    reqCaptureMock = vi.fn();
    stopCaptureMock = vi.fn();
    isCaptureMock = vi.fn(() => true);
    isMusicMock = vi.fn(() => true);
    spectrumMock = vi.fn(() => 'P|10,20,30,40,50,60,70,80,90,100,80,60,40,20,10,5');
    mockWin = {
      DojoNative: {
        syncTimerState: syncMock,
        requestAudioDucking: duckMock,
        getMediaVolumePercent: volumeMock,
        openOfficialApkDownload: openApkMock,
        exitApp: exitAppMock,
        setVuMeterMode: setVuModeMock,
        requestPlaybackCapture: reqCaptureMock,
        stopPlaybackCapture: stopCaptureMock,
        isPlaybackCaptureActive: isCaptureMock,
        isExternalMusicActive: isMusicMock,
        getAudioSpectrumCsv: spectrumMock,
      },
    };
    Object.defineProperty(globalThis, 'window', {
      value: mockWin,
      writable: true,
      configurable: true,
    });
    resetNativeTimerSyncCache();
  });

  afterEach(() => {
    if (originalWindowDesc) {
      Object.defineProperty(globalThis, 'window', originalWindowDesc);
    }
    resetNativeTimerSyncCache();
  });

  it('syncs discrete phase/pause changes without spamming Android notifications every normal second', () => {
    const base = {
      active: true,
      running: true,
      paused: false,
      phaseLabel: 'RANDORI',
      roundLabel: 'Round 1 / 6',
      timeText: '03:00',
      remainingMs: 180_000,
      colorHex: '#00E676',
    };

    expect(syncNativeTimerState(base, 10_000)).toBe(true);
    expect(syncMock).toHaveBeenCalledTimes(1);

    // Normal 1-second tick: Android ChronometerCountDown already counts down natively
    expect(
      syncNativeTimerState({ ...base, timeText: '02:59', remainingMs: 179_000 }, 11_000),
    ).toBe(false);
    expect(syncMock).toHaveBeenCalledTimes(1);

    // Manual scrub jump (>= 1.2s drift): immediately resyncs native Chronometer
    expect(
      syncNativeTimerState({ ...base, timeText: '02:30', remainingMs: 150_000 }, 11_200),
    ).toBe(true);
    expect(syncMock).toHaveBeenCalledTimes(2);

    // Pause updates immediately with frozen time
    expect(
      syncNativeTimerState(
        { ...base, running: false, paused: true, timeText: '02:30', remainingMs: 150_000 },
        11_500,
      ),
    ).toBe(true);
    expect(syncMock).toHaveBeenCalledTimes(3);

    // Exiting timer clears active notification and PiP auto-enter
    expect(
      syncNativeTimerState(
        {
          active: false,
          running: false,
          paused: false,
          phaseLabel: '',
          roundLabel: '',
          timeText: '00:00',
          remainingMs: 0,
          colorHex: '#FFD600',
        },
        12_000,
      ),
    ).toBe(true);
    expect(syncMock).toHaveBeenLastCalledWith(
      false,
      false,
      false,
      '',
      '',
      '00:00',
      0,
      '#FFD600',
    );
  });

  it('notifies PiP subscribers and executes registered native Play/Pause callback', () => {
    const states: boolean[] = [];
    const unsubscribePip = subscribeAndroidPipMode((isPip) => states.push(isPip));

    const setPip = mockWin.__dojoSetPipMode as (v: boolean) => void;
    expect(typeof setPip).toBe('function');

    setPip(true);
    setPip(true); // deduplicated
    setPip(false);
    unsubscribePip();

    expect(states).toEqual([false, true, false]);

    const onToggle = vi.fn();
    const unregisterToggle = registerNativeTogglePauseHandler(onToggle);
    const nativeToggle = mockWin.__dojoNativeTogglePause as () => void;
    nativeToggle();
    expect(onToggle).toHaveBeenCalledTimes(1);

    unregisterToggle();
    expect(mockWin.__dojoNativeTogglePause).toBeUndefined();
  });

  it('requests clamped transient audio ducking and reads native media volume safely', () => {
    expect(requestNativeAudioDucking(2400)).toBe(true);
    expect(duckMock).toHaveBeenLastCalledWith(2400);

    expect(requestNativeAudioDucking(50)).toBe(true);
    expect(duckMock).toHaveBeenLastCalledWith(300);

    expect(requestNativeAudioDucking(25_000)).toBe(true);
    expect(duckMock).toHaveBeenLastCalledWith(8000);

    expect(getNativeMediaVolumePercent()).toBe(65);
    volumeMock.mockReturnValueOnce(0);
    expect(getNativeMediaVolumePercent()).toBe(0);
    volumeMock.mockReturnValueOnce(-1);
    expect(getNativeMediaVolumePercent()).toBeNull();

    expect(openNativeApkDownload('https://1ms.it/timer/DojoTimer.apk')).toBe(true);
    expect(openApkMock).toHaveBeenCalledWith('https://1ms.it/timer/DojoTimer.apk');

    expect(setNativeVuMeterMode('PLAYBACK_CAPTURE')).toBe(true);
    expect(setVuModeMock).toHaveBeenCalledWith('PLAYBACK_CAPTURE');
    expect(requestNativePlaybackCapture()).toBe(true);
    expect(reqCaptureMock).toHaveBeenCalledTimes(1);
    expect(isNativePlaybackCaptureActive()).toBe(true);
    expect(isNativeMusicActive()).toBe(true);

    const bands = new Float32Array(16);
    const sample = readNativeAudioSpectrum(bands);
    expect(sample).toEqual({ mode: 'P', peak: 1 });
    expect(bands[9]).toBe(1);
    expect(bands[0]).toBeCloseTo(0.1, 2);

    expect(stopNativePlaybackCapture()).toBe(true);
    expect(stopCaptureMock).toHaveBeenCalledTimes(1);

    expect(exitNativeApp()).toBe(true);
    expect(exitAppMock).toHaveBeenCalledTimes(1);
  });
});
