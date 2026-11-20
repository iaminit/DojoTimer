import { describe, expect, it } from 'vitest';
import { resolveApkDownloadUrl } from '../components/setup/SetupOptionsModal';
import {
  MAX_IMPORT_JSON_BYTES,
  MAX_STORED_PROGRAMS,
  parseImportProgramsJson,
  sanitizeTextInput,
  sanitizeWorkoutProgram,
} from '../services/storage';
import type { WorkoutProgram } from '../types/timer';
import {
  APP_BUILD_NUMBER,
  APP_VERSION,
  formatAppVersionLabel,
} from '../utils/appVersion';

function makeValidProgram(index: number): WorkoutProgram {
  return {
    id: `prog-${index}`,
    name: `Program ${index}`,
    discipline: 'JUDO',
    rounds: 5,
    workSeconds: 180,
    restSeconds: 60,
    prepSeconds: 10,
    warningSeconds: 30,
    createdAt: 1_700_000_000_000 + index,
    updatedAt: 1_700_000_000_000 + index,
  };
}

describe('Security hardening: JSON import limits, text/ID sanitization & URL guards', () => {
  it('strips ASCII control chars and Unicode BiDi override characters from names', () => {
    const poisoned = '  Randori\u0000\u0007 \u202Egpj.exe\u202C \u2066test\u2069  ';
    expect(sanitizeTextInput(poisoned, 80)).toBe('Randori gpj.exe test');
  });

  it('replaces prototype-polluting or oversized program IDs with safe UUIDs', () => {
    for (const badId of ['__proto__', 'constructor', 'prototype', 'a'.repeat(120), '../evil']) {
      const sanitized = sanitizeWorkoutProgram({
        id: badId,
        name: 'Test',
        discipline: 'JUDO',
        rounds: 3,
        workSeconds: 120,
      });
      expect(sanitized).not.toBeNull();
      expect(sanitized!.id).not.toBe(badId);
      expect(/^[A-Za-z0-9_-]{1,64}$/.test(sanitized!.id)).toBe(true);
    }
  });

  it('rejects oversized JSON imports above 512 KB before parsing', () => {
    const huge = '[' + ' '.repeat(MAX_IMPORT_JSON_BYTES + 10) + ']';
    const res = parseImportProgramsJson(huge, []);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('512 KB');
    }
  });

  it('enforces MAX_STORED_PROGRAMS cap during JSON import', () => {
    const existing = Array.from({ length: MAX_STORED_PROGRAMS - 2 }, (_, i) => makeValidProgram(i));
    const incoming = Array.from({ length: 10 }, (_, i) => ({
      name: `Imported ${i}`,
      discipline: 'BJJ',
      rounds: 4,
      workSeconds: 180,
    }));

    const res = parseImportProgramsJson(JSON.stringify(incoming), existing);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.importedCount).toBe(2);
      expect(res.skippedCount).toBe(8);
      expect(res.programs).toHaveLength(MAX_STORED_PROGRAMS);
    }

    const full = Array.from({ length: MAX_STORED_PROGRAMS }, (_, i) => makeValidProgram(i));
    const blocked = parseImportProgramsJson(JSON.stringify(incoming), full);
    expect(blocked.ok).toBe(false);
  });

  it('restricts APK download URL to safe same-origin relative paths', () => {
    expect(resolveApkDownloadUrl('/')).toBe('/DojoTimer.apk');
    expect(resolveApkDownloadUrl('/timer/')).toBe('/timer/DojoTimer.apk');
    expect(resolveApkDownloadUrl('/timer')).toBe('/timer/DojoTimer.apk');
    expect(resolveApkDownloadUrl('//evil.example/')).toBe('/DojoTimer.apk');
    expect(resolveApkDownloadUrl('javascript:alert(1)//')).toBe('/DojoTimer.apk');
    expect(resolveApkDownloadUrl('https://evil.example/')).toBe('/DojoTimer.apk');
  });

  it('exposes a monotonic progressive version and formats version labels cleanly', () => {
    expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(1);
    expect(/^\d+\.\d+\.\d+$/.test(APP_VERSION)).toBe(true);
    expect(formatAppVersionLabel('1.0.5', 5, '66c99f3')).toBe('v1.0.5 • Build #5 • 66c99f3');
    expect(formatAppVersionLabel('1.0.5', 5, 'local')).toBe('v1.0.5 • Build #5');
  });
});
