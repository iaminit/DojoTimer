import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const parameter = () => ({ setValueAtTime: vi.fn(), value: 1 });
const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });

class FakeBuffer {
  numberOfChannels = 1;
  sampleRate = 8000;
  duration: number;
  data: Float32Array;
  constructor(length: number) {
    this.data = new Float32Array(length);
    this.duration = length / this.sampleRate;
  }
  getChannelData() { return this.data; }
}

class FakeContext {
  currentTime = 0;
  sampleRate = 8000;
  state = 'running';
  destination = node();
  sources: {
    buffer: FakeBuffer | null;
    playbackRate: ReturnType<typeof parameter>;
    onended: null;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }[] = [];
  createDynamicsCompressor() {
    return { ...node(), threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter() };
  }
  createGain() { return { ...node(), gain: parameter() }; }
  createBuffer(_channels: number, length: number) { return new FakeBuffer(length); }
  createBufferSource() {
    const source = {
      ...node(),
      buffer: null as FakeBuffer | null,
      playbackRate: parameter(),
      onended: null,
      start: vi.fn(),
      stop: vi.fn(),
    };
    this.sources.push(source);
    return source;
  }
  decodeAudioData = vi.fn(async (_raw: ArrayBuffer) => new FakeBuffer(2400));
  resume = vi.fn(async () => {});
}

describe('sound playback and cancellation', () => {
  let context: FakeContext;
  let engine: typeof import('../services/soundEngine')['soundEngine'];
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(async () => {
    vi.resetModules();
    context = new FakeContext();
    vi.stubGlobal('window', {
      AudioContext: class { constructor() { return context; } },
      setTimeout, clearTimeout,
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })));
    engine = (await import('../services/soundEngine')).soundEngine;
  });

  afterEach(() => {
    engine.stopAllVoice();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('plays voice-only PREP countdown in VOICE_GONG mode and emits zero tones in GONG_ONLY mode', async () => {
    engine.unlock();
    await settle();
    context.sources.length = 0;
    engine.setMode('GONG_ONLY');
    engine.playPrepCountdownSecond(5);
    expect(context.sources).toHaveLength(0);

    engine.setMode('VOICE_GONG');
    engine.playPrepCountdownSecond(5);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].start).toHaveBeenCalledWith(0);
  });

  it('discards voice decoding that finishes after the user pauses', async () => {
    const resolvers: ((buffer: FakeBuffer) => void)[] = [];
    context.decodeAudioData.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    engine.playPrepCountdownSecond(7);
    await settle();
    expect(resolvers).toHaveLength(16);
    engine.stopAllVoice();
    for (const resolve of resolvers) resolve(new FakeBuffer(2400));
    await settle();
    expect(context.sources).toHaveLength(0);
  });

  it('cancels preview timers and the playing pulse when stopped', async () => {
    engine.unlock();
    await settle();
    vi.useFakeTimers();
    window.setTimeout = setTimeout;
    window.clearTimeout = clearTimeout;
    context.sources.length = 0;
    engine.playFinalFivePreview();
    expect(context.sources).toHaveLength(1);
    engine.stopAllVoice();
    vi.advanceTimersByTime(6000);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].stop).toHaveBeenCalled();
  });

  it('starts a new phase without allowing the previous preview gong to leak through', async () => {
    engine.unlock();
    await settle();
    vi.useFakeTimers();
    window.setTimeout = setTimeout;
    window.clearTimeout = clearTimeout;
    context.sources.length = 0;
    engine.setMode('GONG_ONLY');
    engine.playFinalFivePreview();
    engine.playHajime();
    expect(context.sources).toHaveLength(2);
    vi.advanceTimersByTime(6000);
    expect(context.sources).toHaveLength(2);
  });

  it('plays shared warning and end bells and keeps the start gong after Hajime', async () => {
    vi.resetModules();
    context = new FakeContext();
    const gongBuffer = new FakeBuffer(4000);
    gongBuffer.data.fill(0.5, 0, 3200);
    const endBellBuffer = new FakeBuffer(10_928);
    const warningBellBuffer = new FakeBuffer(4_420);
    const hajimeBuffer = new FakeBuffer(2400);
    // Audible speech only during first 1600 samples (= 0.2s at 8000 Hz)
    hajimeBuffer.data.fill(0.25, 0, 1600);
    const defaultVoiceBuffer = new FakeBuffer(2400);

    vi.stubGlobal('window', {
      AudioContext: class { constructor() { return context; } },
      setTimeout, clearTimeout,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const asset = url.split('/').pop();
        const tags: Record<string, number> = {
          'gong.mp3': 8,
          'hajime.mp3': 12,
          'campanella-fine.mp3': 16,
          'campanella-preavviso.mp3': 20,
        };
        const tag = tags[asset ?? ''] ?? 4;
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(tag) };
      }),
    );
    context.decodeAudioData.mockImplementation(async (raw: ArrayBuffer) => {
      if (raw.byteLength === 8) return gongBuffer;
      if (raw.byteLength === 12) return hajimeBuffer;
      if (raw.byteLength === 16) return endBellBuffer;
      if (raw.byteLength === 20) return warningBellBuffer;
      return defaultVoiceBuffer;
    });

    engine = (await import('../services/soundEngine')).soundEngine;
    engine.unlock();
    await settle();

    context.sources.length = 0;
    engine.setMode('GONG_ONLY');
    engine.playWarningBell();
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].buffer).toBe(warningBellBuffer);
    expect(context.sources[0].start).toHaveBeenCalledWith(0);

    context.sources.length = 0;
    engine.playMate();
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].buffer).toBe(endBellBuffer);
    expect(context.sources[0].start).toHaveBeenCalledWith(0);

    context.sources.length = 0;
    engine.setMode('VOICE_GONG');
    engine.playSoremade();
    expect(context.sources).toHaveLength(2);
    expect(context.sources[0].buffer).toBe(endBellBuffer);
    expect(context.sources[1].buffer).toBe(defaultVoiceBuffer);
    expect(context.sources[1].start).toHaveBeenCalledWith(0.82);

    context.sources.length = 0;
    engine.playHajime();
    expect(context.sources).toHaveLength(2);
    expect(context.sources[0].buffer).toBe(hajimeBuffer);
    expect(context.sources[0].start).toHaveBeenCalledWith(0);
    expect(context.sources[1].buffer).toBe(gongBuffer);
    expect(context.sources[1].start.mock.calls[0][0]).toBeCloseTo(0.5, 5);

    context.sources.length = 0;
    engine.setMode('VOICE_GONG');
    engine.playRoundTransition();
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].buffer).toBe(endBellBuffer);
    expect(context.sources[0].start).toHaveBeenCalledWith(0);
  });

  it('retries audio download and decode after a transient network error', async () => {
    vi.resetModules();
    context = new FakeContext();
    const warningBellBuffer = new FakeBuffer(4_420);
    const gongBuffer = new FakeBuffer(4000);
    const defaultVoiceBuffer = new FakeBuffer(2400);

    let failWarningFetch = true;
    let warningFetchCount = 0;

    vi.stubGlobal('window', {
      AudioContext: class { constructor() { return context; } },
      setTimeout, clearTimeout,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('campanella-preavviso.mp3')) {
          warningFetchCount += 1;
          if (failWarningFetch) {
            return { ok: false, arrayBuffer: async () => new ArrayBuffer(0) };
          }
          return { ok: true, arrayBuffer: async () => new ArrayBuffer(20) };
        }
        const tag = url.includes('gong.mp3') ? 8 : 4;
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(tag) };
      }),
    );
    context.decodeAudioData.mockImplementation(async (raw: ArrayBuffer) => {
      if (raw.byteLength === 20) return warningBellBuffer;
      if (raw.byteLength === 8) return gongBuffer;
      return defaultVoiceBuffer;
    });

    engine = (await import('../services/soundEngine')).soundEngine;
    engine.unlock();
    await settle();

    // First playWarningBell retries (once after preload) and falls back cleanly while network fails
    const countBeforeRetry = warningFetchCount;
    context.sources.length = 0;
    engine.playWarningBell();
    await settle();
    expect(warningFetchCount).toBe(countBeforeRetry + 1);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].buffer).not.toBe(warningBellBuffer);

    // Restore network: next playWarningBell retries fetch, decodes, and plays real warningBellBuffer (no repeat fetch once cached)
    failWarningFetch = false;
    context.sources.length = 0;
    engine.playWarningBell();
    await settle();
    expect(warningFetchCount).toBe(countBeforeRetry + 2);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].buffer).toBe(warningBellBuffer);

    context.sources.length = 0;
    engine.playWarningBell();
    await settle();
    expect(warningFetchCount).toBe(countBeforeRetry + 2);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].buffer).toBe(warningBellBuffer);
  });

  it('switches between Kenguro (male) and Arale (female) voice directories cleanly', async () => {
    vi.resetModules();
    context = new FakeContext();
    const urlsFetched: string[] = [];
    vi.stubGlobal('window', {
      AudioContext: class { constructor() { return context; } },
      setTimeout, clearTimeout,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urlsFetched.push(url);
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
      }),
    );

    engine = (await import('../services/soundEngine')).soundEngine;
    engine.unlock();
    await settle();

    expect(urlsFetched).toContain('/audio/gong.mp3');
    expect(urlsFetched).toContain('/audio/campanella-preavviso.mp3');
    expect(urlsFetched).toContain('/audio/campanella-fine.mp3');
    expect(urlsFetched).toContain('/audio/kenguro/hajime.mp3');
    expect(urlsFetched).toContain('/audio/kenguro/count-5.mp3');

    urlsFetched.length = 0;
    engine.setVoiceProfile('ARALE');
    await settle();

    expect(urlsFetched).toContain('/audio/arale/hajime.mp3');
    expect(urlsFetched).toContain('/audio/arale/count-5.mp3');
  });

  it('previews voice countdown 3..2..1 followed by gong without countdown beeps and cancels cleanly', async () => {
    engine.unlock();
    await settle();
    vi.useFakeTimers();
    window.setTimeout = setTimeout;
    window.clearTimeout = clearTimeout;
    context.sources.length = 0;

    engine.setMode('VOICE_GONG');
    engine.playPrepCountdownPreview();
    expect(context.sources).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    // 3 voice countdown clips (at 0s, 1s, 2s) + opening gong (at 3s)
    expect(context.sources).toHaveLength(4);

    context.sources.length = 0;
    engine.playPrepCountdownPreview();
    expect(context.sources).toHaveLength(1);
    engine.stopAllVoice();
    vi.advanceTimersByTime(4000);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].stop).toHaveBeenCalled();
  });

  it('emits START_GONG at 0.5s in VOICE_GONG, WARNING_BELL and END_BELL immediately, and cancels cleanly', async () => {
    engine.unlock();
    await settle();
    vi.useFakeTimers();
    window.setTimeout = setTimeout;
    window.clearTimeout = clearTimeout;

    const impacts: string[] = [];
    let cancelCount = 0;
    const unsubImpact = engine.subscribeSoundImpact((event) => impacts.push(event));
    const unsubCancel = engine.subscribeSoundCancel(() => {
      cancelCount += 1;
    });

    engine.setMode('GONG_ONLY');
    engine.playHajime();
    expect(impacts).toEqual(['START_GONG']);

    impacts.length = 0;
    engine.playWarningBell();
    engine.playMate();
    engine.playRoundTransition();
    engine.playSoremade();
    expect(impacts).toEqual(['WARNING_BELL', 'END_BELL', 'END_BELL', 'END_BELL']);

    impacts.length = 0;
    engine.setMode('VOICE_GONG');
    engine.playHajime();
    expect(impacts).toEqual([]);
    vi.advanceTimersByTime(490);
    expect(impacts).toEqual([]);
    vi.advanceTimersByTime(20);
    expect(impacts).toEqual(['START_GONG']);

    // Cancelling before 500ms prevents late START_GONG impact and notifies cancel subscribers
    impacts.length = 0;
    const prevCancels = cancelCount;
    engine.playHajime();
    engine.stopAllVoice();
    vi.advanceTimersByTime(1000);
    expect(impacts).toEqual([]);
    expect(cancelCount).toBeGreaterThan(prevCancels);

    unsubImpact();
    unsubCancel();
  });
});
