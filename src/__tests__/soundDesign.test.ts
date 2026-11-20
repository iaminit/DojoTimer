import { describe, expect, it } from 'vitest';
import { renderBoxingBell, renderCountdownPulse, renderGong, renderWarning } from '../services/soundDesign';

function peak(samples: Float32Array): number {
  let maximum = 0;
  for (const sample of samples) maximum = Math.max(maximum, Math.abs(sample));
  return maximum;
}

function energy(samples: Float32Array, start: number, end: number): number {
  let total = 0;
  for (let i = start; i < end; i += 1) total += samples[i] ** 2;
  return total / Math.max(1, end - start);
}

describe.each([44100, 48000])('sound design at %i Hz', (rate) => {
  it('renders a finite gong with headroom, a decaying body and silent boundaries', () => {
    const gong = renderGong(rate);
    expect(gong.length).toBe(Math.ceil(rate * 2.6));
    expect(gong.every(Number.isFinite)).toBe(true);
    expect(peak(gong)).toBeGreaterThan(0.7);
    expect(peak(gong)).toBeLessThanOrEqual(0.821);
    expect(gong[0]).toBeCloseTo(0, 8);
    expect(gong[gong.length - 1]).toBeCloseTo(0, 8);
    expect(energy(gong, rate * 2, Math.floor(rate * 2.2)))
      .toBeLessThan(energy(gong, 0, Math.floor(rate * 0.2)) * 0.01);
  });

  it('separates two warning knocks with silence and a stronger second knock', () => {
    const warning = renderWarning(rate);
    const firstPeak = peak(warning.slice(0, Math.floor(rate * 0.15)));
    const secondPeak = peak(warning.slice(Math.floor(rate * 0.19)));
    expect(secondPeak).toBeGreaterThan(firstPeak);
    expect(peak(warning.slice(Math.floor(rate * 0.14), Math.floor(rate * 0.19))))
      .toBeLessThan(0.001);
    expect(peak(warning)).toBeLessThanOrEqual(0.621);
  });

  it('increases final-five emphasis while keeping every pulse well below one second', () => {
    let previousPeak = 0;
    for (const second of [5, 4, 3, 2, 1]) {
      const pulse = renderCountdownPulse(rate, second);
      expect(pulse.every(Number.isFinite)).toBe(true);
      expect(pulse.length / rate).toBeLessThan(0.21);
      expect(peak(pulse)).toBeGreaterThan(previousPeak);
      expect(peak(pulse)).toBeLessThan(0.63);
      expect(pulse[0]).toBeCloseTo(0, 8);
      expect(pulse[pulse.length - 1]).toBeCloseTo(0, 8);
      previousPeak = peak(pulse);
    }
  });

  it('keeps shared effects deterministic for Judo, BJJ and listening previews', () => {
    expect(renderGong(rate)).toEqual(renderGong(rate));
    expect(renderWarning(rate)).toEqual(renderWarning(rate));
    expect(renderCountdownPulse(rate, 1)).toEqual(renderCountdownPulse(rate, 1));
    expect(renderBoxingBell(rate, 1)).toEqual(renderBoxingBell(rate, 1));
    expect(renderBoxingBell(rate, 3)).toEqual(renderBoxingBell(rate, 3));
  });

  it('renders finite 1x warning and 3x end boxing bell fallbacks without boundary clicks', () => {
    const single = renderBoxingBell(rate, 1);
    const triple = renderBoxingBell(rate, 3);
    expect(single.every(Number.isFinite)).toBe(true);
    expect(triple.every(Number.isFinite)).toBe(true);
    expect(peak(single)).toBeGreaterThan(0.45);
    expect(peak(single)).toBeLessThanOrEqual(0.51);
    expect(peak(triple)).toBeGreaterThan(0.7);
    expect(peak(triple)).toBeLessThanOrEqual(0.76);
    expect(single[0]).toBeCloseTo(0, 8);
    expect(single[single.length - 1]).toBeCloseTo(0, 8);
    expect(triple[0]).toBeCloseTo(0, 8);
    expect(triple[triple.length - 1]).toBeCloseTo(0, 8);
  });
});
