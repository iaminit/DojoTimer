import { useEffect, useState } from 'react';

export interface LocalMusicTrack {
  id: string;
  name: string;
  url: string;
}

export interface LocalMusicPlayerSnapshot {
  tracks: LocalMusicTrack[];
  currentIndex: number;
  isPlaying: boolean;
  volume: number; // 0..100
}

type CaptureCapableAudioElement = HTMLAudioElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

type RoutingMode = 'none' | 'capture-stream' | 'media-element';

// Confini logaritmici per 16 bande musicali su AnalyserNode (fftSize 256 -> 128 bin)
const LOG_BIN_EDGES_128 = [
  1, 2, 3, 4, 6, 8, 11, 15, 20, 27, 36, 48, 63, 81, 102, 120, 127,
] as const;

const AUDIO_EXT_RE = /\.(mp3|m4a|wav|ogg|flac|aac|opus|webm)$/i;
const VOLUME_STORAGE_KEY = 'dojo_timer_local_music_volume_v1';
// Headroom -1.4 dB solo nel fallback Web Audio (Safari) per impedire clipping su picchi inter-sample MP3
const WEBAUDIO_FALLBACK_HEADROOM = 0.85;
const DUCK_RATIO = 0.28;

function loadSavedVolume(): number {
  try {
    const raw =
      typeof window !== 'undefined' ? window.localStorage?.getItem(VOLUME_STORAGE_KEY) : null;
    const parsed = raw !== null ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed)) {
      return Math.min(100, Math.max(0, parsed));
    }
  } catch {
    // Ignore storage errors
  }
  return 85;
}

function saveVolume(vol: number): void {
  try {
    window.localStorage?.setItem(VOLUME_STORAGE_KEY, String(vol));
  } catch {
    // Ignore
  }
}

function cleanTrackTitle(fileName: string): string {
  return (
    fileName.replace(AUDIO_EXT_RE, '').replace(/[_]+/g, ' ').trim().slice(0, 64) || 'Traccia'
  );
}

function getCaptureStreamFn(el: HTMLAudioElement): (() => MediaStream) | null {
  const capEl = el as CaptureCapableAudioElement;
  if (typeof capEl.captureStream === 'function') {
    return capEl.captureStream;
  }
  if (typeof capEl.mozCaptureStream === 'function') {
    return capEl.mozCaptureStream;
  }
  return null;
}

function createPlaybackAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    return null;
  }
  try {
    return new AudioCtx({ latencyHint: 'playback' });
  } catch {
    try {
      return new AudioCtx();
    } catch {
      return null;
    }
  }
}

/**
 * Player audio/MP3 locale integrato in Dojo Timer — architettura zero-distorsione:
 * - Su Chrome / Edge / Android WebView / Firefox: `<audio>` riproduce al 100% attraverso il
 *   motore audio nativo di sistema (mai intercettato da `createMediaElementSource`), mentre
 *   il VU meter legge uno side-chain `captureStream()` -> `AnalyserNode` -> `Gain(0)`.
 *   Nessun campione Web Audio esce dagli altoparlanti -> zero crackle, zero drift, zero clipping.
 * - Su Safari (senza `captureStream`): usa `AudioContext({ latencyHint: 'playback' })` con
 *   headroom -1.4 dB + `DynamicsCompressorNode` limiter trasparente e `AnalyserNode` in parallelo.
 * - Ducking automatico morbido (`duck(durationMs)`) durante gong, campanelle e voci del timer.
 */
export class LocalMusicPlayer {
  private audioEl: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private routingMode: RoutingMode = 'none';

  // Side-chain read-only (Chrome / Android WebView / Firefox)
  private captureStream: MediaStream | null = null;
  private captureAddTrackHandler: (() => void) | null = null;
  private streamSourceNode: MediaStreamAudioSourceNode | null = null;
  private silentGainNode: GainNode | null = null;
  private lastStreamAttachAttemptAt = 0;

  // Fallback Web Audio (Safari)
  private mediaElementSourceNode: MediaElementAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private limiterNode: DynamicsCompressorNode | null = null;

  private analyser: AnalyserNode | null = null;
  private bins: Uint8Array<ArrayBuffer> | null = null;

  private tracks: LocalMusicTrack[] = [];
  private currentIndex = -1;
  private isPlaying = false;
  private volume = loadSavedVolume();
  private duckTimeoutId: number | null = null;
  private volumeRampRafId: number | null = null;
  private isDucked = false;
  private trackSeq = 0;

  private listeners = new Set<() => void>();
  private snapshot: LocalMusicPlayerSnapshot = {
    tracks: [],
    currentIndex: -1,
    isPlaying: false,
    volume: this.volume,
  };

  private emit(): void {
    this.snapshot = {
      tracks: this.tracks,
      currentIndex: this.currentIndex,
      isPlaying: this.isPlaying,
      volume: this.volume,
    };
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Isolate UI errors
      }
    }
  }

  public getSnapshot(): LocalMusicPlayerSnapshot {
    return this.snapshot;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private targetVolumeRatio(): number {
    const base = this.volume / 100;
    return this.isDucked ? base * DUCK_RATIO : base;
  }

  private ensureAudioElement(): HTMLAudioElement | null {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') {
      return null;
    }
    if (!this.audioEl) {
      const el = new Audio();
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      el.volume = Math.min(1, Math.max(0, this.targetVolumeRatio()));

      if (typeof document !== 'undefined' && document.body) {
        try {
          el.style.display = 'none';
          el.setAttribute('aria-hidden', 'true');
          el.setAttribute('data-dojo-local-music', '1');
          document.body.appendChild(el);
        } catch {
          // Ignore DOM attachment failures in minimal test environments
        }
      }

      el.addEventListener('play', () => {
        this.isPlaying = true;
        this.emit();
      });
      el.addEventListener('playing', () => {
        this.isPlaying = true;
        this.ensureAnalyserPipeline();
        this.emit();
      });
      el.addEventListener('pause', () => {
        this.isPlaying = false;
        this.emit();
      });
      el.addEventListener('ended', () => {
        if (this.tracks.length > 0) {
          this.nextTrack(true);
        }
      });
      el.addEventListener('error', () => {
        this.isPlaying = false;
        this.emit();
      });
      this.audioEl = el;
    }
    return this.audioEl;
  }

  private detachCaptureStreamSource(): void {
    if (this.captureStream && this.captureAddTrackHandler) {
      try {
        this.captureStream.removeEventListener('addtrack', this.captureAddTrackHandler);
      } catch {
        // Ignore
      }
    }
    this.captureAddTrackHandler = null;
    this.captureStream = null;
    if (this.streamSourceNode) {
      try {
        this.streamSourceNode.disconnect();
      } catch {
        // Ignore
      }
      this.streamSourceNode = null;
    }
  }

  private ensureAnalyserNodes(ctx: AudioContext): boolean {
    if (!this.analyser) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      this.analyser = analyser;
      this.bins = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    }
    return true;
  }

  private attachCaptureStreamSidechain(el: HTMLAudioElement, captureFn: () => MediaStream): boolean {
    if (!this.ctx) {
      const ctx = createPlaybackAudioContext();
      if (!ctx) {
        return false;
      }
      this.ctx = ctx;
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    this.ensureAnalyserNodes(this.ctx);

    if (!this.silentGainNode && this.analyser) {
      const silentGain = this.ctx.createGain();
      // Gain = 0 garantisce che ZERO audio passi dal Web Audio agli speaker:
      // l'audio udibile resta al 100% sul motore nativo `<audio>`.
      silentGain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.analyser.connect(silentGain);
      silentGain.connect(this.ctx.destination);
      this.silentGainNode = silentGain;
    }

    // Se lo stream catturato ha già una traccia audio live collegata, non ricrearlo
    const existingHasLiveTrack =
      this.captureStream !== null &&
      this.streamSourceNode !== null &&
      this.captureStream.getAudioTracks().some((t) => t.readyState === 'live');
    if (existingHasLiveTrack) {
      this.routingMode = 'capture-stream';
      return true;
    }

    try {
      this.detachCaptureStreamSource();
      const stream = captureFn.call(el);
      this.captureStream = stream;
      this.routingMode = 'capture-stream';

      const connectIfLive = (): boolean => {
        if (!this.ctx || !this.analyser || this.captureStream !== stream) {
          return false;
        }
        const hasLive = stream.getAudioTracks().some((t) => t.readyState === 'live');
        if (!hasLive) {
          return false;
        }
        if (this.streamSourceNode) {
          try {
            this.streamSourceNode.disconnect();
          } catch {
            // Ignore
          }
          this.streamSourceNode = null;
        }
        try {
          const src = this.ctx.createMediaStreamSource(stream);
          src.connect(this.analyser);
          this.streamSourceNode = src;
          return true;
        } catch {
          return false;
        }
      };

      if (!connectIfLive() && typeof stream.addEventListener === 'function') {
        const onAddTrack = () => {
          if (connectIfLive()) {
            try {
              stream.removeEventListener('addtrack', onAddTrack);
            } catch {
              // Ignore
            }
            if (this.captureAddTrackHandler === onAddTrack) {
              this.captureAddTrackHandler = null;
            }
          }
        };
        this.captureAddTrackHandler = onAddTrack;
        stream.addEventListener('addtrack', onAddTrack);
      }
      return true;
    } catch {
      this.detachCaptureStreamSource();
      return false;
    }
  }

  private attachSafariMediaElementFallback(el: HTMLAudioElement): boolean {
    if (this.routingMode === 'media-element' && this.mediaElementSourceNode && this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
      return true;
    }

    if (!this.ctx) {
      const ctx = createPlaybackAudioContext();
      if (!ctx) {
        el.volume = Math.min(1, Math.max(0, this.targetVolumeRatio()));
        return false;
      }
      this.ctx = ctx;
    }

    try {
      const ctx = this.ctx;
      const source = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(
        Math.min(1, Math.max(0, this.targetVolumeRatio())) * WEBAUDIO_FALLBACK_HEADROOM,
        ctx.currentTime,
      );

      this.ensureAnalyserNodes(ctx);

      let outputTail: AudioNode = gain;
      if (typeof ctx.createDynamicsCompressor === 'function') {
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.setValueAtTime(-2, ctx.currentTime);
        limiter.knee.setValueAtTime(6, ctx.currentTime);
        limiter.ratio.setValueAtTime(10, ctx.currentTime);
        limiter.attack.setValueAtTime(0.003, ctx.currentTime);
        limiter.release.setValueAtTime(0.1, ctx.currentTime);
        gain.connect(limiter);
        outputTail = limiter;
        this.limiterNode = limiter;
      }

      source.connect(gain);
      // Analyser collegato in parallelo (mai in serie sul percorso di uscita audio)
      if (this.analyser) {
        gain.connect(this.analyser);
      }
      outputTail.connect(ctx.destination);

      this.mediaElementSourceNode = source;
      this.gainNode = gain;
      this.routingMode = 'media-element';

      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
      return true;
    } catch {
      el.volume = Math.min(1, Math.max(0, this.targetVolumeRatio()));
      return false;
    }
  }

  private ensureAnalyserPipeline(): void {
    const el = this.ensureAudioElement();
    if (!el) {
      return;
    }

    // 1. Preferenza assoluta: riproduzione `<audio>` 100% nativa + side-chain `captureStream()`
    const captureFn = getCaptureStreamFn(el);
    if (captureFn && this.routingMode !== 'media-element') {
      if (this.attachCaptureStreamSidechain(el, captureFn)) {
        return;
      }
    }

    // 2. Fallback (Safari / browser privi di `captureStream`): Web Audio `playback` + limiter
    this.attachSafariMediaElementFallback(el);
  }

  private cancelElementVolumeRamp(): void {
    if (
      this.volumeRampRafId !== null &&
      typeof window !== 'undefined' &&
      typeof window.cancelAnimationFrame === 'function'
    ) {
      window.cancelAnimationFrame(this.volumeRampRafId);
    }
    this.volumeRampRafId = null;
  }

  private rampElementVolume(el: HTMLAudioElement, target: number, rampSec: number): void {
    this.cancelElementVolumeRamp();
    const safeTarget = Math.min(1, Math.max(0, target));
    const durationMs = Math.round(rampSec * 1000);
    if (
      durationMs <= 16 ||
      typeof window === 'undefined' ||
      typeof window.requestAnimationFrame !== 'function'
    ) {
      el.volume = safeTarget;
      return;
    }

    const startVol = Number.isFinite(el.volume) ? el.volume : safeTarget;
    if (Math.abs(safeTarget - startVol) < 0.005) {
      el.volume = safeTarget;
      return;
    }

    const startAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const step = (now: number) => {
      const elapsed = now - startAt;
      const t = Math.min(1, Math.max(0, elapsed / durationMs));
      el.volume = Math.min(1, Math.max(0, startVol + (safeTarget - startVol) * t));
      if (t < 1) {
        this.volumeRampRafId = window.requestAnimationFrame(step);
      } else {
        this.volumeRampRafId = null;
      }
    };
    this.volumeRampRafId = window.requestAnimationFrame(step);
  }

  private applyGain(targetRatio: number, rampSec = 0.06): void {
    const safe = Math.min(1, Math.max(0, targetRatio));
    if (this.routingMode === 'media-element' && this.gainNode && this.ctx) {
      const now = this.ctx.currentTime;
      const scaled = safe * WEBAUDIO_FALLBACK_HEADROOM;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
      this.gainNode.gain.linearRampToValueAtTime(scaled, now + Math.max(0.01, rampSec));
    } else if (this.audioEl) {
      this.rampElementVolume(this.audioEl, safe, rampSec);
    }
  }

  public addFiles(files: FileList | File[], autoPlay = true): number {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return 0;
    }
    const list = Array.from(files).filter(
      (f) => f && ((f.type && f.type.startsWith('audio/')) || AUDIO_EXT_RE.test(f.name)),
    );
    if (list.length === 0) {
      return 0;
    }
    const added: LocalMusicTrack[] = list.map((file) => {
      this.trackSeq += 1;
      return {
        id: `track-${this.trackSeq}`,
        name: cleanTrackTitle(file.name),
        url: URL.createObjectURL(file),
      };
    });
    const wasEmpty = this.tracks.length === 0;
    this.tracks = [...this.tracks, ...added];
    if (wasEmpty) {
      this.currentIndex = 0;
      this.loadCurrentTrack(autoPlay);
    } else {
      this.emit();
    }
    return added.length;
  }

  private ensurePlaybackContextUnlocked(): void {
    if (!this.ctx) {
      this.ctx = createPlaybackAudioContext();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
  }

  private loadCurrentTrack(playImmediately: boolean): void {
    const track = this.tracks[this.currentIndex];
    const el = this.ensureAudioElement();
    if (!track || !el) {
      this.emit();
      return;
    }
    if (this.routingMode === 'capture-stream') {
      this.detachCaptureStreamSource();
    }
    el.src = track.url;
    el.load();
    this.applyGain(this.targetVolumeRatio(), 0);
    this.emit();
    if (playImmediately) {
      // Crea/sblocca l'AudioContext dentro il gesto utente così su Chrome/Android WebView
      // è già `running` appena scatta l'evento asincrono `playing` per il side-chain captureStream.
      this.ensurePlaybackContextUnlocked();
      if (!getCaptureStreamFn(el)) {
        this.ensureAnalyserPipeline();
      }
      void el.play().catch(() => {
        this.isPlaying = false;
        this.emit();
      });
    }
  }

  public play(): void {
    if (this.tracks.length === 0) return;
    if (this.currentIndex < 0 || this.currentIndex >= this.tracks.length) {
      this.currentIndex = 0;
      this.loadCurrentTrack(true);
      return;
    }
    const el = this.ensureAudioElement();
    if (!el) return;
    if (!el.src) {
      el.src = this.tracks[this.currentIndex].url;
    }
    this.ensurePlaybackContextUnlocked();
    void el.play().catch(() => {
      this.isPlaying = false;
      this.emit();
    });
  }

  public pause(): void {
    this.audioEl?.pause();
  }

  public togglePlayPause(): void {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  public selectTrack(index: number, autoPlay = true): void {
    if (index < 0 || index >= this.tracks.length) return;
    this.currentIndex = index;
    this.loadCurrentTrack(autoPlay);
  }

  public nextTrack(forcePlay?: boolean): void {
    if (this.tracks.length === 0) return;
    const shouldPlay = forcePlay ?? this.isPlaying;
    this.currentIndex = (this.currentIndex + 1) % this.tracks.length;
    this.loadCurrentTrack(shouldPlay);
  }

  public prevTrack(): void {
    if (this.tracks.length === 0) return;
    const shouldPlay = this.isPlaying;
    this.currentIndex = (this.currentIndex - 1 + this.tracks.length) % this.tracks.length;
    this.loadCurrentTrack(shouldPlay);
  }

  public setVolume(pct: number): void {
    const clamped = Math.min(100, Math.max(0, Math.round(pct)));
    this.volume = clamped;
    saveVolume(clamped);
    this.applyGain(this.targetVolumeRatio(), 0.04);
    this.emit();
  }

  public clearPlaylist(): void {
    this.pause();
    this.detachCaptureStreamSource();
    if (this.audioEl) {
      this.audioEl.removeAttribute('src');
      this.audioEl.load();
    }
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      for (const track of this.tracks) {
        try {
          URL.revokeObjectURL(track.url);
        } catch {
          // Ignore
        }
      }
    }
    this.tracks = [];
    this.currentIndex = -1;
    this.isPlaying = false;
    this.emit();
  }

  /**
   * Abbassa dolcemente la musica locale durante gong, campanelle e annunci vocali del timer.
   */
  public duck(durationMs: number): void {
    if (!this.isPlaying || this.tracks.length === 0) {
      return;
    }
    const safeMs = Math.max(300, Math.min(8000, Math.round(durationMs)));
    this.isDucked = true;
    this.applyGain(this.targetVolumeRatio(), 0.07);
    if (this.duckTimeoutId !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.duckTimeoutId);
    }
    if (typeof window !== 'undefined') {
      this.duckTimeoutId = window.setTimeout(() => {
        this.duckTimeoutId = null;
        this.isDucked = false;
        this.applyGain(this.targetVolumeRatio(), 0.28);
      }, safeMs);
    }
  }

  public sampleSpectrum(targetBands: Float32Array): number {
    if (!this.isPlaying) {
      targetBands.fill(0);
      return 0;
    }

    // Retry pigro se `captureStream()` non aveva ancora esposto la traccia audio al primo evento `playing`
    if (
      this.routingMode !== 'media-element' &&
      !this.streamSourceNode &&
      this.audioEl &&
      getCaptureStreamFn(this.audioEl)
    ) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - this.lastStreamAttachAttemptAt >= 400) {
        this.lastStreamAttachAttemptAt = now;
        this.ensureAnalyserPipeline();
      }
    }

    if (!this.analyser || !this.bins || !this.ctx || this.ctx.state !== 'running') {
      targetBands.fill(0);
      return 0;
    }

    this.analyser.getByteFrequencyData(this.bins);
    const binCount = this.bins.length;
    const bandCount = Math.min(targetBands.length, LOG_BIN_EDGES_128.length - 1);
    const volBoost =
      !this.isDucked && this.volume >= 20 ? Math.min(1.35, 85 / Math.max(35, this.volume)) : 1;
    let peak = 0;

    for (let i = 0; i < bandCount; i += 1) {
      const start = Math.min(binCount - 1, LOG_BIN_EDGES_128[i]);
      const end = Math.min(binCount, Math.max(start + 1, LOG_BIN_EDGES_128[i + 1]));
      let sum = 0;
      for (let k = start; k < end; k += 1) {
        sum += this.bins[k];
      }
      const tilt = 1 + (i / bandCount) * 0.45;
      const norm = Math.min(1, (sum / ((end - start) * 215)) * tilt * volBoost);
      targetBands[i] = norm < 0.04 ? 0 : norm;
      if (targetBands[i] > peak) {
        peak = targetBands[i];
      }
    }
    return peak;
  }

  public dispose(): void {
    this.cancelElementVolumeRamp();
    if (this.duckTimeoutId !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.duckTimeoutId);
      this.duckTimeoutId = null;
    }
    this.clearPlaylist();
    this.mediaElementSourceNode?.disconnect();
    this.gainNode?.disconnect();
    this.limiterNode?.disconnect();
    this.analyser?.disconnect();
    this.silentGainNode?.disconnect();
    if (this.audioEl && this.audioEl.parentNode) {
      try {
        this.audioEl.remove();
      } catch {
        // Ignore
      }
    }
    this.audioEl = null;
  }
}

export const localMusicPlayer = new LocalMusicPlayer();

export function useLocalMusicPlayer(): LocalMusicPlayerSnapshot {
  const [snap, setSnap] = useState<LocalMusicPlayerSnapshot>(() => localMusicPlayer.getSnapshot());
  useEffect(() => localMusicPlayer.subscribe(() => setSnap(localMusicPlayer.getSnapshot())), []);
  return snap;
}
