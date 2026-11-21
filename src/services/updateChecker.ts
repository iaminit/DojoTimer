import { fetchNativeRemoteVersionManifest } from './nativeAndroid';

export const OFFICIAL_VERSION_MANIFEST_URL = 'https://1ms.it/timer/version.json';
export const OFFICIAL_APK_DOWNLOAD_URL = 'https://1ms.it/timer/DojoTimer.apk';

export interface RemoteVersionManifest {
  version: string;
  buildNumber: number;
  commitSha?: string;
  apkUrl: string;
}

export type ApkUpdateCheckResult =
  | {
      status: 'up-to-date';
      latestVersion: string;
      latestBuildNumber: number;
    }
  | {
      status: 'update-available';
      latestVersion: string;
      latestBuildNumber: number;
      downloadUrl: string;
    }
  | {
      status: 'offline';
    };

const SAFE_VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,5}$/;
const SAFE_SHA_RE = /^[0-9a-f]{4,12}$/i;

export function compareSemver(a: string, b: string): number {
  if (!SAFE_VERSION_RE.test(a) || !SAFE_VERSION_RE.test(b)) {
    return 0;
  }
  const pa = a.split('.').map((n) => Number.parseInt(n, 10));
  const pb = b.split('.').map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) {
      return pa[i] > pb[i] ? 1 : -1;
    }
  }
  return 0;
}

export function buildVersionManifestQueryUrl(
  currentBuildNumber: number,
  currentVersion = '0.0.0',
  nowMs = Date.now(),
): string {
  const safeVersion = SAFE_VERSION_RE.test(currentVersion) ? currentVersion : '0.0.0';
  const safeBuild = Number.isFinite(currentBuildNumber)
    ? Math.max(0, Math.round(currentBuildNumber))
    : 0;
  const safeTs = Number.isFinite(nowMs) ? Math.max(0, Math.round(nowMs)) : 0;
  return `${OFFICIAL_VERSION_MANIFEST_URL}?v=${encodeURIComponent(safeVersion)}&build=${safeBuild}&t=${safeTs}`;
}

export function resolveTrustedApkUrl(rawUrl: unknown): string {
  if (typeof rawUrl === 'string') {
    const trimmed = rawUrl.trim();
    if (
      trimmed.startsWith('https://1ms.it/timer/') &&
      trimmed.endsWith('.apk') &&
      !trimmed.includes('..') &&
      !trimmed.includes('@')
    ) {
      return trimmed;
    }
  }
  return OFFICIAL_APK_DOWNLOAD_URL;
}

export function parseRemoteVersionManifest(raw: unknown): RemoteVersionManifest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const version = typeof obj.version === 'string' ? obj.version.trim() : '';
  const buildNumber =
    typeof obj.buildNumber === 'number' && Number.isInteger(obj.buildNumber)
      ? obj.buildNumber
      : NaN;

  if (!SAFE_VERSION_RE.test(version) || !Number.isFinite(buildNumber) || buildNumber < 1) {
    return null;
  }

  const rawSha = typeof obj.commitSha === 'string' ? obj.commitSha.trim() : '';
  return {
    version,
    buildNumber,
    commitSha: SAFE_SHA_RE.test(rawSha) ? rawSha : undefined,
    apkUrl: resolveTrustedApkUrl(obj.apkUrl),
  };
}

function evaluateManifest(
  manifest: RemoteVersionManifest,
  currentBuildNumber: number,
  currentVersion?: string,
  currentCommitSha?: string,
): ApkUpdateCheckResult {
  const newerByBuild = manifest.buildNumber > currentBuildNumber;
  const newerByVersion =
    typeof currentVersion === 'string' && compareSemver(manifest.version, currentVersion) > 0;
  const changedCommitOnSameBuild =
    manifest.buildNumber === currentBuildNumber &&
    Boolean(manifest.commitSha) &&
    typeof currentCommitSha === 'string' &&
    SAFE_SHA_RE.test(currentCommitSha) &&
    manifest.commitSha!.toLowerCase() !== currentCommitSha.toLowerCase();

  if (newerByBuild || newerByVersion || changedCommitOnSameBuild) {
    return {
      status: 'update-available',
      latestVersion: manifest.version,
      latestBuildNumber: manifest.buildNumber,
      downloadUrl: manifest.apkUrl,
    };
  }
  return {
    status: 'up-to-date',
    latestVersion: manifest.version,
    latestBuildNumber: manifest.buildNumber,
  };
}

export async function checkForApkUpdate(
  currentBuildNumber: number,
  fetchImplOrVersion?: typeof fetch | string,
  explicitFetchImplOrCommit?: typeof fetch | string,
  explicitFetchImpl?: typeof fetch,
): Promise<ApkUpdateCheckResult> {
  const currentVersion =
    typeof fetchImplOrVersion === 'string' ? fetchImplOrVersion : undefined;
  const currentCommitSha =
    typeof explicitFetchImplOrCommit === 'string' ? explicitFetchImplOrCommit : undefined;
  const injectedFetch =
    typeof fetchImplOrVersion === 'function'
      ? fetchImplOrVersion
      : typeof explicitFetchImplOrCommit === 'function'
        ? explicitFetchImplOrCommit
        : explicitFetchImpl;

  // Su Android APK usa il client HTTPS nativo (bypassa CORS da https://localhost verso https://1ms.it)
  if (!injectedFetch) {
    const nativePromise = fetchNativeRemoteVersionManifest(
      currentBuildNumber,
      currentVersion ?? '0.0.0',
    );
    if (nativePromise) {
      const nativeJson = await nativePromise;
      const nativeManifest = parseRemoteVersionManifest(nativeJson);
      if (nativeManifest) {
        return evaluateManifest(nativeManifest, currentBuildNumber, currentVersion, currentCommitSha);
      }
      return { status: 'offline' };
    }
  }

  const fetchImpl = injectedFetch ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!fetchImpl) {
    return { status: 'offline' };
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId =
    controller && typeof globalThis.setTimeout === 'function'
      ? globalThis.setTimeout(() => controller.abort(), 5000)
      : null;

  try {
    const queryUrl = buildVersionManifestQueryUrl(currentBuildNumber, currentVersion);
    const response = await fetchImpl(queryUrl, {
      cache: 'no-store',
      signal: controller?.signal,
    });
    if (!response.ok) {
      return { status: 'offline' };
    }
    const json: unknown = await response.json();
    const manifest = parseRemoteVersionManifest(json);
    if (!manifest) {
      return { status: 'offline' };
    }
    return evaluateManifest(manifest, currentBuildNumber, currentVersion, currentCommitSha);
  } catch {
    return { status: 'offline' };
  } finally {
    if (timeoutId !== null && typeof globalThis.clearTimeout === 'function') {
      globalThis.clearTimeout(timeoutId);
    }
  }
}
