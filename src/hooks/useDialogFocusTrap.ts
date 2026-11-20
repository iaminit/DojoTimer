import { useEffect, useRef, type RefObject } from 'react';
import { cycleDialogFocusIndex } from '../utils/keyboardShortcuts';

export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function isElementVisibleForFocus(el: HTMLElement): boolean {
  if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true' || el.hidden) {
    return false;
  }
  return el.getClientRects().length > 0;
}

export interface UseDialogFocusTrapOptions {
  isOpen: boolean;
  containerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  onEscape?: () => void;
}

export function useDialogFocusTrap({
  isOpen,
  containerRef,
  initialFocusRef,
  fallbackFocusRef,
  onEscape,
}: UseDialogFocusTrapOptions): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  const fallbackRef = useRef(fallbackFocusRef);
  fallbackRef.current = fallbackFocusRef;

  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  const restoreFocus = () => {
    const previous = previousFocusRef.current;
    previousFocusRef.current = null;
    if (previous && previous.isConnected) {
      previous.focus();
      return;
    }
    const fallback = fallbackRef.current?.current;
    if (fallback && fallback.isConnected) {
      fallback.focus();
    }
  };

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      wasOpenRef.current = true;

      const initialTarget = initialFocusRef?.current;
      if (initialTarget && initialTarget.isConnected) {
        initialTarget.focus();
      } else {
        const container = containerRef.current;
        if (container) {
          const focusables = Array.from(
            container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
          ).filter(isElementVisibleForFocus);
          if (focusables.length > 0) {
            focusables[0].focus();
          } else if (container.hasAttribute('tabindex')) {
            container.focus();
          }
        }
      }
      return;
    }

    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      restoreFocus();
    }
  }, [containerRef, initialFocusRef, isOpen]);

  useEffect(() => {
    return () => {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        restoreFocus();
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.key === 'Escape') {
        if (e.repeat) return;
        if (onEscapeRef.current) {
          e.preventDefault();
          onEscapeRef.current();
        }
        return;
      }

      if (e.code === 'Tab' || e.key === 'Tab') {
        const container = containerRef.current;
        if (!container) return;
        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter(isElementVisibleForFocus);
        if (focusables.length === 0) return;

        e.preventDefault();
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const currentIdx = active ? focusables.indexOf(active) : -1;
        const nextIdx = cycleDialogFocusIndex(currentIdx, focusables.length, e.shiftKey);
        focusables[nextIdx]?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [containerRef, isOpen]);
}
