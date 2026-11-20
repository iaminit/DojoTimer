/** Mono synthesis shared by live playback and the downloadable listening demos. */
export const FINAL_FIVE_SCALE_HZ: Readonly<Record<1 | 2 | 3 | 4 | 5, number>> = {
  5: 1318.51,
  4: 1174.66,
  3: 987.77,
  2: 880,
  1: 659.25,
};

const TAU = Math.PI * 2;

function finish(samples: Float32Array, peak: number): Float32Array {
  let maximum = 0;
  for (const sample of samples) maximum = Math.max(maximum, Math.abs(sample));
  if (maximum === 0) return samples;
  const scale = peak / maximum;
  // Fade the boundaries so a truncated resonant tail cannot click.
  const fade = Math.min(256, Math.floor(samples.length / 4));
  for (let i = 0; i < samples.length; i += 1) {
    const edge = Math.min(1, i / fade, (samples.length - 1 - i) / fade);
    samples[i] *= scale * edge;
  }
  return samples;
}

/** Inharmonic bronze modes, gentle beating and a felt-mallet attack. No saturation. */
export function renderGong(sampleRate: number, duration = 2.6, pitch = 1): Float32Array {
  const samples = new Float32Array(Math.ceil(sampleRate * duration));
  const modes = [
    [196, 0.48, 1], [293.3, 0.3, 0.9], [419.1, 0.24, 0.78],
    [568.8, 0.17, 0.68], [786.7, 0.13, 0.54], [1069, 0.09, 0.44],
    [1451, 0.06, 0.33], [2017, 0.035, 0.24], [2743, 0.018, 0.17],
  ];
  for (let i = 0; i < samples.length; i += 1) {
    const t = i / sampleRate;
    let value = 0;
    for (const [frequency, amplitude, decay] of modes) {
      const envelope = (1 - Math.exp(-t / 0.003)) * Math.exp(-6.5 * t / (duration * decay));
      const phase = TAU * frequency * pitch * t;
      value += amplitude * envelope * (Math.sin(phase) + 0.16 * Math.sin(phase + TAU * 1.7 * t));
    }
    // Short low-mid strike remains audible on small speakers without a harsh noise burst.
    value += 0.16 * Math.sin(TAU * (340 * t + 2.2 * (1 - Math.exp(-t * 65))))
      * Math.exp(-t * 65) * (1 - Math.exp(-t * 900));
    samples[i] = value;
  }
  return finish(samples, 0.82);
}

/** A recognisable hollow wooden double knock; deliberately distinct from the gong. */
export function renderWarning(sampleRate: number): Float32Array {
  const samples = new Float32Array(Math.ceil(sampleRate * 0.48));
  for (const [offset, level] of [[0, 0.85], [0.19, 1]]) {
    for (let i = 0; i < Math.floor(sampleRate * 0.19); i += 1) {
      const t = i / sampleRate;
      const attack = 1 - Math.exp(-t * 1800);
      const wood = Math.sin(TAU * 920 * t) * Math.exp(-t * 60)
        + 0.45 * Math.sin(TAU * 1747 * t) * Math.exp(-t * 85)
        + 0.22 * Math.sin(TAU * 2630 * t) * Math.exp(-t * 120);
      samples[Math.round(offset * sampleRate) + i] += wood * attack * level;
    }
  }
  return finish(samples, 0.62);
}

/** Metallic fallback for the sampled boxing bell if decoding fails. */
export function renderBoxingBell(sampleRate: number, strikes: 1 | 3): Float32Array {
  const spacing = Math.round(sampleRate * 0.24);
  const tail = Math.round(sampleRate * 0.61);
  const pitch = strikes === 1 ? 1.26 : 1;
  const samples = new Float32Array((strikes - 1) * spacing + tail);
  for (let hit = 0; hit < strikes; hit += 1) {
    for (let i = 0; i < tail; i += 1) {
      const t = i / sampleRate;
      const phase = TAU * pitch * t;
      const attack = 1 - Math.exp(-t * 1500);
      const ring = Math.sin(phase * 1060) * Math.exp(-t * 9)
        + 0.56 * Math.sin(phase * 1762) * Math.exp(-t * 15)
        + 0.27 * Math.sin(phase * 2670) * Math.exp(-t * 34);
      samples[hit * spacing + i] += attack * ring;
    }
  }
  return finish(samples, strikes === 1 ? 0.5 : 0.75);
}

/** One pulse per second: descending pitch, shorter articulation and gradual emphasis. */
export function renderCountdownPulse(sampleRate: number, second: number): Float32Array {
  const final = second >= 1 && second <= 5;
  const step = final ? 5 - second : 0;
  const frequency = final ? FINAL_FIVE_SCALE_HZ[second as 1 | 2 | 3 | 4 | 5] : 987.77;
  const duration = final ? 0.2 - step * 0.015 : 0.14;
  const samples = new Float32Array(Math.ceil(sampleRate * duration));
  for (let i = 0; i < samples.length; i += 1) {
    const t = i / sampleRate;
    const envelope = (1 - Math.exp(-t * 900)) * Math.exp(-t * 6 / duration);
    samples[i] = envelope * (Math.sin(TAU * frequency * t)
      + 0.16 * Math.sin(TAU * frequency * 2 * t)
      + (second === 1 ? 0.18 * Math.sin(TAU * frequency * 0.5 * t) : 0));
  }
  return finish(samples, final ? 0.4 + step * 0.055 : 0.3);
}
