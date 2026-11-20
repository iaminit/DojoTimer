import { describe, expect, it } from 'vitest';
import { resolveTimerPhaseBannerLabel } from '../utils/themePalette';

describe('resolveTimerPhaseBannerLabel timer phase banner', () => {
  it('shows RANDORI for JUDO work and SPARRING for BJJ work', () => {
    expect(resolveTimerPhaseBannerLabel('WORK', 'JUDO')).toBe('RANDORI');
    expect(resolveTimerPhaseBannerLabel('WORK', 'BJJ')).toBe('SPARRING');
  });

  it('shows RECUPERO for both disciplines during rest', () => {
    expect(resolveTimerPhaseBannerLabel('REST', 'JUDO')).toBe('RECUPERO');
    expect(resolveTimerPhaseBannerLabel('REST', 'BJJ')).toBe('RECUPERO');
  });

  it('maps PREP, IDLE, and FINISHED cleanly per discipline', () => {
    expect(resolveTimerPhaseBannerLabel('PREP', 'JUDO')).toBe('PREPARAZIONE');
    expect(resolveTimerPhaseBannerLabel('PREP', 'BJJ')).toBe('PREPARAZIONE');
    expect(resolveTimerPhaseBannerLabel('IDLE', 'JUDO')).toBe('PRONTO');
    expect(resolveTimerPhaseBannerLabel('IDLE', 'BJJ')).toBe('PRONTO');
    expect(resolveTimerPhaseBannerLabel('FINISHED', 'JUDO')).toBe('SOREMADE');
    expect(resolveTimerPhaseBannerLabel('FINISHED', 'BJJ')).toBe('FINE SESSIONE');
  });
});
