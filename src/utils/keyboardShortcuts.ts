export interface TimerSpaceShortcutContext {
  screen: string;
  code: string;
  repeat: boolean;
  isFormField: boolean;
  hasOpenDialog: boolean;
  isInteractiveControl: boolean;
}

/**
 * Consente l'attivazione della scorciatoia globale Spazio sul timer
 * solo su pressione singola (non repeat), fuori da campi modulo, modali o pulsanti focalizzati.
 */
export function shouldTriggerTimerSpaceShortcut({
  screen,
  code,
  repeat,
  isFormField,
  hasOpenDialog,
  isInteractiveControl,
}: TimerSpaceShortcutContext): boolean {
  if (screen !== 'TIMER' || code !== 'Space') {
    return false;
  }
  if (repeat || isFormField || hasOpenDialog || isInteractiveControl) {
    return false;
  }
  return true;
}

/**
 * Calcola il prossimo indice focalizzabile all'interno di un modal dialog con Tab / Shift+Tab.
 */
export function cycleDialogFocusIndex(
  currentIndex: number,
  count: number,
  shiftKey: boolean,
): number {
  if (count <= 0) {
    return -1;
  }
  if (currentIndex < 0 || currentIndex >= count) {
    return shiftKey ? count - 1 : 0;
  }
  return shiftKey ? (currentIndex - 1 + count) % count : (currentIndex + 1) % count;
}
