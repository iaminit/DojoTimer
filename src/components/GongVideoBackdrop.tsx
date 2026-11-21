import { useCallback, useEffect, useRef, useState } from 'react';
import { soundEngine, type GongVisualCueEvent } from '../services/soundEngine';
import {
  ACTIVE_GONG_CLIPS,
  computeGongClipSyncPlan,
  pickRandomGongClip,
  resolveGongClipUrl,
  type GongClipId,
} from '../utils/gongClips';

interface GongVideoBackdropProps {
  isPaused: boolean;
  isFinished: boolean;
}

interface GongVideoBackdropCallbacks {
  onActiveChange?: (isActive: boolean) => void;
}

interface ActivePlaybackState {
  clipId: GongClipId;
  fadingOut: boolean;
}

/**
 * Sfondo cinematografico sincronizzato al millisecondo con il gong di inizio round:
 * - Sceglie **1 sola animazione casuale** per round tra Karateka, Judoka e Sumotori
 *   (senza ripetere due volte consecutive la stessa e senza mai sovrapporne/sostituirne due).
 * - Il pre-cue di `useTimerEngine` avvia il caricamento prima del gong; quando `playHajime()` /
 *   `playStartGong()` scatta, l'animazione già in corso prosegue indisturbata (eventuale micro-sync
 *   con `playbackRate` morbido) così il pugno/palmo/mazzuolo colpisce il gong nello stesso istante
 *   esatto di `gong.mp3`.
 */
export function GongVideoBackdrop({
  isPaused,
  isFinished,
  onActiveChange,
}: GongVideoBackdropProps & GongVideoBackdropCallbacks) {
  const [activePlayback, setActivePlayback] = useState<ActivePlaybackState | null>(null);
  const videoRefs = useRef<Partial<Record<GongClipId, HTMLVideoElement | null>>>({});
  const lastClipIdRef = useRef<GongClipId | null>(null);
  const activeClipIdRef = useRef<GongClipId | null>(null);
  const activeGongTargetPerfRef = useRef<number>(0);
  const startTimerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const onActiveChangeRef = useRef(onActiveChange);
  onActiveChangeRef.current = onActiveChange;

  useEffect(() => {
    onActiveChangeRef.current?.(Boolean(activePlayback && !activePlayback.fadingOut));
  }, [activePlayback]);

  useEffect(() => {
    return () => {
      onActiveChangeRef.current?.(false);
    };
  }, []);

  const clearTimers = useCallback(() => {
    if (startTimerRef.current !== null) {
      window.clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
    if (fadeTimerRef.current !== null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const stopAllPlayback = useCallback(() => {
    clearTimers();
    activeClipIdRef.current = null;
    activeGongTargetPerfRef.current = 0;
    setActivePlayback(null);
    for (const clip of ACTIVE_GONG_CLIPS) {
      const el = videoRefs.current[clip.id];
      if (el) {
        try {
          el.pause();
          el.playbackRate = 1;
        } catch {
          // Ignore pause errors
        }
      }
    }
  }, [clearTimers]);

  useEffect(() => {
    if (isPaused || isFinished) {
      stopAllPlayback();
    }
  }, [isFinished, isPaused, stopAllPlayback]);

  useEffect(() => {
    const handleCue = (cue: GongVisualCueEvent) => {
      const now = performance.now();
      const targetGongPerf = now + Math.max(0, cue.msUntilGong);

      // Blocco rigoroso 1 animazione alla volta: se un'animazione è già prenotata o in corso
      // per questo gong (es. pre-cue già partito prima di playHajime/playStartGong), NON cambiare
      // mai personaggio — lascia finire quella singola clip, regolando dolcemente solo la velocità
      // se rileva un piccolo scarto rispetto al momento esatto del suono.
      if (activeClipIdRef.current !== null) {
        const runningClip = ACTIVE_GONG_CLIPS.find((c) => c.id === activeClipIdRef.current);
        const videoEl = runningClip ? videoRefs.current[runningClip.id] : null;
        if (runningClip && videoEl && !videoEl.paused && cue.msUntilGong > 80) {
          const remainingVideoToImpactSec = runningClip.impactMs / 1000 - videoEl.currentTime;
          const remainingAudioToImpactSec = cue.msUntilGong / 1000;
          if (remainingVideoToImpactSec > 0.08 && remainingAudioToImpactSec > 0.08) {
            const ratio = remainingVideoToImpactSec / remainingAudioToImpactSec;
            if (Math.abs(1 - ratio) > 0.04) {
              try {
                videoEl.playbackRate = Math.min(1.18, Math.max(0.85, ratio));
              } catch {
                // Ignore playbackRate errors
              }
            }
          }
        }
        return;
      }

      const clip = pickRandomGongClip(ACTIVE_GONG_CLIPS, lastClipIdRef.current);
      if (!clip) {
        return;
      }

      clearTimers();
      lastClipIdRef.current = clip.id;
      activeClipIdRef.current = clip.id;
      activeGongTargetPerfRef.current = targetGongPerf;

      const plan = computeGongClipSyncPlan(clip, cue.msUntilGong);

      const startClipNow = () => {
        startTimerRef.current = null;
        const videoEl = videoRefs.current[clip.id];
        if (!videoEl) {
          stopAllPlayback();
          return;
        }
        try {
          videoEl.playbackRate = 1;
          videoEl.currentTime = plan.startOffsetSec;
        } catch {
          // Ignore seek errors before metadata is loaded
        }
        setActivePlayback({ clipId: clip.id, fadingOut: false });
        const playPromise = videoEl.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          void playPromise.catch(() => {
            // Gracefully ignore autoplay rejection in headless tests
          });
        }

        fadeTimerRef.current = window.setTimeout(() => {
          fadeTimerRef.current = null;
          setActivePlayback((prev) =>
            prev && prev.clipId === clip.id ? { ...prev, fadingOut: true } : prev,
          );
        }, plan.fadeOutAtMs);

        hideTimerRef.current = window.setTimeout(() => {
          hideTimerRef.current = null;
          stopAllPlayback();
        }, plan.playDurationMs + 80);
      };

      if (plan.delayBeforeStartMs > 0) {
        startTimerRef.current = window.setTimeout(startClipNow, plan.delayBeforeStartMs);
      } else {
        startClipNow();
      }
    };

    const unsubCue = soundEngine.subscribeGongVisualCue(handleCue);
    const unsubCancel = soundEngine.subscribeGongVisualCancel(stopAllPlayback);
    return () => {
      unsubCue();
      unsubCancel();
      stopAllPlayback();
    };
  }, [clearTimers, stopAllPlayback]);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[1] overflow-hidden"
      aria-hidden="true"
      data-testid="gong-video-backdrop"
    >
      {ACTIVE_GONG_CLIPS.map((clip) => {
        const isCurrent = activePlayback?.clipId === clip.id;
        const isVisible = isCurrent && !activePlayback.fadingOut;
        return (
          <div
            key={clip.id}
            className="absolute inset-0 transition-opacity ease-out will-change-[opacity]"
            style={{
              opacity: isVisible ? 1 : 0,
              transitionDuration: isVisible ? '200ms' : '420ms',
            }}
          >
            <video
              ref={(el) => {
                videoRefs.current[clip.id] = el;
              }}
              src={resolveGongClipUrl(clip.assetPath)}
              muted
              playsInline
              preload="auto"
              disablePictureInPicture
              className="h-full w-full object-cover object-center landscape:object-contain"
            />
            {/* Leggera vignettatura perimetrale per stacco pulito sui bordi senza scurire il gong */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(circle at 50% 48%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.45) 100%)',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
