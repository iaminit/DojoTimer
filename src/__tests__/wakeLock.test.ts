import { describe, expect, it, vi } from 'vitest';
import {
  createWakeLockController,
  type WakeLockNavigatorLike,
  type WakeLockSentinelLike,
} from '../services/wakeLockManager';

function createFakeSentinel() {
  let released = false;
  const listeners = new Set<() => void>();
  const sentinel: WakeLockSentinelLike = {
    get released() {
      return released;
    },
    release: vi.fn(async () => {
      if (released) return;
      released = true;
      for (const listener of [...listeners]) {
        listener();
      }
    }),
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };
  return {
    sentinel,
    forceSystemDrop: () => {
      released = true;
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

describe('wakeLockManager always-on screen controller', () => {
  it('acquires screen lock, deduplicates concurrent calls, and retries after pre-gesture failure', async () => {
    const fake1 = createFakeSentinel();
    const fake2 = createFakeSentinel();
    const doc = { visibilityState: 'visible' as DocumentVisibilityState };

    let shouldFail = true;
    let callCount = 0;
    const nav: WakeLockNavigatorLike = {
      wakeLock: {
        request: vi.fn(async () => {
          callCount += 1;
          if (shouldFail) {
            throw new DOMException('User gesture required', 'NotAllowedError');
          }
          return callCount === 2 ? fake1.sentinel : fake2.sentinel;
        }),
      },
    };

    const lockedStates: boolean[] = [];
    const controller = createWakeLockController({
      nav,
      doc,
      onChange: (locked) => lockedStates.push(locked),
    });

    expect(controller.isSupported).toBe(true);

    // Pre-gesture rejection leaves controller unlocked and ready for retry
    await controller.setActive(true);
    expect(controller.isLocked()).toBe(false);
    expect(callCount).toBe(1);

    // Next user gesture retries cleanly and locks screen; concurrent acquire() shares in-flight call
    shouldFail = false;
    const [okA, okB] = await Promise.all([controller.acquire(), controller.acquire()]);
    expect(okA).toBe(true);
    expect(okB).toBe(true);
    expect(callCount).toBe(2);
    expect(controller.isLocked()).toBe(true);

    // System drop while visible automatically re-acquires a fresh sentinel
    fake1.forceSystemDrop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(callCount).toBe(3);
    expect(controller.isLocked()).toBe(true);

    // Explicit dispose releases without triggering re-acquisition
    await controller.dispose();
    expect(callCount).toBe(3);
    expect(controller.isLocked()).toBe(false);
    expect(lockedStates[lockedStates.length - 1]).toBe(false);
  });

  it('defers acquisition while hidden and acquires as soon as page becomes visible', async () => {
    const fake = createFakeSentinel();
    const doc = { visibilityState: 'hidden' as DocumentVisibilityState };
    const nav: WakeLockNavigatorLike = {
      wakeLock: {
        request: vi.fn(async () => fake.sentinel),
      },
    };

    const controller = createWakeLockController({ nav, doc });
    await controller.setActive(true);
    expect(controller.isLocked()).toBe(false);
    expect(nav.wakeLock!.request).not.toHaveBeenCalled();

    doc.visibilityState = 'visible';
    const ok = await controller.acquire();
    expect(ok).toBe(true);
    expect(controller.isLocked()).toBe(true);
    expect(nav.wakeLock!.request).toHaveBeenCalledTimes(1);
  });
});
