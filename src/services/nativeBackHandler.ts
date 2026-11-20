export type BackHandler = () => boolean;

interface BackHandlerEntry {
  id: number;
  priority: number;
  order: number;
  handler: BackHandler;
}

const entries: BackHandlerEntry[] = [];
let nextEntryId = 1;
let nextEntryOrder = 1;

/**
 * Registers a hardware/gesture back handler with numeric priority.
 * Higher priority runs first; ties break by LIFO registration order.
 */
export function registerBackHandler(handler: BackHandler, priority = 0): () => void {
  const id = nextEntryId++;
  const entry: BackHandlerEntry = {
    id,
    priority,
    order: nextEntryOrder++,
    handler,
  };
  entries.push(entry);

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    const idx = entries.findIndex((item) => item.id === id);
    if (idx >= 0) {
      entries.splice(idx, 1);
    }
  };
}

/**
 * Invokes registered back handlers from highest priority (and latest registration)
 * downward until one returns `true` to indicate it consumed the back press.
 */
export function dispatchNativeBack(): boolean {
  if (entries.length === 0) {
    return false;
  }

  const ordered = [...entries].sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return b.order - a.order;
  });

  for (const entry of ordered) {
    try {
      if (entry.handler() === true) {
        return true;
      }
    } catch (err) {
      console.error('[DojoTimer] Back handler threw error:', err);
    }
  }

  return false;
}

export function installGlobalNativeBackBridge(target?: unknown): void {
  const host = (target ?? (typeof window !== 'undefined' ? window : undefined)) as
    | { __dojoHandleNativeBack?: () => boolean }
    | undefined;
  if (!host || typeof host !== 'object') {
    return;
  }
  host.__dojoHandleNativeBack = dispatchNativeBack;
}

export function _resetBackHandlersForTest(): void {
  entries.length = 0;
}

if (typeof window !== 'undefined') {
  installGlobalNativeBackBridge(window);
}
