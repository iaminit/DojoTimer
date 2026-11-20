import { describe, expect, it, vi } from 'vitest';
import { createSwUpdateGuard } from '../services/swUpdateGuard';

describe('swUpdateGuard protects active timer sessions from mid-round reloads', () => {
  it('reloads immediately and only once when outside active timer', () => {
    const onReload = vi.fn();
    const guard = createSwUpdateGuard(onReload);

    guard.notifyControllerChange();
    guard.notifyControllerChange();

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(guard.hasPendingReload()).toBe(false);
  });

  it('defers reload while TIMER screen is active and reloads as soon as session exits', () => {
    const onReload = vi.fn();
    const guard = createSwUpdateGuard(onReload);

    guard.setTimerSessionActive(true);
    guard.notifyControllerChange();
    guard.notifyControllerChange();

    expect(guard.isTimerSessionActive()).toBe(true);
    expect(guard.hasPendingReload()).toBe(true);
    expect(onReload).not.toHaveBeenCalled();

    guard.setTimerSessionActive(false);
    expect(guard.isTimerSessionActive()).toBe(false);
    expect(guard.hasPendingReload()).toBe(false);
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
