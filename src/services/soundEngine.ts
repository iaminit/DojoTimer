import type { AudioMode, VoiceProfile } from '../types/timer';
import { FINAL_FIVE_SCALE_HZ, renderBoxingBell, renderCountdownPulse, renderGong } from './soundDesign';
export { FINAL_FIVE_SCALE_HZ } from './soundDesign';

type VoiceClipKey =
  | 'hajime'
  | 'matte'
  | 'soremade'
  | 'count-1'
  | 'count-2'
  | 'count-3'
  | 'count-4'
  | 'count-5'
  | 'count-6'
  | 'count-7'
  | 'count-8'
  | 'count-9'
  | 'count-10';

const SHARED_CLIP_IDS = ['gong', 'campanella-fine', 'campanella-preavviso'] as const;
type SharedClipId = typeof SHARED_CLIP_IDS[number];
type CachedClipId = SharedClipId | `${VoiceProfile}:${VoiceClipKey}`;

const VOICE_CLIP_KEYS: readonly VoiceClipKey[] = [
  'hajime',
  'matte',
  'soremade',
  'count-1',
  'count-2',
  'count-3',
  'count-4',
  'count-5',
  'count-6',
  'count-7',
  'count-8',
  'count-9',
  'count-10',
];

function voiceClipId(profile: VoiceProfile, clip: VoiceClipKey): CachedClipId {
  return `${profile}:${clip}`;
}

const BASE_URL = (import.meta.env?.BASE_URL ?? '/').replace(/\/?$/, '/');

function clipUrl(id: CachedClipId): string {
  const sep = id.indexOf(':');
  if (sep === -1) return `${BASE_URL}audio/${id}.mp3`;
  const profile = id.slice(0, sep) as VoiceProfile;
  const clip = id.slice(sep + 1) as VoiceClipKey;
  return `${BASE_URL}audio/${profile === 'ARALE' ? 'arale' : 'kenguro'}/${clip}.mp3`;
}

const JA_COUNTDOWN_WORDS = [
  '',
  'いち',
  'に',
  'さん',
  'よん',
  'ご',
  'ろく',
  'なな',
  'はち',
  'きゅう',
  'じゅう',
] as const;

export const HAJIME_GONG_DELAY_SEC = 0.5;

export type SoundImpactEvent = 'START_GONG' | 'WARNING_BELL' | 'END_BELL';


export function getFinalFiveScaleFreqHz(secondsRemaining: number): number | null {
  const whole = Math.trunc(secondsRemaining);
  if (whole === 5 || whole === 4 || whole === 3 || whole === 2 || whole === 1) {
    return FINAL_FIVE_SCALE_HZ[whole];
  }
  return null;
}

/**
 * Individuazione della durata effettivamente udibile di una clip vocale,
 * ignorando l'eventuale coda di silenzio/padding finale del file MP3.
 */
export function computeAudibleDurationSec(
  channelData: readonly ArrayLike<number>[],
  sampleRate: number,
  fallbackDurationSec: number,
  threshold = 0.01,
): number {
  if (sampleRate <= 0 || channelData.length === 0) {
    return Math.max(0, fallbackDurationSec);
  }
  let lastAudibleIdx = -1;
  for (const ch of channelData) {
    for (let i = ch.length - 1; i > lastAudibleIdx; i -= 1) {
      if (Math.abs(ch[i]) >= threshold) {
        lastAudibleIdx = i;
        break;
      }
    }
  }
  if (lastAudibleIdx < 0) {
    return Math.max(0, fallbackDurationSec);
  }
  return Math.min(Math.max(0, fallbackDurationSec), (lastAudibleIdx + 1) / sampleRate);
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private effectBuffers = new Map<string, AudioBuffer>();
  private mode: AudioMode = 'VOICE_GONG';
  private voiceProfile: VoiceProfile = 'KENGURO';
  private speechTimeoutId: number | null = null;
  private previewTimeoutIds: number[] = [];
  private hajimePlaySeq = 0;
  private effectPlaybackSeq = 0;

  private rawClipPromises: Partial<Record<CachedClipId, Promise<ArrayBuffer | null>>> = {};
  private decodedClips: Partial<Record<CachedClipId, AudioBuffer>> = {};
  private decodePromises: Partial<Record<CachedClipId, Promise<AudioBuffer | null>>> = {};
  private activeSources = new Set<AudioBufferSourceNode>();
  private pendingGongNodes = new Set<AudioScheduledSourceNode>();
  private soundImpactListeners = new Set<(event: SoundImpactEvent) => void>();
  private soundCancelListeners = new Set<() => void>();
  private soundImpactTimeoutIds = new Set<number>();
  private preloadStarted = false;
  private decodedProfilesStarted = new Set<VoiceProfile>();

  constructor() {
    this.startPreloadRawClips();
  }

  /**
   * Notifica i subscriber nell'istante esatto in cui parte un evento sonoro chiave:
   * - START_GONG: gong avvio round / Hajime
   * - WARNING_BELL: avviso preavviso (es. -30s)
   * - END_BELL: tre rintocchi finali (cambio round, Mate, Soremade)
   */
  public subscribeSoundImpact(listener: (event: SoundImpactEvent) => void): () => void {
    this.soundImpactListeners.add(listener);
    return () => {
      this.soundImpactListeners.delete(listener);
    };
  }

  /**
   * Notifica i subscriber quando un effetto audio in sospeso o in corso viene annullato.
   */
  public subscribeSoundCancel(listener: () => void): () => void {
    this.soundCancelListeners.add(listener);
    return () => {
      this.soundCancelListeners.delete(listener);
    };
  }

  /**
   * Notifica i subscriber nell'istante esatto in cui parte il gong iniziale (Hajime / avvio round).
   */
  public subscribeStartGong(listener: () => void): () => void {
    return this.subscribeSoundImpact((event) => {
      if (event === 'START_GONG') {
        listener();
      }
    });
  }

  private emitSoundImpact(event: SoundImpactEvent): void {
    for (const listener of this.soundImpactListeners) {
      try {
        listener(event);
      } catch {
        // Isolate subscriber UI errors from audio playback
      }
    }
  }

  private emitSoundCancel(): void {
    for (const listener of this.soundCancelListeners) {
      try {
        listener();
      } catch {
        // Isolate subscriber cleanup errors from audio cancellation
      }
    }
  }

  private clearSoundImpactTimers(): void {
    if (typeof window !== 'undefined') {
      for (const id of this.soundImpactTimeoutIds) {
        window.clearTimeout(id);
      }
    }
    this.soundImpactTimeoutIds.clear();
  }

  private scheduleSoundImpact(event: SoundImpactEvent, delaySec = 0): void {
    const delayMs = Math.max(0, Math.round(delaySec * 1000));
    if (delayMs === 0 || typeof window === 'undefined') {
      this.emitSoundImpact(event);
      return;
    }
    const seq = this.effectPlaybackSeq;
    const id = window.setTimeout(() => {
      this.soundImpactTimeoutIds.delete(id);
      if (seq === this.effectPlaybackSeq) {
        this.emitSoundImpact(event);
      }
    }, delayMs);
    this.soundImpactTimeoutIds.add(id);
  }

  private stopVoiceOnly(): void {
    this.hajimePlaySeq += 1;
    for (const src of this.activeSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already stopped sources
      }
    }
    this.activeSources.clear();
    this.cancelSpeech();
  }

  public setMode(mode: AudioMode): void {
    this.mode = mode;
    if (mode === 'GONG_ONLY') {
      this.stopVoiceOnly();
    }
  }

  public getMode(): AudioMode {
    return this.mode;
  }

  public setVoiceProfile(profile: VoiceProfile): void {
    if (this.voiceProfile === profile) {
      return;
    }
    this.voiceProfile = profile;
    this.stopVoiceOnly();
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      this.preloadProfile(profile);
      if (this.ctx) {
        this.decodedProfilesStarted.add(profile);
      }
    }
  }

  public getVoiceProfile(): VoiceProfile {
    return this.voiceProfile;
  }

  private cancelPendingGong(): void {
    this.hajimePlaySeq += 1;
    this.effectPlaybackSeq += 1;
    this.clearSoundImpactTimers();
    this.emitSoundCancel();
    if (typeof window !== 'undefined' && this.previewTimeoutIds.length > 0) {
      for (const id of this.previewTimeoutIds) {
        window.clearTimeout(id);
      }
      this.previewTimeoutIds = [];
    }
    for (const node of this.pendingGongNodes) {
      try {
        node.stop();
        node.disconnect();
      } catch {
        // Ignore already stopped sources
      }
    }
    this.pendingGongNodes.clear();
  }

  public stopAllVoice(): void {
    this.cancelPendingGong();
    this.stopVoiceOnly();
  }

  private getProfileClipIds(profile: VoiceProfile): CachedClipId[] {
    return [...SHARED_CLIP_IDS, ...VOICE_CLIP_KEYS.map((clip) => voiceClipId(profile, clip))];
  }

  private preloadProfile(profile: VoiceProfile): void {
    const clipIds = this.getProfileClipIds(profile);
    clipIds.forEach((id) => {
      void this.fetchRawClip(id);
      if (this.ctx && !this.decodedClips[id] && !this.decodePromises[id]) {
        void this.ensureDecodedClip(id, this.ctx);
      }
    });
  }

  private startPreloadRawClips(): void {
    if (this.preloadStarted || typeof window === 'undefined' || typeof fetch !== 'function') {
      return;
    }
    this.preloadStarted = true;
    this.preloadProfile(this.voiceProfile);
  }

  private fetchRawClip(clip: CachedClipId): Promise<ArrayBuffer | null> {
    const existing = this.rawClipPromises[clip];
    if (existing) {
      return existing;
    }
    if (typeof fetch !== 'function') {
      return Promise.resolve(null);
    }
    const promise: Promise<ArrayBuffer | null> = fetch(clipUrl(clip))
      .then(async (res) => {
        if (!res.ok) {
          if (this.rawClipPromises[clip] === promise) {
            delete this.rawClipPromises[clip];
          }
          return null;
        }
        const raw = await res.arrayBuffer();
        if (!raw || raw.byteLength === 0) {
          if (this.rawClipPromises[clip] === promise) {
            delete this.rawClipPromises[clip];
          }
          return null;
        }
        return raw;
      })
      .catch(() => {
        if (this.rawClipPromises[clip] === promise) {
          delete this.rawClipPromises[clip];
        }
        return null;
      });
    this.rawClipPromises[clip] = promise;
    return promise;
  }

  private ensureDecodedClip(clip: CachedClipId, ctx: AudioContext): Promise<AudioBuffer | null> {
    const cached = this.decodedClips[clip];
    if (cached) {
      return Promise.resolve(cached);
    }
    const pending = this.decodePromises[clip];
    if (pending) {
      return pending;
    }

    const promise: Promise<AudioBuffer | null> = this.fetchRawClip(clip)
      .then(async (raw) => {
        if (!raw) {
          if (this.decodePromises[clip] === promise) {
            delete this.decodePromises[clip];
          }
          return null;
        }
        try {
          const decoded = await ctx.decodeAudioData(raw.slice(0));
          this.decodedClips[clip] = decoded;
          return decoded;
        } catch {
          if (this.decodePromises[clip] === promise) {
            delete this.decodePromises[clip];
          }
          delete this.rawClipPromises[clip];
          return null;
        }
      })
      .catch(() => {
        if (this.decodePromises[clip] === promise) {
          delete this.decodePromises[clip];
        }
        return null;
      });

    this.decodePromises[clip] = promise;
    return promise;
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') {
      return null;
    }
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      return null;
    }

    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-1.5, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(3, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(12, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.001, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.08, this.ctx.currentTime);


      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.9, this.ctx.currentTime);

      this.compressor.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }

    this.startPreloadRawClips();
    if (!this.decodedProfilesStarted.has(this.voiceProfile)) {
      this.decodedProfilesStarted.add(this.voiceProfile);
      this.preloadProfile(this.voiceProfile);
    }

    return this.ctx;
  }

  /**
   * Sblocca Web Audio API su iOS/Safari/Android al primo evento touch/click
   * e avvia la decodifica immediata delle clip vocali maschili.
   */
  public unlock(): void {
    const ctx = this.ensureContext();
    if (!ctx) {
      return;
    }
    try {
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      // Ignore unlock failures on restricted contexts
    }
  }

  private cancelSpeech(): void {
    if (this.speechTimeoutId !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.speechTimeoutId);
      this.speechTimeoutId = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore speech synthesis errors
      }
    }
  }

  private speakFallback(text: string, delayMs = 160, onEnd?: () => void): void {
    if (this.mode !== 'VOICE_GONG') {
      return;
    }
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      onEnd?.();
      return;
    }

    this.cancelSpeech();

    const triggerSpeech = () => {
      try {
        const synth = window.speechSynthesis;
        synth.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        const voices = synth.getVoices();
        const wantFemale = this.voiceProfile === 'ARALE';
        const preferredVoice = wantFemale
          ? voices.find(
              (v) =>
                v.lang.toLowerCase().startsWith('ja') &&
                /kyoko|nanami|haruka|female|woman/i.test(v.name),
            ) ?? voices.find((v) => v.lang.toLowerCase().startsWith('ja'))
          : voices.find(
              (v) =>
                v.lang.toLowerCase().startsWith('ja') &&
                /keita|reed|rocko|eddy|male|otoya/i.test(v.name),
            ) ?? voices.find((v) => v.lang.toLowerCase().startsWith('ja'));

        if (!preferredVoice) {
          onEnd?.();
          return;
        }

        if (preferredVoice) {
          utterance.voice = preferredVoice;
          utterance.lang = preferredVoice.lang;
        } else {
          utterance.lang = 'ja-JP';
        }
        utterance.rate = 0.96;
        utterance.pitch = wantFemale ? 1.25 : 0.82;
        utterance.volume = 1.0;

        let endedCalled = false;
        const notifyEnd = () => {
          if (endedCalled) return;
          endedCalled = true;
          onEnd?.();
        };
        utterance.onend = notifyEnd;
        utterance.onerror = notifyEnd;

        synth.speak(utterance);
      } catch {
        onEnd?.();
      }
    };

    if (delayMs > 0) {
      this.speechTimeoutId = window.setTimeout(triggerSpeech, delayMs);
    } else {
      triggerSpeech();
    }
  }

  private startVoiceSource(
    ctx: AudioContext,
    buffer: AudioBuffer,
    startTime: number,
    gainBoost = 1,
  ): void {
    if (!this.compressor) {
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(gainBoost, startTime);

    source.connect(voiceGain);
    voiceGain.connect(this.compressor);

    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      source.disconnect();
      voiceGain.disconnect();
    };
    source.start(startTime);
  }

  private scheduleBufferPlayback(
    ctx: AudioContext,
    buffer: AudioBuffer,
    startTime: number,
    gainBoost = 1,
  ): void {
    if (!this.compressor || this.mode !== 'VOICE_GONG') {
      return;
    }
    this.startVoiceSource(ctx, buffer, startTime, gainBoost);
  }

  private playVoiceClip(
    clip: VoiceClipKey,
    fallbackText: string,
    delaySec: number,
    gainBoost = 1,
  ): void {
    if (this.mode !== 'VOICE_GONG') {
      return;
    }

    const ctx = this.ensureContext();
    if (!ctx || !this.compressor) {
      this.speakFallback(fallbackText, Math.round(delaySec * 1000));
      return;
    }

    const clipId = voiceClipId(this.voiceProfile, clip);
    const cached = this.decodedClips[clipId];
    if (cached) {
      this.scheduleBufferPlayback(ctx, cached, ctx.currentTime + delaySec, gainBoost);
      return;
    }

    const targetStartTime = ctx.currentTime + delaySec;
    const sequence = this.hajimePlaySeq;
    void this.ensureDecodedClip(clipId, ctx).then((buffer) => {
      // Do not resurrect a queued voice after pause, reset or mode changes.
      if (this.mode !== 'VOICE_GONG' || sequence !== this.hajimePlaySeq || ctx.currentTime - targetStartTime > 0.25) {
        return;
      }
      if (buffer) {
        const playAt = Math.max(ctx.currentTime, targetStartTime);
        this.scheduleBufferPlayback(ctx, buffer, playAt, gainBoost);
      } else {
        this.speakFallback(fallbackText, 0);
      }
    });
  }

  /**
   * Anteprima immediata della voce selezionata nelle Opzioni (riproduce "Hajime").
   */
  public playVoicePreview(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.compressor) {
      return;
    }
    this.stopVoiceOnly();
    const clipId = voiceClipId(this.voiceProfile, 'hajime');
    const seq = this.hajimePlaySeq;
    const cached = this.decodedClips[clipId];
    if (cached) {
      this.startVoiceSource(ctx, cached, ctx.currentTime, 1);
      return;
    }
    void this.ensureDecodedClip(clipId, ctx).then((buffer) => {
      if (seq === this.hajimePlaySeq && buffer) {
        this.startVoiceSource(ctx, buffer, ctx.currentTime, 1);
      }
    });
  }

  /**
   * Beep di countdown stile arena ad alta proiezione (fondamentale + armoniche + transiente),
   * udibile chiaramente a distanza su tutto il tatami.
   */
  public playCountdownBeep(isFinalSecond = false, volumeScale = 1): void {
    const second = isFinalSecond ? 1 : 10;
    this.playEffect(`pulse-${second}`, (rate) => renderCountdownPulse(rate, second), 0, volumeScale);
  }

  /**
   * Scala discendente ultimi 5 secondi (5 -> 4 -> 3 -> 2 -> 1):
   * parte acuto a 5s (1318.51 Hz) e scende progressivamente fino a un timbro greve a 1s
   * (659.25 Hz + sub-ottava 329.63 Hz) subito prima del gong.
   */
  public playFinalFiveScaleBeep(sec: number, volumeScale = 1): void {
    if (getFinalFiveScaleFreqHz(sec) === null) return;
    const second = Math.trunc(sec);
    this.playEffect(`pulse-${second}`, (rate) => renderCountdownPulse(rate, second), 0, volumeScale);
  }

  /**
   * Conto alla rovescia 3 -> 2 -> 1 solo vocale (in modalità Voce+Gong) seguito dal gong iniziale.
   */
  public playPrepCountdownPreview(): void {
    this.stopAllVoice();
    const seq = this.hajimePlaySeq;
    const steps = [3, 2, 1];
    this.playPrepCountdownSecond(steps[0]);

    if (typeof window === 'undefined') {
      return;
    }
    steps.slice(1).forEach((sec, idx) => {
      const id = window.setTimeout(() => {
        if (seq === this.hajimePlaySeq) {
          this.playPrepCountdownSecond(sec);
        }
      }, (idx + 1) * 1000);
      this.previewTimeoutIds.push(id);
    });

    const gongId = window.setTimeout(() => {
      if (seq === this.hajimePlaySeq) {
        this.playStartGong();
      }
    }, steps.length * 1000);
    this.previewTimeoutIds.push(gongId);
  }

  /**
   * Anteprima della scala 5 -> 1 chiusa dal segnale finale.
   */
  public playFinalFivePreview(): void {
    this.cancelPendingGong();
    const seq = this.hajimePlaySeq;
    const steps = [5, 4, 3, 2, 1];
    this.playFinalFiveScaleBeep(steps[0], 0.8);

    if (typeof window === 'undefined') {
      return;
    }
    steps.slice(1).forEach((sec, idx) => {
      const id = window.setTimeout(() => {
        if (seq === this.hajimePlaySeq) {
          this.playFinalFiveScaleBeep(sec, 0.8);
        }
      }, (idx + 1) * 1000);
      this.previewTimeoutIds.push(id);
    });

    const gongId = window.setTimeout(() => {
      if (seq === this.hajimePlaySeq) {
        this.playEndBell();
      }
    }, steps.length * 1000);
    this.previewTimeoutIds.push(gongId);
  }

  /**
   * Conto alla rovescia 10 -> 1 in preparazione:
   * solo voce giapponese in modalità Voce+Gong, nessun suono elettronico di conteggio.
   */
  public playPrepCountdownSecond(sec: number): void {
    if (!Number.isInteger(sec) || sec < 1 || sec > 10) return;
    if (this.mode === 'VOICE_GONG') {
      this.playVoiceClip(`count-${sec}` as VoiceClipKey, JA_COUNTDOWN_WORDS[sec], 0, 1);
    }
  }

  private playEffect(key: string, render: (rate: number) => Float32Array, delaySec = 0, volume = 1): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.compressor) return;
    let buffer = this.effectBuffers.get(key);
    if (!buffer) {
      const samples = render(ctx.sampleRate);
      buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.getChannelData(0).set(samples);
      this.effectBuffers.set(key, buffer);
    }
    this.scheduleEffectBuffer(ctx, buffer, delaySec, volume);
  }

  private scheduleEffectBuffer(ctx: AudioContext, buffer: AudioBuffer, delaySec: number, volume: number): void {
    if (!this.compressor) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(this.compressor);
    this.pendingGongNodes.add(source);
    source.onended = () => {
      this.pendingGongNodes.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    source.start(ctx.currentTime + delaySec);
  }

  private playSharedClip(
    clip: SharedClipId,
    delaySec: number,
    volume: number,
    fallback: (rate: number) => Float32Array,
  ): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.compressor) return;

    const cached = this.decodedClips[clip];
    if (cached) {
      this.scheduleEffectBuffer(ctx, cached, delaySec, volume);
      return;
    }

    const sequence = this.effectPlaybackSeq;
    const startTime = ctx.currentTime + delaySec;
    void this.ensureDecodedClip(clip, ctx).then((buffer) => {
      if (sequence !== this.effectPlaybackSeq) return;
      const remainingDelay = Math.max(0, startTime - ctx.currentTime);
      if (buffer) {
        this.scheduleEffectBuffer(ctx, buffer, remainingDelay, volume);
      } else {
        this.playEffect(`fallback-${clip}`, fallback, remainingDelay);
      }
    });
  }

  private playStartGong(delaySec = 0): void {
    this.scheduleSoundImpact('START_GONG', delaySec);
    this.playSharedClip('gong', delaySec, 1.45, (rate) => renderGong(rate, 2.2));
  }

  private playEndBell(): void {
    this.scheduleSoundImpact('END_BELL', 0);
    this.playSharedClip('campanella-fine', 0, 1, (rate) => renderBoxingBell(rate, 3));
  }

  /**
   * Segnale Hajime (Inizio lavoro): pronuncia "Hajime!" e fa partire il gong reale
   * esattamente a 0,5s dalla fine della preparazione (o subito in Solo Gong).
   */
  public playHajime(): void {
    this.stopAllVoice();
    if (this.mode !== 'VOICE_GONG') {
      this.playStartGong(0);
      return;
    }

    this.cancelPendingGong();
    const seq = this.hajimePlaySeq;

    const ctx = this.ensureContext();
    if (!ctx || !this.compressor) {
      this.speakFallback('はじめ', 0);
      this.playStartGong(HAJIME_GONG_DELAY_SEC);
      return;
    }

    const hajimeClipId = voiceClipId(this.voiceProfile, 'hajime');
    const cached = this.decodedClips[hajimeClipId];
    if (cached) {
      this.scheduleBufferPlayback(ctx, cached, ctx.currentTime, 1);
      this.playStartGong(HAJIME_GONG_DELAY_SEC);
      return;
    }

    // Fissa il gong a 0,5s dall'avvio fase così eventuale latenza di decodifica non lo ritarda.
    this.playStartGong(HAJIME_GONG_DELAY_SEC);
    const targetStartTime = ctx.currentTime;
    void this.ensureDecodedClip(hajimeClipId, ctx).then((buffer) => {
      if (seq !== this.hajimePlaySeq || this.mode !== 'VOICE_GONG') {
        return;
      }
      if (buffer) {
        this.scheduleBufferPlayback(ctx, buffer, Math.max(ctx.currentTime, targetStartTime), 1);
      } else {
        this.speakFallback('はじめ', 0);
      }
    });
  }

  /** Un rintocco singolo più acuto al preavviso configurato. */
  public playWarningBell(): void {
    this.scheduleSoundImpact('WARNING_BELL', 0);
    this.playSharedClip('campanella-preavviso', 0, 1, (rate) => renderBoxingBell(rate, 1));
  }

  /** Tre rintocchi al cambio round diretto senza pausa (nessun Mate). */
  public playRoundTransition(): void {
    this.stopAllVoice();
    this.playEndBell();
  }

  /** Tre rintocchi a fine round, seguiti da Mate in modalità vocale. */
  public playMate(): void {
    this.stopAllVoice();
    this.playEndBell();
    this.playVoiceClip('matte', 'まて', 0.82, 1.35);
  }

  /** Tre rintocchi a fine sessione, seguiti da Soremade in modalità vocale. */
  public playSoremade(): void {
    this.stopAllVoice();
    this.playEndBell();
    this.playVoiceClip('soremade', 'それまで', 0.82, 1.35);
  }

  /**
   * Micro-click tattile della ghiera di setup: più deciso sui punti caldi (1..10, 12 min),
   * leggero sui passaggi intermedi da 15s.
   */
  public playWheelDetentClick(isHotspot: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.compressor) {
      return;
    }

    const now = ctx.currentTime;
    const dur = isHotspot ? 0.016 : 0.008;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isHotspot ? 1350 : 1750, now);
    osc.frequency.exponentialRampToValueAtTime(isHotspot ? 480 : 680, now + dur);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(isHotspot ? 0.26 : 0.08, now + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(gain);
    gain.connect(this.compressor);
    osc.start(now);
    osc.stop(now + dur + 0.005);
  }

  public playUiButtonClick(emphasis: 'soft' | 'firm' = 'firm'): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.compressor) {
      return;
    }

    const now = ctx.currentTime;
    const dur = emphasis === 'firm' ? 0.016 : 0.011;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(emphasis === 'firm' ? 1250 : 980, now);
    osc.frequency.exponentialRampToValueAtTime(emphasis === 'firm' ? 460 : 420, now + dur);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(emphasis === 'firm' ? 0.22 : 0.11, now + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(gain);
    gain.connect(this.compressor);
    osc.start(now);
    osc.stop(now + dur + 0.005);
  }
}

export const soundEngine = new SoundEngine();
