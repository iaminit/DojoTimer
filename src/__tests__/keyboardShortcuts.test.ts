import { describe, expect, it } from 'vitest';
import {
  cycleDialogFocusIndex,
  shouldTriggerTimerSpaceShortcut,
} from '../utils/keyboardShortcuts';

describe('keyboardShortcuts utilities', () => {
  it('guards global Space shortcut to clean single-press timer interactions only', () => {
    const valid = {
      screen: 'TIMER',
      code: 'Space',
      repeat: false,
      isFormField: false,
      hasOpenDialog: false,
      isInteractiveControl: false,
    };

    expect(shouldTriggerTimerSpaceShortcut(valid)).toBe(true);
    expect(shouldTriggerTimerSpaceShortcut({ ...valid, screen: 'SETUP' })).toBe(false);
    expect(shouldTriggerTimerSpaceShortcut({ ...valid, code: 'Enter' })).toBe(false);
    expect(shouldTriggerTimerSpaceShortcut({ ...valid, repeat: true })).toBe(false);
    expect(shouldTriggerTimerSpaceShortcut({ ...valid, isFormField: true })).toBe(false);
    expect(shouldTriggerTimerSpaceShortcut({ ...valid, hasOpenDialog: true })).toBe(false);
    expect(shouldTriggerTimerSpaceShortcut({ ...valid, isInteractiveControl: true })).toBe(false);
  });

  it('cycles dialog focus indices cleanly forward, backward, and with wrap-around', () => {
    expect(cycleDialogFocusIndex(0, 0, false)).toBe(-1);
    expect(cycleDialogFocusIndex(0, 1, false)).toBe(0);
    expect(cycleDialogFocusIndex(0, 1, true)).toBe(0);

    expect(cycleDialogFocusIndex(0, 3, false)).toBe(1);
    expect(cycleDialogFocusIndex(2, 3, false)).toBe(0);
    expect(cycleDialogFocusIndex(0, 3, true)).toBe(2);
    expect(cycleDialogFocusIndex(2, 3, true)).toBe(1);

    expect(cycleDialogFocusIndex(-1, 3, false)).toBe(0);
    expect(cycleDialogFocusIndex(-1, 3, true)).toBe(2);
    expect(cycleDialogFocusIndex(5, 3, false)).toBe(0);
  });
});
