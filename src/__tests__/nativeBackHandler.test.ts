import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetBackHandlersForTest,
  dispatchNativeBack,
  installGlobalNativeBackBridge,
  registerBackHandler,
} from '../services/nativeBackHandler';

describe('nativeBackHandler priority dispatcher', () => {
  afterEach(() => {
    _resetBackHandlersForTest();
  });

  it('returns false when no handler is registered', () => {
    expect(dispatchNativeBack()).toBe(false);
  });

  it('invokes higher priority handlers before lower priority ones and stops on true', () => {
    const order: string[] = [];

    registerBackHandler(() => {
      order.push('setup');
      return true;
    }, 20);

    registerBackHandler(() => {
      order.push('modal');
      return true;
    }, 60);

    registerBackHandler(() => {
      order.push('timer');
      return true;
    }, 30);

    expect(dispatchNativeBack()).toBe(true);
    expect(order).toEqual(['modal']);
  });

  it('breaks equal-priority ties in LIFO order and falls through when handler returns false', () => {
    const calls: string[] = [];

    registerBackHandler(() => {
      calls.push('base');
      return true;
    }, 20);

    registerBackHandler(() => {
      calls.push('first-equal');
      return false;
    }, 50);

    registerBackHandler(() => {
      calls.push('second-equal');
      return false;
    }, 50);

    expect(dispatchNativeBack()).toBe(true);
    expect(calls).toEqual(['second-equal', 'first-equal', 'base']);
  });

  it('supports idempotent unsubscribe and isolates throwing handlers', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls: string[] = [];

    const unsubLow = registerBackHandler(() => {
      calls.push('low');
      return true;
    }, 10);

    registerBackHandler(() => {
      calls.push('broken');
      throw new Error('boom');
    }, 50);

    expect(dispatchNativeBack()).toBe(true);
    expect(calls).toEqual(['broken', 'low']);

    unsubLow();
    unsubLow();
    _resetBackHandlersForTest();
    expect(dispatchNativeBack()).toBe(false);
    spy.mockRestore();
  });

  it('attaches __dojoHandleNativeBack bridge to the target window object', () => {
    const fakeWindow: { __dojoHandleNativeBack?: () => boolean } = {};
    installGlobalNativeBackBridge(fakeWindow);
    expect(typeof fakeWindow.__dojoHandleNativeBack).toBe('function');
    expect(fakeWindow.__dojoHandleNativeBack?.()).toBe(false);

    registerBackHandler(() => true, 40);
    expect(fakeWindow.__dojoHandleNativeBack?.()).toBe(true);
  });
});
