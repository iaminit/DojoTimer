import { describe, expect, it } from 'vitest';
import {
  buildPeriodicCrestPath,
  buildPeriodicWavePath,
  buildVerticalPeriodicCrestPath,
  buildVerticalPeriodicWavePath,
  CLASSIC_CIRCLE_DIAMETER_CSS,
  CIRCLE_WAVE_ZOOM,
  computeWaterFillMetrics,
  WATER_MAX_OPACITY,
  WATER_MIN_OPACITY,
  WAVE_BACK_STROKE,
  WAVE_BASE_AMP,
  WAVE_CREST_STROKE,
  WAVE_PERIOD_UNITS,
} from '../utils/waterFill';

describe('waterFill progressive liquid level & saturation', () => {
  it('stays hidden at zero progress and starts at 15% opacity as phase begins', () => {
    const empty = computeWaterFillMetrics(0);
    expect(empty.isVisible).toBe(false);
    expect(empty.baseOpacity).toBe(0);
    expect(empty.waterSurfaceY).toBe(310);

    const start = computeWaterFillMetrics(0.001);
    expect(start.isVisible).toBe(true);
    expect(start.baseOpacity).toBeGreaterThanOrEqual(WATER_MIN_OPACITY);
    expect(start.baseOpacity).toBeCloseTo(0.1508, 3);
    expect(start.waterSurfaceY).toBeCloseTo(309.7, 2);
  });

  it('raises level and saturates color monotonically up to 94% opaque at 100%', () => {
    const q1 = computeWaterFillMetrics(0.25);
    const half = computeWaterFillMetrics(0.5);
    const q3 = computeWaterFillMetrics(0.75);
    const full = computeWaterFillMetrics(1);

    expect(q1.waterSurfaceY).toBeGreaterThan(half.waterSurfaceY);
    expect(half.waterSurfaceY).toBeGreaterThan(q3.waterSurfaceY);
    expect(q3.waterSurfaceY).toBeGreaterThan(full.waterSurfaceY);

    expect(q1.baseOpacity).toBeLessThan(half.baseOpacity);
    expect(half.baseOpacity).toBeLessThan(q3.baseOpacity);
    expect(q3.baseOpacity).toBeLessThan(full.baseOpacity);

    expect(half.waterSurfaceY).toBe(160);
    expect(half.baseOpacity).toBeCloseTo(0.545, 3);
    expect(half.waveAmplitude).toBeGreaterThan(0);

    expect(full.waterSurfaceY).toBe(10);
    expect(full.waveAmplitude).toBe(0);
    expect(full.baseOpacity).toBe(WATER_MAX_OPACITY);
  });

  it('builds valid closed periodic wave and meniscus SVG paths', () => {
    const path = buildPeriodicWavePath(160, 6.5, 0);
    expect(path.startsWith('M 0 160')).toBe(true);
    expect(path).toContain('Q 80 147 160 160');
    expect(path).toContain('T 640 160');
    expect(path.endsWith('L 640 330 L 0 330 Z')).toBe(true);

    const crest = buildPeriodicCrestPath(160, 6.5, -320);
    expect(crest.startsWith('M -320 160')).toBe(true);
    expect(crest).toContain('T 320 160');
  });

  it('builds valid vertical periodic wave and crest SVG paths for landscape advancing fill', () => {
    const wave = buildVerticalPeriodicWavePath(14, 6.5, 0, -2);
    expect(wave.startsWith('M 14 0')).toBe(true);
    expect(wave).toContain('Q 27 80 14 160');
    expect(wave).toContain('T 14 640');
    expect(wave.endsWith('L -2 640 L -2 0 Z')).toBe(true);

    const crest = buildVerticalPeriodicCrestPath(14, 6.5, -320);
    expect(crest.startsWith('M 14 -320')).toBe(true);
    expect(crest).toContain('T 14 320');
  });

  it('builds 10-period seamless paths and exposes unified 1.0x vs 1.5x wave scale tokens', () => {
    expect(WAVE_PERIOD_UNITS).toBe(320);
    expect(WAVE_BASE_AMP).toBe(9);
    expect(WAVE_CREST_STROKE).toBe(3.2);
    expect(WAVE_BACK_STROKE).toBe(1.8);
    expect(CIRCLE_WAVE_ZOOM).toBe(1.5);
    expect(CLASSIC_CIRCLE_DIAMETER_CSS).toBe('min(93vw, 62dvh, 660px)');

    const hWave = buildPeriodicWavePath(20, WAVE_BASE_AMP, 0, 44, 10);
    expect(hWave.startsWith('M 0 20 Q 80 2 160 20')).toBe(true);
    expect(hWave).toContain('T 3200 20');
    expect(hWave.endsWith('L 3200 44 L 0 44 Z')).toBe(true);

    const hCrest = buildPeriodicCrestPath(20, WAVE_BASE_AMP, 0, 10);
    expect(hCrest.endsWith('T 3200 20')).toBe(true);

    const vWave = buildVerticalPeriodicWavePath(20, WAVE_BASE_AMP, -320, -4, 10);
    expect(vWave.startsWith('M 20 -320 Q 38 -240 20 -160')).toBe(true);
    expect(vWave).toContain('T 20 2880');
    expect(vWave.endsWith('L -4 2880 L -4 -320 Z')).toBe(true);
  });
});
