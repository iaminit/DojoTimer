import { useEffect, useState } from 'react';

function formatClockHHMM(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function useCurrentClock(): string {
  const [currentTime, setCurrentTime] = useState(() => formatClockHHMM(new Date()));

  useEffect(() => {
    const syncClock = () => setCurrentTime(formatClockHHMM(new Date()));
    syncClock();
    const id = window.setInterval(syncClock, 10_000);
    return () => window.clearInterval(id);
  }, []);

  return currentTime;
}
