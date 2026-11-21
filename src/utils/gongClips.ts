export type GongClipId = 'karateka' | 'sumotori' | 'judoka';

export interface GongVideoClip {
  id: GongClipId;
  label: string;
  /** Percorso relativo a `BASE_URL` (es. `video/gong-karateka.mp4`). */
  assetPath: string;
  /** Durata totale della clip in millisecondi. */
  durationMs: number;
  /** Istante esatto in millisecondi dal frame 0 in cui il colpo/mazzuolo colpisce il gong. */
  impactMs: number;
}

/**
 * Catalogo completo delle 3 animazioni gong in rotazione casuale:
 * Karateka (pugno), Judoka (colpo a palmo aperto), Sumotori (mazzuolo).
 */
export const ACTIVE_GONG_CLIPS: readonly GongVideoClip[] = [
  {
    id: 'karateka',
    label: 'Karateka',
    assetPath: 'video/gong-karateka.mp4',
    durationMs: 3000,
    impactMs: 1240,
  },
  {
    id: 'judoka',
    label: 'Judoka',
    assetPath: 'video/gong-judoka.mp4',
    durationMs: 3000,
    impactMs: 1240,
  },
  {
    id: 'sumotori',
    label: 'Sumotori',
    assetPath: 'video/gong-sumotori.mp4',
    durationMs: 3000,
    impactMs: 1340,
  },
] as const;

export const MAX_GONG_CLIP_IMPACT_MS = ACTIVE_GONG_CLIPS.reduce(
  (max, clip) => Math.max(max, clip.impactMs),
  0,
);

export function resolveGongClipUrl(
  assetPath: string,
  baseUrl: string = import.meta.env?.BASE_URL ?? '/',
): string {
  const normalizedBase = baseUrl.replace(/\/?$/, '/');
  const cleanAsset = assetPath.replace(/^\/+/, '');
  return `${normalizedBase}${cleanAsset}`;
}

/**
 * Sceglie casualmente una clip gong evitando due ripetizioni consecutive identiche
 * quando ci sono almeno 2 clip disponibili.
 */
export function pickRandomGongClip(
  clips: readonly GongVideoClip[] = ACTIVE_GONG_CLIPS,
  lastClipId: GongClipId | null = null,
  rng: () => number = Math.random,
): GongVideoClip | null {
  if (clips.length === 0) {
    return null;
  }
  if (clips.length === 1) {
    return clips[0];
  }
  const pool = lastClipId ? clips.filter((c) => c.id !== lastClipId) : clips;
  const candidates = pool.length > 0 ? pool : clips;
  const raw = rng();
  const safeRng = Number.isFinite(raw) ? Math.min(0.999999, Math.max(0, raw)) : 0;
  const idx = Math.floor(safeRng * candidates.length);
  return candidates[idx] ?? candidates[0];
}

export interface GongClipSyncPlan {
  /** Millisecondi da attendere prima di avviare il video (se pre-avvisato prima di `impactMs`). */
  delayBeforeStartMs: number;
  /** Posizione iniziale del video in secondi (0 se pre-avvisato in tempo, >0 se gong imminente). */
  startOffsetSec: number;
  /** Durata residua effettiva di riproduzione in millisecondi. */
  playDurationMs: number;
  /** Dopo quanti ms dall'avvio iniziare il fade-out morbido. */
  fadeOutAtMs: number;
}

/**
 * Calcola il piano di sincronizzazione esatto tra la clip video e l'attacco sonoro di `gong.mp3`:
 * - Se `msUntilGong >= clip.impactMs`: attende `msUntilGong - clip.impactMs` e parte dal frame 0,
 *   così il colpo visivo coincide al millisecondo con il gong.
 * - Se `msUntilGong < clip.impactMs` (es. avvio diretto senza preparazione): salta al punto
 *   esatto del caricamento (`impactMs - msUntilGong`) così il colpo visivo combacia comunque!
 */
export function computeGongClipSyncPlan(
  clip: GongVideoClip,
  msUntilGong: number,
): GongClipSyncPlan {
  const safeUntilMs = Math.max(0, Math.round(msUntilGong));
  let delayBeforeStartMs = 0;
  let startOffsetMs = 0;

  if (safeUntilMs >= clip.impactMs) {
    delayBeforeStartMs = safeUntilMs - clip.impactMs;
    startOffsetMs = 0;
  } else if (safeUntilMs === 0) {
    // Avvio istantaneo senza anticipo (Solo Gong con prep=0): parti 80ms prima del contatto per impatto immediato
    startOffsetMs = Math.max(0, clip.impactMs - 80);
  } else {
    startOffsetMs = Math.max(0, clip.impactMs - safeUntilMs);
  }

  const maxOffsetMs = Math.max(0, clip.durationMs - 400);
  const clampedOffsetMs = Math.min(maxOffsetMs, startOffsetMs);
  const playDurationMs = Math.max(400, clip.durationMs - clampedOffsetMs);
  const fadeOutAtMs = Math.max(250, playDurationMs - 420);

  return {
    delayBeforeStartMs,
    startOffsetSec: Number((clampedOffsetMs / 1000).toFixed(3)),
    playDurationMs,
    fadeOutAtMs,
  };
}
