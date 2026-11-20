import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerNativeTogglePauseHandler,
  resetNativeTimerSyncCache,
  subscribeAndroidPipMode,
  syncNativeTimerState,
} from '../services/nativeAndroid';

describe('nativeAndroid PiP & tray notification bridge', () => {
  const originalWindowDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let syncMock: ReturnType<typeof vi.fn>;
  let mockWin: Record<string, unknown>;

  beforeEach(() => {
    syncMock = vi.fn();
    mockWin = {
      DojoNative: {
        syncTimerState: syncMock,
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
});
