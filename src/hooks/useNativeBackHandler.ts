import { useEffect, useRef } from 'react';
import { registerBackHandler, type BackHandler } from '../services/nativeBackHandler';

export function useNativeBackHandler(
  enabled: boolean,
  handler: BackHandler,
  priority = 0,
): void {
  const handlerRef = useRef<BackHandler>(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    return registerBackHandler(() => handlerRef.current(), priority);
  }, [enabled, priority]);
}
