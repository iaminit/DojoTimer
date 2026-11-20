declare const __APP_VERSION__: string | undefined;
declare const __APP_BUILD_NUMBER__: number | undefined;
declare const __APP_COMMIT_SHA__: string | undefined;

export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0 ? __APP_VERSION__ : '1.0.1';

export const APP_BUILD_NUMBER: number =
  typeof __APP_BUILD_NUMBER__ === 'number' && Number.isFinite(__APP_BUILD_NUMBER__)
    ? __APP_BUILD_NUMBER__
    : 1;

export const APP_COMMIT_SHA: string =
  typeof __APP_COMMIT_SHA__ === 'string' && __APP_COMMIT_SHA__.length > 0
    ? __APP_COMMIT_SHA__
    : 'local';

export function formatAppVersionLabel(
  version: string = APP_VERSION,
  buildNumber: number = APP_BUILD_NUMBER,
  commitSha: string = APP_COMMIT_SHA,
): string {
  const base = `v${version} • Build #${buildNumber}`;
  return commitSha && commitSha !== 'local' ? `${base} • ${commitSha}` : base;
}

export const APP_VERSION_LABEL = formatAppVersionLabel();
