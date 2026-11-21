import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalMusicPlayer } from '../services/musicPlayer';
import { isNativeAndroidRuntime } from '../services/nativeAndroid';

class FakeAudioNode {
  public connectedTo: FakeAudioNode[] = [];
  public disconnected = false;
  connect(target: FakeAudioNode) {
    this.connectedTo.push(target);
    return target;
  }
  disconnect() {
    this.disconnected = true;
    this.connectedTo = [];
  }
}

class FakeAudioParam {
  public value = 1;
  setValueAtTime(val: number) {
    this.value = val;
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
  linearRampToValueAtTime(val: number) {
    this.value = val;
    return this;
  }
}

class FakeGainNode extends FakeAudioNode {
  public gain = new FakeAudioParam();
}

class FakeCompressorNode extends FakeAudioNode {
  public threshold = new FakeAudioParam();
  public knee = new FakeAudioParam();
  public ratio = new FakeAudioParam();
  public attack = new FakeAudioParam();
  public release = new FakeAudioParam();
}

class FakeAnalyserNode extends FakeAudioNode {
  public fftSize = 256;
  public smoothingTimeConstant = 0.8;
  public frequencyBinCount = 128;
  getByteFrequencyData(arr: Uint8Array) {
    arr.fill(160);
  }
}

interface MockAudioCtxTracker {
  optionsReceived: AudioContextOptions | undefined;
  createMediaElementSourceCalls: number;
  createMediaStreamSourceCalls: number;
  gains: FakeGainNode[];
  compressors: FakeCompressorNode[];
  analysers: FakeAnalyserNode[];
}

function createFakeAudioContextClass(): {
  AudioContextClass: typeof AudioContext;
  tracker: MockAudioCtxTracker;
} {
  const tracker: MockAudioCtxTracker = {
    optionsReceived: undefined,
    createMediaElementSourceCalls: 0,
    createMediaStreamSourceCalls: 0,
    gains: [],
    compressors: [],
    analysers: [],
  };

  class FakeAudioContext {
    public state = 'running';
    public currentTime = 0;
    public destination = new FakeAudioNode();

    constructor(opts?: AudioContextOptions) {
      tracker.optionsReceived = opts;
    }

    resume() {
      this.state = 'running';
      return Promise.resolve();
    }

    createMediaElementSource() {
      tracker.createMediaElementSourceCalls += 1;
      return new FakeAudioNode();
    }

    createMediaStreamSource() {
      tracker.createMediaStreamSourceCalls += 1;
      return new FakeAudioNode();
    }

    createGain() {
      const g = new FakeGainNode();
      tracker.gains.push(g);
      return g;
    }

    createDynamicsCompressor() {
      const c = new FakeCompressorNode();
      tracker.compressors.push(c);
      return c;
    }

    createAnalyser() {
      const a = new FakeAnalyserNode();
      tracker.analysers.push(a);
      return a;
    }
  }

  return {
    AudioContextClass: FakeAudioContext as unknown as typeof AudioContext,
    tracker,
  };
}

class FakeHtmlAudioElement {
  public preload = '';
  public crossOrigin: string | null = null;
  public src = '';
  public volume = 1;
  public style: Record<string, string> = {};
  public listeners = new Map<string, Array<() => void>>();
  public captureStream?: () => MediaStream;

  setAttribute() {}
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
  load() {}
  pause() {
    this.emit('pause');
  }
  play() {
    this.emit('play');
    this.emit('playing');
    return Promise.resolve();
  }
  addEventListener(type: string, cb: () => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }
  emit(type: string) {
    for (const cb of this.listeners.get(type) ?? []) {
      cb();
    }
  }
}

describe('LocalMusicPlayer zero-distortion routing', () => {
  let createdAudio: FakeHtmlAudioElement | null = null;
  let mockWin: Record<string, unknown>;
  let origCreateObjectURL: typeof URL.createObjectURL;
  let origRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeEach(() => {
    createdAudio = null;
    mockWin = {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };
    vi.stubGlobal('window', mockWin);
    origCreateObjectURL = URL.createObjectURL;
    origRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock-track');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    URL.createObjectURL = origCreateObjectURL;
    URL.revokeObjectURL = origRevokeObjectURL;
  });

  it('uses native <audio> playback + read-only captureStream side-chain with Gain(0) on Chromium/Android WebView', () => {
    const { AudioContextClass, tracker } = createFakeAudioContextClass();
    mockWin.AudioContext = AudioContextClass;

    const fakeStream = {
      getAudioTracks: () => [{ readyState: 'live' }],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaStream;

    vi.stubGlobal(
      'Audio',
      class extends FakeHtmlAudioElement {
        constructor() {
          super();
          this.captureStream = () => fakeStream;
          createdAudio = this;
        }
      },
    );

    const player = new LocalMusicPlayer();
    const file = new File(['mp3data'], 'dojo-beat.mp3', { type: 'audio/mpeg' });
    expect(player.addFiles([file], true)).toBe(1);

    // Must NOT hijack playback via createMediaElementSource
    expect(tracker.createMediaElementSourceCalls).toBe(0);
    expect(tracker.createMediaStreamSourceCalls).toBe(1);
    expect(tracker.optionsReceived).toEqual({ latencyHint: 'playback' });
    // Silent side-chain gain must be strictly 0 so zero Web Audio reaches speakers
    expect(tracker.gains).toHaveLength(1);
    expect(tracker.gains[0].gain.value).toBe(0);

    const bands = new Float32Array(16);
    const peak = player.sampleSpectrum(bands);
    expect(peak).toBeGreaterThan(0.5);
    expect(createdAudio?.volume).toBeGreaterThan(0);

    player.dispose();
  });

  it('falls back to playback latencyHint + DynamicsCompressor limiter + parallel analyser when captureStream is unavailable (Safari)', () => {
    const { AudioContextClass, tracker } = createFakeAudioContextClass();
    mockWin.AudioContext = AudioContextClass;

    vi.stubGlobal(
      'Audio',
      class extends FakeHtmlAudioElement {
        constructor() {
          super();
          createdAudio = this;
        }
      },
    );

    const player = new LocalMusicPlayer();
    const file = new File(['mp3data'], 'safari-track.mp3', { type: 'audio/mpeg' });
    expect(player.addFiles([file], true)).toBe(1);

    expect(tracker.createMediaElementSourceCalls).toBe(1);
    expect(tracker.createMediaStreamSourceCalls).toBe(0);
    expect(tracker.optionsReceived).toEqual({ latencyHint: 'playback' });
    expect(tracker.compressors).toHaveLength(1);
    // Analyser must be tapped in parallel (not routed to destination)
    expect(tracker.analysers[0].connectedTo).toHaveLength(0);

    player.dispose();
  });

  it('detects native Android runtime via either window.DojoNative or Capacitor.isNativePlatform()', () => {
    expect(isNativeAndroidRuntime()).toBe(false);

    mockWin.DojoNative = {};
    expect(isNativeAndroidRuntime()).toBe(true);

    delete mockWin.DojoNative;
    mockWin.Capacitor = {
      isNativePlatform: () => true,
    };
    expect(isNativeAndroidRuntime()).toBe(true);
  });
});
