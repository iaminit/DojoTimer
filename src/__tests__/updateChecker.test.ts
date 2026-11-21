import { describe, expect, it, vi } from 'vitest';
import {
  computeSessionSummary,
  restartCurrentPhaseState,
  type TimerEngineState,
} from '../engine/timerMachine';
import {
  buildVersionManifestQueryUrl,
  checkForApkUpdate,
  compareSemver,
  OFFICIAL_APK_DOWNLOAD_URL,
  OFFICIAL_VERSION_MANIFEST_URL,
  parseRemoteVersionManifest,
  resolveTrustedApkUrl,
} from '../services/updateChecker';
import type { WorkoutProgram } from '../types/timer';

const SAMPLE_PROGRAM: WorkoutProgram = {
  id: 'summary-prog',
  name: 'Randori Judo',
  discipline: 'JUDO',
  rounds: 6,
  workSeconds: 180,
  restSeconds: 60,
  prepSeconds: 10,
  warningSeconds: 30,
  createdAt: 1000,
  updatedAt: 1000,
};

describe('APK update checker & security validation', () => {
  it('validates version manifests and rejects untrusted APK URLs', () => {
    expect(resolveTrustedApkUrl('https://1ms.it/timer/DojoTimer.apk')).toBe(
      'https://1ms.it/timer/DojoTimer.apk',
    );
    expect(resolveTrustedApkUrl('https://evil.example/DojoTimer.apk')).toBe(
      OFFICIAL_APK_DOWNLOAD_URL,
    );
    expect(resolveTrustedApkUrl('javascript:alert(1).apk')).toBe(OFFICIAL_APK_DOWNLOAD_URL);
    expect(resolveTrustedApkUrl('https://1ms.it/timer/../evil.apk')).toBe(
      OFFICIAL_APK_DOWNLOAD_URL,
    );

    const parsed = parseRemoteVersionManifest({
      version: '1.0.14',
      buildNumber: 14,
      commitSha: 'a1b2c3d',
      apkUrl: 'https://evil.example/bad.apk',
    });
    expect(parsed).toEqual({
      version: '1.0.14',
      buildNumber: 14,
      commitSha: 'a1b2c3d',
      apkUrl: OFFICIAL_APK_DOWNLOAD_URL,
    });

    expect(parseRemoteVersionManifest({ version: 'bad', buildNumber: 0 })).toBeNull();
  });

  it('detects available updates, up-to-date builds, and offline errors cleanly', async () => {
    const fetchNew = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        version: '1.0.15',
        buildNumber: 15,
        apkUrl: 'https://1ms.it/timer/DojoTimer.apk',
      }),
    })) as unknown as typeof fetch;

    const avail = await checkForApkUpdate(12, '1.0.12', fetchNew);
    expect(avail).toEqual({
      status: 'update-available',
      latestVersion: '1.0.15',
      latestBuildNumber: 15,
      downloadUrl: OFFICIAL_APK_DOWNLOAD_URL,
    });
    expect(fetchNew).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^${OFFICIAL_VERSION_MANIFEST_URL.replace('.', '\\.')}\\?v=1\\.0\\.12&build=12&t=\\d+$`),
      ),
      expect.objectContaining({ cache: 'no-store' }),
    );

    const current = await checkForApkUpdate(15, '1.0.15', fetchNew);
    expect(current).toEqual({
      status: 'up-to-date',
      latestVersion: '1.0.15',
      latestBuildNumber: 15,
    });

    // Detects update even if only semver version bumped in remote JSON
    const semverBump = await checkForApkUpdate(15, '1.0.14', fetchNew);
    expect(semverBump.status).toBe('update-available');

    // Detects update if commitSha changed on the exact same build number (e.g. amended/rebuilt release)
    const fetchNewCommit = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        version: '1.0.15',
        buildNumber: 15,
        commitSha: 'deadbee',
        apkUrl: 'https://1ms.it/timer/DojoTimer.apk',
      }),
    })) as unknown as typeof fetch;
    const sameBuildDifferentCommit = await checkForApkUpdate(15, '1.0.15', '26cda5f', fetchNewCommit);
    expect(sameBuildDifferentCommit.status).toBe('update-available');
    const sameBuildSameCommit = await checkForApkUpdate(15, '1.0.15', 'deadbee', fetchNewCommit);
    expect(sameBuildSameCommit.status).toBe('up-to-date');

    expect(compareSemver('1.0.13', '1.0.12')).toBe(1);
    expect(compareSemver('1.0.12', '1.0.12')).toBe(0);
    expect(compareSemver('1.0.11', '1.0.12')).toBe(-1);
    expect(buildVersionManifestQueryUrl(12, '1.0.12', 1700000000000)).toBe(
      'https://1ms.it/timer/version.json?v=1.0.12&build=12&t=1700000000000',
    );

    const fetchOffline = vi.fn(async () => {
      throw new Error('Network down');
    }) as unknown as typeof fetch;
    expect(await checkForApkUpdate(12, '1.0.12', fetchOffline)).toEqual({ status: 'offline' });
  });

  it('uses native Android HTTPS bridge when available (bypasses WebView CORS)', async () => {
    const origWindowDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');
    try {
      const mockWin: Record<string, unknown> = {};
      mockWin.DojoNative = {
        fetchVersionManifestAsync: (reqId: number) => {
          const cb = mockWin.__dojoOnUpdateManifest as (id: number, payload: string | null) => void;
          cb(
            reqId,
            JSON.stringify({
              version: '1.0.20',
              buildNumber: 20,
              apkUrl: 'https://1ms.it/timer/DojoTimer.apk',
            }),
          );
        },
      };
      Object.defineProperty(globalThis, 'window', {
        value: mockWin,
        writable: true,
        configurable: true,
      });

      const res = await checkForApkUpdate(12, '1.0.12');
      expect(res).toEqual({
        status: 'update-available',
        latestVersion: '1.0.20',
        latestBuildNumber: 20,
        downloadUrl: 'https://1ms.it/timer/DojoTimer.apk',
      });
    } finally {
      if (origWindowDesc) {
        Object.defineProperty(globalThis, 'window', origWindowDesc);
      }
    }
  });
});

describe('restartCurrentPhaseState & computeSessionSummary', () => {
  it('restarts only the current round/phase without resetting round number', () => {
    const midWork: TimerEngineState = {
      program: SAMPLE_PROGRAM,
      phase: 'WORK',
      currentRound: 4,
      remainingMs: 42_000,
      phaseDurationMs: 180_000,
      isPaused: false,
      activeQuickPresetMinutes: null,
    };

    const restartedWork = restartCurrentPhaseState(midWork);
    expect(restartedWork.phase).toBe('WORK');
    expect(restartedWork.currentRound).toBe(4);
    expect(restartedWork.remainingMs).toBe(180_000);
    expect(restartedWork.phaseDurationMs).toBe(180_000);

    const midRest: TimerEngineState = {
      ...midWork,
      phase: 'REST',
      remainingMs: 15_000,
      phaseDurationMs: 60_000,
    };
    const restartedRest = restartCurrentPhaseState(midRest);
    expect(restartedRest.phase).toBe('REST');
    expect(restartedRest.currentRound).toBe(4);
    expect(restartedRest.remainingMs).toBe(60_000);
  });

  it('computes accurate completed rounds and total work/rest durations', () => {
    expect(computeSessionSummary(SAMPLE_PROGRAM)).toEqual({
      rounds: 6,
      totalWorkSeconds: 1080,
      totalRestSeconds: 300,
      totalSessionSeconds: 1380,
    });
  });
});
