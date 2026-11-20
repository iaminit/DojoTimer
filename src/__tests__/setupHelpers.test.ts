import { describe, expect, it } from 'vitest';
import {
  buildProgramFromDraft,
  createEmptyDraft,
  programToDraft,
} from '../components/setup/ProgramEditorForm';
import { resolveApkDownloadUrl } from '../components/setup/SetupOptionsModal';
import { PROGRAM_LIMITS, resolveLandingProgramForDiscipline } from '../services/storage';
import type { WorkoutProgram } from '../types/timer';
import { classifyTouchGesture } from '../utils/wheelMath';

describe('ProgramEditorForm draft helpers', () => {
  it('builds discipline defaults for JUDO and BJJ', () => {
    const judo = createEmptyDraft('JUDO');
    expect(judo.id).toBeNull();
    expect(judo.discipline).toBe('JUDO');
    expect(judo.rounds).toBe(6);
    expect(judo.workMinutes).toBe(3);
    expect(judo.workSeconds).toBe(0);
    expect(judo.prepSeconds).toBe(10);
    expect(judo.warningSeconds).toBe(30);

    const bjj = createEmptyDraft('BJJ');
    expect(bjj.id).toBeNull();
    expect(bjj.discipline).toBe('BJJ');
    expect(bjj.rounds).toBe(6);
    expect(bjj.workMinutes).toBe(4);
    expect(bjj.workSeconds).toBe(0);
  });

  it('splits minutes and seconds cleanly in programToDraft', () => {
    const prog: WorkoutProgram = {
      id: 'p-1',
      name: 'Ne-Waza',
      discipline: 'JUDO',
      rounds: 6,
      workSeconds: 195,
      restSeconds: 75,
      prepSeconds: 15,
      warningSeconds: 20,
      createdAt: 100,
      updatedAt: 200,
    };

    const draft = programToDraft(prog);
    expect(draft).toEqual({
      id: 'p-1',
      name: 'Ne-Waza',
      discipline: 'JUDO',
      rounds: 6,
      workMinutes: 3,
      workSeconds: 15,
      restMinutes: 1,
      restSeconds: 15,
      prepSeconds: 15,
      warningSeconds: 20,
    });
  });

  it('clamps out-of-range fields, trims/truncates names, and preserves existing ID/createdAt', () => {
    const clamped = buildProgramFromDraft(
      {
        id: null,
        name: '   ',
        discipline: 'BJJ',
        rounds: 999,
        workMinutes: 0,
        workSeconds: 1,
        restMinutes: 90,
        restSeconds: 0,
        prepSeconds: 999,
        warningSeconds: 999,
      },
      null,
      5000,
      () => 'generated-id-1',
    );

    expect(clamped.id).toBe('generated-id-1');
    expect(clamped.name).toBe('Programma Senza Nome');
    expect(clamped.rounds).toBe(PROGRAM_LIMITS.rounds.max);
    expect(clamped.workSeconds).toBe(PROGRAM_LIMITS.workSeconds.min);
    expect(clamped.restSeconds).toBe(PROGRAM_LIMITS.restSeconds.max);
    expect(clamped.prepSeconds).toBe(PROGRAM_LIMITS.prepSeconds.max);
    expect(clamped.warningSeconds).toBe(PROGRAM_LIMITS.warningSeconds.max);
    expect(clamped.createdAt).toBe(5000);
    expect(clamped.updatedAt).toBe(5000);

    const longName = 'A'.repeat(120);
    const existing: WorkoutProgram = {
      id: 'orig-id',
      name: 'Vecchio',
      discipline: 'JUDO',
      rounds: 4,
      workSeconds: 240,
      restSeconds: 60,
      prepSeconds: 10,
      warningSeconds: 30,
      createdAt: 1234,
      updatedAt: 1234,
    };

    const edited = buildProgramFromDraft(
      {
        id: 'orig-id',
        name: longName,
        discipline: 'JUDO',
        rounds: 0,
        workMinutes: 200,
        workSeconds: 0,
        restMinutes: 0,
        restSeconds: 0,
        prepSeconds: -5,
        warningSeconds: -5,
      },
      existing,
      9000,
      () => 'should-not-use',
    );

    expect(edited.id).toBe('orig-id');
    expect(edited.name.length).toBe(80);
    expect(edited.rounds).toBe(PROGRAM_LIMITS.rounds.min);
    expect(edited.workSeconds).toBe(PROGRAM_LIMITS.workSeconds.max);
    expect(edited.restSeconds).toBe(0);
    expect(edited.prepSeconds).toBe(0);
    expect(edited.warningSeconds).toBe(0);
    expect(edited.createdAt).toBe(1234);
    expect(edited.updatedAt).toBe(9000);
  });

  it('resolves DojoTimer.apk path inside active BASE_URL without duplicate slashes', () => {
    expect(resolveApkDownloadUrl('/')).toBe('/DojoTimer.apk');
    expect(resolveApkDownloadUrl('/timer/')).toBe('/timer/DojoTimer.apk');
    expect(resolveApkDownloadUrl('/timer')).toBe('/timer/DojoTimer.apk');
  });

  it('resolves base program for JUDO and BJJ landing cards with saved-ID priority and fallback', () => {
    const programs: WorkoutProgram[] = [
      {
        id: 'judo-base',
        name: 'Randori Judo',
        discipline: 'JUDO',
        rounds: 6,
        workSeconds: 180,
        restSeconds: 60,
        prepSeconds: 10,
        warningSeconds: 30,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'judo-custom',
        name: 'Gara 5 Min',
        discipline: 'JUDO',
        rounds: 4,
        workSeconds: 300,
        restSeconds: 60,
        prepSeconds: 10,
        warningSeconds: 30,
        createdAt: 2,
        updatedAt: 2,
      },
      {
        id: 'bjj-base',
        name: 'Sparring BJJ',
        discipline: 'BJJ',
        rounds: 6,
        workSeconds: 240,
        restSeconds: 60,
        prepSeconds: 10,
        warningSeconds: 30,
        createdAt: 3,
        updatedAt: 3,
      },
    ];

    expect(resolveLandingProgramForDiscipline(programs, 'JUDO').id).toBe('judo-base');
    expect(resolveLandingProgramForDiscipline(programs, 'BJJ').id).toBe('bjj-base');
    expect(resolveLandingProgramForDiscipline(programs, 'JUDO', 'judo-custom').id).toBe(
      'judo-custom',
    );
    // Ignores saved ID belonging to the opposite discipline
    expect(resolveLandingProgramForDiscipline(programs, 'JUDO', 'bjj-base').id).toBe('judo-base');
    // Falls back cleanly to seeded discipline defaults when user deleted all entries
    expect(resolveLandingProgramForDiscipline([], 'BJJ').name).toBe('Sparring BJJ');
    expect(resolveLandingProgramForDiscipline([], 'JUDO').name).toBe('Randori Judo');
  });

  it('distinguishes vertical touch scroll from horizontal value scrub cleanly', () => {
    expect(classifyTouchGesture(3, -5)).toBe('pending');
    expect(classifyTouchGesture(-2, -12)).toBe('vertical');
    expect(classifyTouchGesture(6, 14)).toBe('vertical');
    expect(classifyTouchGesture(12, 4)).toBe('horizontal');
    expect(classifyTouchGesture(-10, -10)).toBe('horizontal');
  });
});
