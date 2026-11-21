import { describe, expect, it } from 'vitest';
import {
  ACTIVE_GONG_CLIPS,
  computeGongClipSyncPlan,
  MAX_GONG_CLIP_IMPACT_MS,
  pickRandomGongClip,
  resolveGongClipUrl,
} from '../utils/gongClips';

describe('Gong cinematic video clips random rotation & millisecond audio sync', () => {
  it('registers karateka, judoka and sumotori clips with accurate impact timestamps', () => {
    expect(ACTIVE_GONG_CLIPS.map((c) => c.id)).toEqual(['karateka', 'judoka', 'sumotori']);
    expect(MAX_GONG_CLIP_IMPACT_MS).toBe(1340);
    expect(resolveGongClipUrl('video/gong-karateka.mp4', '/timer/')).toBe(
      '/timer/video/gong-karateka.mp4',
    );
    expect(resolveGongClipUrl('video/gong-judoka.mp4', '/timer/')).toBe(
      '/timer/video/gong-judoka.mp4',
    );
    expect(resolveGongClipUrl('video/gong-sumotori.mp4', '/')).toBe('/video/gong-sumotori.mp4');
  });

  it('picks randomly without repeating the previous clip consecutively', () => {
    const first = pickRandomGongClip(ACTIVE_GONG_CLIPS, null, () => 0.05);
    expect(first?.id).toBe('karateka');

    // Even with rng=0, must exclude karateka and pick from [judoka, sumotori]
    const second = pickRandomGongClip(ACTIVE_GONG_CLIPS, 'karateka', () => 0);
    expect(second?.id).toBe('judoka');

    const third = pickRandomGongClip(ACTIVE_GONG_CLIPS, 'judoka', () => 0.99);
    expect(third?.id).toBe('sumotori');
  });

  it('aligns pre-cue delay and start offset to land clip impact exactly on gong.mp3', () => {
    const karateka = ACTIVE_GONG_CLIPS[0]; // impactMs: 1240, durationMs: 3000
    const judoka = ACTIVE_GONG_CLIPS[1]; // impactMs: 1240, durationMs: 3000
    const sumotori = ACTIVE_GONG_CLIPS[2]; // impactMs: 1340, durationMs: 3000

    // Pre-cued 1340ms before gong: karateka/judoka wait 100ms then play from 0s; sumotori plays immediately
    const kPre = computeGongClipSyncPlan(karateka, 1340);
    expect(kPre.delayBeforeStartMs).toBe(100);
    expect(kPre.startOffsetSec).toBe(0);
    expect(kPre.playDurationMs).toBe(3000);

    const jPre = computeGongClipSyncPlan(judoka, 1340);
    expect(jPre.delayBeforeStartMs).toBe(100);
    expect(jPre.startOffsetSec).toBe(0);

    const sPre = computeGongClipSyncPlan(sumotori, 1340);
    expect(sPre.delayBeforeStartMs).toBe(0);
    expect(sPre.startOffsetSec).toBe(0);
    expect(sPre.playDurationMs).toBe(3000);

    // Direct VOICE_GONG start with prep=0 (500ms Hajime delay): jumps straight to wind-up so punch lands at +500ms
    const kHajime = computeGongClipSyncPlan(karateka, 500);
    expect(kHajime.delayBeforeStartMs).toBe(0);
    expect(kHajime.startOffsetSec).toBeCloseTo(0.74, 3);
    expect(kHajime.playDurationMs).toBe(2260);

    // Direct GONG_ONLY start with prep=0 (0ms delay): starts 80ms before contact for instant impact
    const sInstant = computeGongClipSyncPlan(sumotori, 0);
    expect(sInstant.delayBeforeStartMs).toBe(0);
    expect(sInstant.startOffsetSec).toBeCloseTo(1.26, 3);
  });
});
